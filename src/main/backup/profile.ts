import {
  PROFILE_FORMAT, PROFILE_LIMITS, PROFILE_VERSION, type ProfileFile, type ProfileHistory, type ProfileMatch, type ProfileMedia, type ProfilePlaylist, type ProfileState
} from '@shared/backup';
import type { Db } from '../db/database';

type Row = Record<string, unknown>;
const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : d);
const nnum = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : null);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);

export class ProfileError extends Error {}

/** `path` relative to its library folder, `/`-separated; null when it is not inside it. */
export function relativeTo(root: string, path: string): string | null {
  if (!path.startsWith(root)) return null;
  const rest = path.slice(root.length);
  if (root && !/[\\/]$/.test(root) && rest && !/^[\\/]/.test(rest)) return null; // "/music2/x" is not inside "/music"
  const rel = rest.replace(/^[\\/]+/, '').replace(/\\/g, '/');
  return rel || null;
}

/** Keep poster links only when they are plain https URLs: no credentials, query string or fragment that could carry a key. */
export function safePoster(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > 2000) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash ? u.href : null;
  } catch {
    return null;
  }
}

const HAS_STATE = `(s.favorite = 1 OR s.rating > 0 OR s.notes != '' OR s.play_count > 0 OR s.last_played_at IS NOT NULL
  OR s.position > 0 OR s.progress > 0 OR s.completed = 1)`;

/** Build the profile from the database. Reads only; the result contains no settings, secrets or absolute paths. */
export function exportProfile(db: Db, appVersion: string, now: number = Date.now()): ProfileFile {
  const rows = db.all<Row>(
    `SELECT m.id, m.path, m.size, m.kind, m.title, r.path AS root_path, r.name AS root_name,
            s.favorite, s.rating, s.notes, s.play_count, s.last_played_at, s.position, s.progress, s.completed, s.completed_at,
            (s.media_id IS NOT NULL AND ${HAS_STATE}) AS has_state
     FROM media m JOIN roots r ON r.id = m.root_id LEFT JOIN state s ON s.media_id = m.id
     WHERE r.adhoc = 0 AND (
       (s.media_id IS NOT NULL AND ${HAS_STATE})
       OR EXISTS (SELECT 1 FROM history h WHERE h.media_id = m.id)
       OR EXISTS (SELECT 1 FROM playlist_items pi WHERE pi.media_id = m.id)
       OR EXISTS (SELECT 1 FROM meta_match mm WHERE mm.kind = 'movie' AND mm.key = CAST(m.id AS TEXT)))
     ORDER BY m.id`
  );

  const media: ProfileMedia[] = [];
  const index = new Map<number, number>();
  for (const r of rows) {
    const rel = relativeTo(str(r.root_path), str(r.path));
    if (!rel) continue;
    const entry: ProfileMedia = { rel, root: str(r.root_name), size: num(r.size), kind: str(r.kind), title: str(r.title) };
    if (num(r.has_state)) {
      entry.state = {
        favorite: num(r.favorite) === 1, rating: num(r.rating), notes: str(r.notes), playCount: num(r.play_count), lastPlayedAt: nnum(r.last_played_at),
        positionSec: num(r.position), progress: num(r.progress), completed: num(r.completed) === 1, completedAt: nnum(r.completed_at)
      };
    }
    index.set(num(r.id), media.length);
    media.push(entry);
  }

  let history = 0;
  for (const h of db.all<Row>('SELECT media_id, kind, started_at, watched_sec, media_sec, from_sec, to_sec, speed FROM history ORDER BY started_at, id')) {
    const i = index.get(num(h.media_id));
    if (i == null) continue;
    (media[i]!.history ??= []).push({ kind: str(h.kind), startedAt: num(h.started_at), watchedSec: num(h.watched_sec), mediaSec: num(h.media_sec), fromSec: num(h.from_sec), toSec: num(h.to_sec), speed: num(h.speed, 1) });
    history++;
  }

  const playlists: ProfilePlaylist[] = db.all<Row>('SELECT id, name, description, created_at FROM playlists ORDER BY id').map((p) => ({
    name: str(p.name), description: str(p.description), createdAt: num(p.created_at),
    items: db.all<Row>('SELECT media_id FROM playlist_items WHERE playlist_id = ? ORDER BY position, id', [p.id as number])
      .map((i) => index.get(num(i.media_id))).filter((i): i is number => i != null)
  }));

  const favorites = db.all<Row>("SELECT type, key FROM collection_state WHERE favorite = 1 AND type IN ('album', 'series') ORDER BY type, key")
    .map((f) => ({ type: f.type as 'album' | 'series', key: str(f.key) }));

  const matches: ProfileMatch[] = [];
  for (const m of db.all<Row>('SELECT * FROM meta_match ORDER BY kind, key')) {
    const kind = str(m.kind);
    if (kind !== 'series' && kind !== 'movie' && kind !== 'album') continue;
    let genres: string[] = [];
    try { const g: unknown = JSON.parse(str(m.genres, '[]')); if (Array.isArray(g)) genres = g.filter((x): x is string => typeof x === 'string'); } catch { /* keep [] */ }
    const base = {
      provider: str(m.provider), extId: str(m.ext_id), title: str(m.title), year: nnum(m.year), plot: typeof m.plot === 'string' ? m.plot : null,
      genres, poster: safePoster(m.poster), locked: num(m.locked) === 1, matchedAt: num(m.matched_at)
    };
    if (kind === 'movie') {
      const i = index.get(Number(str(m.key)));
      if (i != null) matches.push({ kind, key: '', media: i, ...base });
    } else {
      matches.push({ kind, key: str(m.key), ...base });
    }
  }

  return { format: PROFILE_FORMAT, version: PROFILE_VERSION, exportedAt: now, appVersion, media, playlists, favorites, matches };
}

