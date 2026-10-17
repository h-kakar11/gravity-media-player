import type { ConflictPolicy, ImportConflict, ImportOptions, ImportReport, ProfileFile, ProfileMedia, ProfileState } from '@shared/backup';
import type { Db } from '../db/database';

type Row = Record<string, unknown>;
const SAMPLES = 10;
const MAX_CONFLICTS = 200;
const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : d);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);

interface Local { id: number; rel: string; root: string; size: number; kind: string; fileName: string; title: string }

class Rollback extends Error {
  constructor(readonly report: ImportReport) { super('rollback'); }
}

function relOf(root: string, path: string): string {
  const rest = path.slice(root.length).replace(/^[\\/]+/, '').replace(/\\/g, '/');
  return rest;
}

function loadLocal(db: Db): Local[] {
  return db.all<Row>(
    `SELECT m.id, m.path, m.size, m.kind, m.file_name, m.title, r.path AS root_path, r.name AS root_name
     FROM media m JOIN roots r ON r.id = m.root_id WHERE r.adhoc = 0`
  ).map((r) => ({
    id: num(r.id), rel: relOf(str(r.root_path), str(r.path)), root: str(r.root_name), size: num(r.size), kind: str(r.kind),
    fileName: str(r.file_name), title: str(r.title)
  }));
}

type Resolution = { id: number; relocated: boolean } | 'ambiguous' | 'unmatched';

function makeResolver(local: Local[]) {
  const byRel = new Map<string, Local[]>();
  const byName = new Map<string, Local[]>();
  const push = (m: Map<string, Local[]>, k: string, l: Local) => { const a = m.get(k); if (a) a.push(l); else m.set(k, [l]); };
  for (const l of local) {
    push(byRel, `${l.rel.toLowerCase()}|${l.size}`, l);
    push(byName, `${l.fileName.toLowerCase()}|${l.size}|${l.kind}`, l);
  }
  return (m: ProfileMedia): Resolution => {
    let c = byRel.get(`${m.rel.toLowerCase()}|${m.size}`) ?? [];
    if (c.length > 1) c = c.filter((l) => l.root === m.root);
    if (c.length === 1) return { id: c[0]!.id, relocated: false };
    if (c.length > 1 || (byRel.get(`${m.rel.toLowerCase()}|${m.size}`)?.length ?? 0) > 1) return 'ambiguous';
    const name = m.rel.split('/').pop()!.toLowerCase();
    const n = byName.get(`${name}|${m.size}|${m.kind}`) ?? [];
    if (n.length === 1) return { id: n[0]!.id, relocated: true };
    return n.length > 1 ? 'ambiguous' : 'unmatched';
  };
}

/**
 * Merge a validated profile into the database. Never deletes or blindly overwrites: new facts are added, and
 * disagreements are resolved by `opts.conflicts` and listed in the report. A dry run executes the very same code
 * inside a transaction that is rolled back, so the preview matches what applying will do.
 */
export function runImport(db: Db, file: ProfileFile, opts: ImportOptions, dryRun: boolean): ImportReport {
  const report = newReport(file, dryRun);
  try {
    db.tx(() => {
      apply(db, file, opts.conflicts, report);
      if (dryRun) throw new Rollback(report);
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return report;
}

function newReport(file: ProfileFile, dryRun: boolean): ImportReport {
  return {
    dryRun, version: file.version, exportedAt: file.exportedAt, appVersion: file.appVersion,
    media: { total: file.media.length, matched: 0, relocated: 0, ambiguous: 0, unmatched: 0 }, ambiguousSamples: [], unmatchedSamples: [],
    state: { added: 0, updated: 0, unchanged: 0 }, history: { added: 0, duplicate: 0 },
    playlists: { created: 0, merged: 0, itemsAdded: 0, itemsSkipped: 0 }, favorites: { added: 0, unchanged: 0 },
    matches: { added: 0, unchanged: 0, replaced: 0 }, conflicts: [], conflictCount: 0, warnings: []
  };
}

function conflict(r: ImportReport, c: ImportConflict) {
  r.conflictCount++;
  if (r.conflicts.length < MAX_CONFLICTS) r.conflicts.push(c);
}

function apply(db: Db, file: ProfileFile, policy: ConflictPolicy, r: ImportReport) {
  const resolve = makeResolver(loadLocal(db));
  const ids: (number | null)[] = file.media.map((m) => {
    const res = resolve(m);
    if (res === 'ambiguous' || res === 'unmatched') {
      const k = res === 'ambiguous' ? 'ambiguous' : 'unmatched';
      r.media[k]++;
      const samples = k === 'ambiguous' ? r.ambiguousSamples : r.unmatchedSamples;
      if (samples.length < SAMPLES) samples.push(m.title || m.rel);
      return null;
    }
    r.media.matched++;
    if (res.relocated) r.media.relocated++;
    return res.id;
  });
  // The same local file must not be fed by two backup entries (that would let one overwrite the other).
  const seen = new Set<number>();
  ids.forEach((id, i) => {
    if (id == null) return;
    if (seen.has(id)) {
      ids[i] = null;
      r.media.matched--;
      r.media.ambiguous++;
      if (r.ambiguousSamples.length < SAMPLES) r.ambiguousSamples.push(file.media[i]!.title || file.media[i]!.rel);
    }
    seen.add(id);
  });

  file.media.forEach((m, i) => {
    const id = ids[i];
    if (id == null) return;
    if (m.state) mergeState(db, id, m, m.state, policy, r);
    if (m.history) mergeHistory(db, id, m, r);
  });

  mergePlaylists(db, file, ids, r);

  for (const f of file.favorites) {
    const res = db.run('INSERT OR IGNORE INTO collection_state (type, key, favorite) VALUES (?, ?, 1)', [f.type, f.key]);
    if (res.changes) r.favorites.added++;
    else if (db.get<Row>('SELECT favorite FROM collection_state WHERE type = ? AND key = ?', [f.type, f.key])?.favorite === 1) r.favorites.unchanged++;
    else {
      db.run('UPDATE collection_state SET favorite = 1 WHERE type = ? AND key = ?', [f.type, f.key]);
      r.favorites.added++;
    }
  }

  mergeMatches(db, file, ids, policy, r);
  if (r.media.unmatched + r.media.ambiguous > 0) r.warnings.push(`${r.media.unmatched + r.media.ambiguous} item(s) in the backup could not be matched to your library and were skipped.`);
}

function mergeState(db: Db, id: number, m: ProfileMedia, b: ProfileState, policy: ConflictPolicy, r: ImportReport) {
  const mine = db.get<Row>('SELECT * FROM state WHERE media_id = ?', [id]);
  const title = m.title || m.rel;
  if (!mine) {
    db.run(
      `INSERT INTO state (media_id, favorite, rating, notes, play_count, last_played_at, position, progress, completed, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, b.favorite ? 1 : 0, b.rating, b.notes, b.playCount, b.lastPlayedAt, b.positionSec, b.progress, b.completed ? 1 : 0, b.completedAt]
    );
    r.state.added++;
    return;
  }
  const myRating = num(mine.rating);
  const myNotes = str(mine.notes);
  let rating = myRating;
  if (myRating === 0) rating = b.rating;
  else if (b.rating !== 0 && b.rating !== myRating) {
    conflict(r, { what: 'rating', title, mine: String(myRating), backup: String(b.rating) });
    if (policy === 'backup') rating = b.rating;
  }
  let notes = myNotes;
  if (!myNotes) notes = b.notes;
  else if (b.notes && b.notes !== myNotes) {
    conflict(r, { what: 'notes', title, mine: myNotes.slice(0, 200), backup: b.notes.slice(0, 200) });
    if (policy === 'backup') notes = b.notes;
  }
  const myLast = mine.last_played_at == null ? null : num(mine.last_played_at);
  const backupNewer = b.lastPlayedAt != null && (myLast == null || b.lastPlayedAt > myLast);
  const completed = num(mine.completed) === 1 || b.completed;
  const myDone = mine.completed_at == null ? null : num(mine.completed_at);
  const next = {
    favorite: num(mine.favorite) === 1 || b.favorite ? 1 : 0,
    rating, notes,
    playCount: Math.max(num(mine.play_count), b.playCount),
    last: backupNewer ? b.lastPlayedAt : myLast,
    position: backupNewer ? b.positionSec : num(mine.position),
    progress: backupNewer ? b.progress : num(mine.progress),
    completed: completed ? 1 : 0,
    completedAt: myDone ?? (completed ? b.completedAt : null)
  };
  const same = next.favorite === num(mine.favorite) && next.rating === myRating && next.notes === myNotes && next.playCount === num(mine.play_count)
    && next.last === myLast && next.position === num(mine.position) && next.progress === num(mine.progress) && next.completed === num(mine.completed)
    && next.completedAt === myDone;
  if (same) { r.state.unchanged++; return; }
  db.run(
    `UPDATE state SET favorite = ?, rating = ?, notes = ?, play_count = ?, last_played_at = ?, position = ?, progress = ?, completed = ?, completed_at = ? WHERE media_id = ?`,
    [next.favorite, next.rating, next.notes, next.playCount, next.last, next.position, next.progress, next.completed, next.completedAt, id]
  );
  r.state.updated++;
}

function mergeHistory(db: Db, id: number, m: ProfileMedia, r: ImportReport) {
  const have = new Set(db.all<Row>('SELECT kind, started_at FROM history WHERE media_id = ?', [id]).map((h) => `${str(h.kind)}|${num(h.started_at)}`));
  for (const h of m.history ?? []) {
    const k = `${h.kind}|${h.startedAt}`;
    if (have.has(k)) { r.history.duplicate++; continue; }
    have.add(k);
    db.run('INSERT INTO history (media_id, kind, started_at, watched_sec, media_sec, from_sec, to_sec, speed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, h.kind, h.startedAt, h.watchedSec, h.mediaSec, h.fromSec, h.toSec, h.speed]);
    r.history.added++;
  }
}

function mergePlaylists(db: Db, file: ProfileFile, ids: (number | null)[], r: ImportReport) {
  const now = Date.now();
  for (const p of file.playlists) {
    const existing = db.get<Row>('SELECT id FROM playlists WHERE lower(name) = lower(?) ORDER BY id LIMIT 1', [p.name]);
    let pid: number;
    if (existing) { pid = num(existing.id); r.playlists.merged++; }
    else {
      pid = db.run('INSERT INTO playlists (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)', [p.name, p.description, p.createdAt || now, now]).lastId;
      r.playlists.created++;
    }
    const present = new Set(db.all<Row>('SELECT media_id FROM playlist_items WHERE playlist_id = ?', [pid]).map((x) => num(x.media_id)));
    let pos = num(db.get<Row>('SELECT COALESCE(MAX(position), -1) AS p FROM playlist_items WHERE playlist_id = ?', [pid])?.p, -1) + 1;
    for (const idx of p.items) {
      const mid = ids[idx];
      if (mid == null || present.has(mid)) { r.playlists.itemsSkipped++; continue; }
      present.add(mid);
      db.run('INSERT INTO playlist_items (playlist_id, media_id, position, added_at) VALUES (?, ?, ?, ?)', [pid, mid, pos++, now]);
      r.playlists.itemsAdded++;
    }
  }
}

function mergeMatches(db: Db, file: ProfileFile, ids: (number | null)[], policy: ConflictPolicy, r: ImportReport) {
  for (const m of file.matches) {
    let key = m.key;
    if (m.kind === 'movie') {
      const mid = m.media == null ? null : ids[m.media];
      if (mid == null) continue;
      key = String(mid);
    }
    const mine = db.get<Row>('SELECT provider, ext_id, title FROM meta_match WHERE kind = ? AND key = ?', [m.kind, key]);
    if (mine && mine.provider === m.provider && mine.ext_id === m.extId) { r.matches.unchanged++; continue; }
    if (mine) {
      conflict(r, { what: 'match', title: m.title, mine: str(mine.title), backup: m.title });
      if (policy !== 'backup') continue;
      r.matches.replaced++;
    } else r.matches.added++;
    db.run(
      `INSERT OR REPLACE INTO meta_match (kind, key, provider, ext_id, title, year, plot, genres, poster, locked, matched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [m.kind, key, m.provider, m.extId, m.title, m.year, m.plot, JSON.stringify(m.genres), m.poster, m.locked ? 1 : 0, m.matchedAt]
    );
    // Fill blanks only (same as applying a match); no network, so posters are not downloaded here.
    const genre = m.genres.join(', ');
    if (m.kind === 'movie') {
      db.run(`UPDATE media SET plot = COALESCE(NULLIF(plot,''),?), year = COALESCE(year,?), genre = COALESCE(NULLIF(genre,''),?) WHERE id = ?`, [m.plot, m.year, genre || null, Number(key)]);
    } else if (m.kind === 'series') {
      db.run(`UPDATE media SET year = COALESCE(year,?), genre = COALESCE(NULLIF(genre,''),?) WHERE lower(series_key) = ?`, [m.year, genre || null, key.toLowerCase()]);
    }
  }
}