// ----- validation ------------------------------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (msg: string): never => { throw new ProfileError(msg); };

function nat(v: unknown, label: string, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) return bad(`${label} is not a valid number`);
  return v;
}
function real(v: unknown, label: string, max = 1e12): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) return bad(`${label} is not a valid number`);
  return v;
}
function text(v: unknown, label: string, max: number = PROFILE_LIMITS.text): string {
  if (typeof v !== 'string' || v.length > max) return bad(`${label} is not valid text`);
  return v;
}
const optText = (v: unknown, label: string) => (v == null ? null : text(v, label));
const optNat = (v: unknown, label: string) => (v == null ? null : nat(v, label));
const arr = (v: unknown, label: string, max: number): unknown[] => (Array.isArray(v) && v.length <= max ? v : bad(`${label} is missing or too large`));

function parseState(s: unknown, label: string): ProfileState {
  if (!isObj(s)) return bad(`${label} is malformed`);
  if (typeof s.favorite !== 'boolean' || typeof s.completed !== 'boolean') return bad(`${label} is malformed`);
  const progress = real(s.progress, `${label} progress`);
  if (progress > 1) return bad(`${label} progress is out of range`);
  return {
    favorite: s.favorite, rating: nat(s.rating, `${label} rating`, 5), notes: text(s.notes, `${label} notes`), playCount: nat(s.playCount, `${label} play count`, 1_000_000),
    lastPlayedAt: optNat(s.lastPlayedAt, `${label} last played`), positionSec: real(s.positionSec, `${label} position`, 1e7), progress,
    completed: s.completed, completedAt: optNat(s.completedAt, `${label} completed time`)
  };
}

function parseHistory(h: unknown, label: string): ProfileHistory {
  if (!isObj(h)) return bad(`${label} is malformed`);
  return {
    kind: text(h.kind, `${label} kind`, 40), startedAt: nat(h.startedAt, `${label} start`), watchedSec: real(h.watchedSec, `${label} watched`, 1e7), mediaSec: real(h.mediaSec, `${label} length`, 1e7),
    fromSec: real(h.fromSec, `${label} from`, 1e7), toSec: real(h.toSec, `${label} to`, 1e7), speed: real(h.speed, `${label} speed`, 100)
  };
}

/** Validate untrusted file contents and return a clean copy. Throws `ProfileError` with a message fit for the user. */
export function parseProfile(input: unknown): ProfileFile {
  if (!isObj(input) || input.format !== PROFILE_FORMAT) return bad('This is not a Gravity profile backup.');
  const version = input.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return bad('The backup has no valid version.');
  if (version > PROFILE_VERSION) return bad(`This backup was made by a newer version of Gravity (format ${version}); this version understands format ${PROFILE_VERSION}. Update Gravity to restore it.`);

  const media = arr(input.media, 'The media list', PROFILE_LIMITS.media).map((m, i): ProfileMedia => {
    const label = `Media entry ${i + 1}`;
    if (!isObj(m)) return bad(`${label} is malformed`);
    const rel = text(m.rel, `${label} path`, 4096);
    if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) return bad(`${label} has an unsafe path`);
    const entry: ProfileMedia = { rel, root: text(m.root ?? '', `${label} folder`, 1024), size: nat(m.size, `${label} size`), kind: text(m.kind, `${label} kind`, 40), title: text(m.title ?? '', `${label} title`, 1024) };
    if (m.state != null) entry.state = parseState(m.state, `${label} state`);
    if (m.history != null) entry.history = arr(m.history, `${label} history`, PROFILE_LIMITS.history).map((h, j) => parseHistory(h, `${label} history ${j + 1}`));
    return entry;
  });
  if (media.reduce((n, m) => n + (m.history?.length ?? 0), 0) > PROFILE_LIMITS.history) bad('The backup has too much history');

  const playlists = arr(input.playlists ?? [], 'The playlists', PROFILE_LIMITS.playlists).map((p, i): ProfilePlaylist => {
    if (!isObj(p)) return bad(`Playlist ${i + 1} is malformed`);
    const items = arr(p.items, `Playlist ${i + 1} items`, PROFILE_LIMITS.media).map((x) => {
      const n = nat(x, `Playlist ${i + 1} item`);
      return n < media.length ? n : bad(`Playlist ${i + 1} refers to a missing item`);
    });
    const name = text(p.name, `Playlist ${i + 1} name`, 500).trim();
    if (!name) return bad(`Playlist ${i + 1} has no name`);
    return { name, description: text(p.description ?? '', `Playlist ${i + 1} description`), createdAt: nat(p.createdAt ?? 0, `Playlist ${i + 1} date`), items };
  });

  const favorites = arr(input.favorites ?? [], 'The favourites', PROFILE_LIMITS.media).map((f) => {
    if (!isObj(f) || (f.type !== 'album' && f.type !== 'series')) return bad('A favourite is malformed');
    return { type: f.type as 'album' | 'series', key: text(f.key, 'A favourite key', 2000) };
  });

  const matches = arr(input.matches ?? [], 'The matches', PROFILE_LIMITS.media).map((m, i): ProfileMatch => {
    const label = `Match ${i + 1}`;
    if (!isObj(m) || (m.kind !== 'series' && m.kind !== 'movie' && m.kind !== 'album') || typeof m.locked !== 'boolean') return bad(`${label} is malformed`);
    let mediaIdx: number | undefined;
    if (m.kind === 'movie') {
      mediaIdx = nat(m.media, `${label} item`);
      if (mediaIdx >= media.length) return bad(`${label} refers to a missing item`);
    }
    const genres = arr(m.genres ?? [], `${label} genres`, 100).map((g) => text(g, `${label} genre`, 200));
    const year = optNat(m.year, `${label} year`);
    return {
      kind: m.kind, key: m.kind === 'movie' ? '' : text(m.key, `${label} key`, 2000), ...(mediaIdx != null ? { media: mediaIdx } : {}),
      provider: text(m.provider, `${label} provider`, 40), extId: text(m.extId, `${label} id`, 200), title: text(m.title, `${label} title`, 1024),
      year, plot: optText(m.plot, `${label} plot`), genres, poster: safePoster(m.poster), locked: m.locked, matchedAt: nat(m.matchedAt ?? 0, `${label} date`)
    };
  });

  return { format: PROFILE_FORMAT, version, exportedAt: nat(input.exportedAt ?? 0, 'The export date'), appVersion: text(input.appVersion ?? '', 'The app version', 100), media, playlists, favorites, matches };
}
