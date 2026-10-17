import { sep } from 'node:path';
import type {
  AlbumSummary, ArtistSummary, BrowseResult, FolderEntry, HistorySession, HomeData, LibraryFacets, LibraryQuery,
  LibraryRoot, MediaItem, MediaKind, ProgressUpdate, QueryResult, SearchResults, SeriesSummary, UserStatePatch
} from '@shared/types';
import type { AlbumQuery, SeriesQuery, Siblings } from '@shared/ipc';
import type { MediaFields } from '../library/types';
import { Db, sv, type SqlValue } from './database';

type Row = Record<string, unknown>;

const SELECT_MEDIA = `
  SELECT m.*, s.favorite AS s_fav, s.rating AS s_rating, s.play_count AS s_plays, s.last_played_at AS s_last,
         s.position AS s_pos, s.progress AS s_prog, s.completed AS s_done, s.notes AS s_notes, s.location AS s_loc
  FROM media m LEFT JOIN state s ON s.media_id = m.id`;

const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : d);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const nstr = (v: unknown) => (typeof v === 'string' ? v : null);
const nnum = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : null);

export function mapMedia(r: Row): MediaItem {
  return {
    id: num(r.id),
    rootId: num(r.root_id),
    kind: r.kind as MediaKind,
    vclass: (r.vclass as MediaItem['vclass']) ?? null,
    path: str(r.path),
    dir: str(r.dir),
    fileName: str(r.file_name),
    ext: str(r.ext),
    title: str(r.title),
    sortTitle: str(r.sort_title),
    size: num(r.size),
    mtimeMs: num(r.mtime_ms),
    addedAt: num(r.added_at),
    durationSec: num(r.duration),
    width: num(r.width),
    height: num(r.height),
    fps: num(r.fps),
    bitrate: num(r.bitrate),
    container: str(r.container),
    vcodec: str(r.vcodec),
    acodec: str(r.acodec),
    channels: num(r.channels),
    sampleRate: num(r.sample_rate),
    bitDepth: num(r.bit_depth),
    hdr: num(r.hdr) === 1,
    audioTrackCount: num(r.audio_tracks),
    subtitleTrackCount: num(r.sub_tracks),
    year: nnum(r.year),
    genre: nstr(r.genre),
    artist: nstr(r.artist),
    albumArtist: nstr(r.album_artist),
    album: nstr(r.album),
    trackNo: nnum(r.track_no),
    discNo: nnum(r.disc_no),
    series: nstr(r.series),
    season: nnum(r.season),
    episode: nnum(r.episode),
    plot: nstr(r.plot),
    pages: num(r.pages),
    hasArt: r.art_src != null,
    missing: num(r.missing) === 1,
    favorite: num(r.s_fav) === 1,
    rating: num(r.s_rating),
    playCount: num(r.s_plays),
    lastPlayedAt: nnum(r.s_last),
    positionSec: num(r.s_pos),
    progress: num(r.s_prog),
    completed: num(r.s_done) === 1,
    notes: str(r.s_notes),
    location: nstr(r.s_loc)
  };
}

/** Zero-pad digit runs so a plain string sort yields natural ordering ("ep 2" < "ep 10"). */
export function padDigits(s: string): string {
  return s.replace(/\d+/g, (d) => d.padStart(7, '0'));
}

const cjk = /[぀-ヿ㐀-鿿가-힯]/;

/** Build an FTS5 MATCH expression, or null when LIKE matching is the better tool. */
export function ftsQuery(text: string): string | null {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || cjk.test(text)) return null;
  const parts = tokens
    .map((t) => t.replace(/["*()^:{}-]/g, ' ').trim())
    .filter(Boolean)
    .flatMap((t) => t.split(/\s+/))
    .map((t) => `"${t}"*`);
  return parts.length ? parts.join(' ') : null;
}

function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Exclusive upper bound for "starts with prefix" range scans. */
function prefixEnd(prefix: string): string {
  return prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
}

export class LibraryRepo {
  constructor(readonly db: Db) {}

  // -------------------------------------------------------------------------
  // Roots

  listRoots(): LibraryRoot[] {
    return this.db
      .all<Row>(`SELECT r.*, (SELECT COUNT(*) FROM media m WHERE m.root_id = r.id AND m.missing = 0) AS n FROM roots r WHERE r.adhoc = 0 ORDER BY r.id`)
      .map((r) => ({
        id: num(r.id), path: str(r.path), name: str(r.name), type: str(r.type, 'auto') as LibraryRoot['type'],
        enabled: num(r.enabled) === 1, watch: num(r.watch) === 1, online: true, itemCount: num(r.n),
        lastScanAt: nnum(r.last_scan_at), scanning: false
      }));
  }

  getRoot(id: number): LibraryRoot | undefined {
    return this.listRoots().find((r) => r.id === id);
  }

  addRoot(path: string, name: string, type: string, adhoc = false): number {
    const existing = this.db.get<Row>('SELECT id FROM roots WHERE path = ?', [path]);
    if (existing) return num(existing.id);
    return this.db.run('INSERT INTO roots (path, name, type, adhoc) VALUES (?, ?, ?, ?)', [path, name, type, adhoc ? 1 : 0]).lastId;
  }

  updateRoot(id: number, patch: { name?: string; type?: string; enabled?: boolean; watch?: boolean }): void {
    const sets: string[] = [];
    const vals: SqlValue[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      sets.push(`${k} = ?`);
      vals.push(sv(v));
    }
    if (sets.length) this.db.run(`UPDATE roots SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
  }

  removeRoot(id: number): void {
    this.db.run('DELETE FROM roots WHERE id = ?', [id]);
  }

  touchRootScan(id: number): void {
    this.db.run('UPDATE roots SET last_scan_at = ? WHERE id = ?', [Date.now(), id]);
  }

  adhocRootId(): number {
    const row = this.db.get<Row>('SELECT id FROM roots WHERE adhoc = 1');
    return row ? num(row.id) : this.addRoot('\u0000opened-files', 'Opened Files', 'auto', true);
  }

  // -------------------------------------------------------------------------
  // Directories (for quick scans and browsing)

  knownDirs(rootId: number): Map<string, number> {
    const m = new Map<string, number>();
    for (const r of this.db.all<Row>('SELECT path, mtime_ms FROM dirs WHERE root_id = ?', [rootId])) m.set(str(r.path), num(r.mtime_ms));
    return m;
  }

  childDirs(parent: string): string[] {
    return this.db.all<Row>('SELECT path FROM dirs WHERE parent = ?', [parent]).map((r) => str(r.path));
  }

  upsertDir(path: string, parent: string | null, rootId: number, mtimeMs: number): void {
    this.db.run(
      `INSERT INTO dirs (path, parent, root_id, mtime_ms) VALUES (?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET mtime_ms = excluded.mtime_ms, parent = excluded.parent`,
      [path, parent, rootId, mtimeMs]
    );
  }

  removeDirTree(path: string): void {
    const lo = path + sep;
    this.db.run('DELETE FROM dirs WHERE path = ? OR (path >= ? AND path < ?)', [path, lo, prefixEnd(lo)]);
  }

  // -------------------------------------------------------------------------
  // Media writes

  mediaInDir(dir: string): { id: number; path: string; size: number; mtimeMs: number; missing: boolean; kind: MediaKind }[] {
    return this.db.all<Row>('SELECT id, path, size, mtime_ms, missing, kind FROM media WHERE dir = ?', [dir]).map((r) => ({
      id: num(r.id), path: str(r.path), size: num(r.size), mtimeMs: num(r.mtime_ms), missing: num(r.missing) === 1, kind: r.kind as MediaKind
    }));
  }

  findByInode(ino: string, dev: string, size: number): { id: number; path: string; mtimeMs: number } | undefined {
    const r = this.db.get<Row>('SELECT id, path, mtime_ms FROM media WHERE ino = ? AND dev = ? AND size = ? LIMIT 1', [ino, dev, size]);
    return r ? { id: num(r.id), path: str(r.path), mtimeMs: num(r.mtime_ms) } : undefined;
  }

  /** A single missing row with identical size and mtime — used to relink moved files on filesystems without stable inodes. */
  findMissingTwin(size: number, mtimeMs: number): { id: number; path: string } | undefined {
    const rows = this.db.all<Row>('SELECT id, path FROM media WHERE missing = 1 AND size = ? AND mtime_ms = ? LIMIT 2', [size, mtimeMs]);
    return rows.length === 1 ? { id: num(rows[0]!.id), path: str(rows[0]!.path) } : undefined;
  }

  getIdByPath(path: string): number | undefined {
    const r = this.db.get<Row>('SELECT id FROM media WHERE path = ?', [path]);
    return r ? num(r.id) : undefined;
  }

  /** Insert or update by path (or by `relinkId` when a file moved). Returns the row id and whether it was new. */
  upsertMedia(f: MediaFields, relinkId?: number): { id: number; created: boolean } {
    const now = Date.now();
    const vals: SqlValue[] = [
      f.rootId, f.path, f.dir, f.fileName, f.ext, f.kind, sv(f.vclass), f.title, f.sortTitle, f.size, f.mtimeMs, sv(f.ino), sv(f.dev), now,
      f.durationSec, f.width, f.height, f.fps, f.bitrate, f.container, f.vcodec, f.acodec, f.channels, f.sampleRate, f.bitDepth, sv(f.hdr),
      f.audioTracks, f.subTracks, sv(f.year), sv(f.genre), sv(f.artist), sv(f.albumArtist), sv(f.album), sv(f.trackNo), sv(f.discNo),
      sv(f.series), sv(f.season), sv(f.episode), sv(f.plot), f.pages, sv(f.artKey), sv(f.artSrc), sv(f.replayGain)
    ];
    const cols = `root_id, path, dir, file_name, ext, kind, vclass, title, sort_title, size, mtime_ms, ino, dev, scanned_at,
      duration, width, height, fps, bitrate, container, vcodec, acodec, channels, sample_rate, bit_depth, hdr,
      audio_tracks, sub_tracks, year, genre, artist, album_artist, album, track_no, disc_no,
      series, season, episode, plot, pages, art_key, art_src, replay_gain`;
    const set = cols.split(',').map((c) => `${c.trim()} = ?`).join(', ');
    return this.db.tx(() => {
      let id = relinkId;
      if (id == null) id = this.getIdByPath(f.path);
      if (id != null) {
        this.db.run(`UPDATE media SET ${set}, missing = 0 WHERE id = ?`, [...vals, id]);
        if (f.probeJson !== undefined) this.saveProbe(id, f.probeJson);
        return { id, created: false };
      }
      const placeholders = vals.map(() => '?').join(', ');
      const res = this.db.run(`INSERT INTO media (${cols}, added_at) VALUES (${placeholders}, ?)`, [...vals, now]);
      if (f.probeJson) this.saveProbe(res.lastId, f.probeJson);
      return { id: res.lastId, created: true };
    });
  }

  saveProbe(id: number, json: string | null | undefined): void {
    if (json == null) return;
    this.db.run('INSERT INTO probe (media_id, json) VALUES (?, ?) ON CONFLICT(media_id) DO UPDATE SET json = excluded.json', [id, json]);
  }

  getProbeJson(id: number): string | undefined {
    const r = this.db.get<Row>('SELECT json FROM probe WHERE media_id = ?', [id]);
    return r ? str(r.json) : undefined;
  }

  setArt(id: number, artKey: string | null, artSrc: string | null): void {
    this.db.run('UPDATE media SET art_key = ?, art_src = ? WHERE id = ?', [artKey, artSrc, id]);
  }

  markMissing(ids: number[]): void {
    if (ids.length === 0) return;
    this.db.tx(() => {
      for (const id of ids) this.db.run('UPDATE media SET missing = 1 WHERE id = ?', [id]);
    });
  }

  markRootMissing(rootId: number): void {
    this.db.run('UPDATE media SET missing = 1 WHERE root_id = ?', [rootId]);
  }

  purgeMissing(rootId?: number): number {
    const r = rootId == null
      ? this.db.run('DELETE FROM media WHERE missing = 1')
      : this.db.run('DELETE FROM media WHERE missing = 1 AND root_id = ?', [rootId]);
    return r.changes;
  }

  deleteMedia(id: number): void {
    this.db.run('DELETE FROM media WHERE id = ?', [id]);
  }

  // -------------------------------------------------------------------------
  // Media reads

  get(id: number): MediaItem | undefined {
    const r = this.db.get<Row>(`${SELECT_MEDIA} WHERE m.id = ?`, [id]);
    return r ? mapMedia(r) : undefined;
  }

  getRow(id: number): Row | undefined {
    return this.db.get<Row>('SELECT * FROM media WHERE id = ?', [id]);
  }

  getMany(ids: number[]): MediaItem[] {
    if (ids.length === 0) return [];
    const out: MediaItem[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const rows = this.db.all<Row>(`${SELECT_MEDIA} WHERE m.id IN (${chunk.map(() => '?').join(',')})`, chunk);
      out.push(...rows.map(mapMedia));
    }
    const byId = new Map(out.map((m) => [m.id, m]));
    return ids.map((id) => byId.get(id)).filter((m): m is MediaItem => !!m);
  }

  private where(q: LibraryQuery): { sql: string; params: SqlValue[] } {
    const w: string[] = [];
    const p: SqlValue[] = [];
    if (!q.includeMissing) w.push('m.missing = 0');
    if (q.kind) {
      const kinds = Array.isArray(q.kind) ? q.kind : [q.kind];
      w.push(`m.kind IN (${kinds.map(() => '?').join(',')})`);
      p.push(...kinds);
    }
    if (q.vclass) { w.push('m.vclass = ?'); p.push(q.vclass); }
    if (q.text?.trim()) {
      const fts = ftsQuery(q.text);
      if (fts) {
        w.push('m.id IN (SELECT rowid FROM media_fts WHERE media_fts MATCH ?)');
        p.push(fts);
      } else {
        const like = `%${likeEscape(q.text.trim())}%`;
        w.push(`(m.title LIKE ? ESCAPE '\\' OR m.artist LIKE ? ESCAPE '\\' OR m.album LIKE ? ESCAPE '\\' OR m.series LIKE ? ESCAPE '\\' OR m.file_name LIKE ? ESCAPE '\\')`);
        p.push(like, like, like, like, like);
      }
    }
    if (q.favorite) w.push('s.favorite = 1');
    switch (q.status) {
      case 'unwatched': w.push('COALESCE(s.completed, 0) = 0 AND COALESCE(s.progress, 0) = 0 AND COALESCE(s.position, 0) = 0'); break;
      case 'inprogress': w.push('COALESCE(s.completed, 0) = 0 AND (COALESCE(s.progress, 0) > 0 OR COALESCE(s.position, 0) > 0)'); break;
      case 'completed': w.push('s.completed = 1'); break;
      default: break;
    }
    if (q.genre) {
      w.push(`instr(';' || replace(lower(m.genre), '; ', ';') || ';', ';' || lower(?) || ';') > 0`);
      p.push(q.genre);
    }
    if (q.yearFrom != null) { w.push('m.year >= ?'); p.push(q.yearFrom); }
    if (q.yearTo != null) { w.push('m.year <= ?'); p.push(q.yearTo); }
    if (q.resolution) {
      const r = { sd: [1, 1279], hd: [1280, 1919], fhd: [1920, 3839], uhd: [3840, 99999] }[q.resolution];
      w.push('m.width BETWEEN ? AND ?');
      p.push(r[0]!, r[1]!);
    }
    if (q.album != null) { w.push('m.album_key = ?'); p.push(q.album); }
    if (q.artistKey != null) { w.push('m.artist_key = ?'); p.push(q.artistKey); }
    if (q.series != null) { w.push('m.series_key = ?'); p.push(q.series); }
    if (q.season != null) { w.push('m.season = ?'); p.push(q.season); }
    if (q.dir != null) { w.push('m.dir = ?'); p.push(q.dir); }
    if (q.underDir != null) {
      const lo = q.underDir + sep;
      w.push('m.path >= ? AND m.path < ?');
      p.push(lo, prefixEnd(lo));
    }
    if (q.rootId != null) { w.push('m.root_id = ?'); p.push(q.rootId); }
    if (q.ids) {
      w.push(`m.id IN (${q.ids.map(() => '?').join(',') || 'NULL'})`);
      p.push(...q.ids);
    }
    return { sql: w.length ? `WHERE ${w.join(' AND ')}` : '', params: p };
  }

  private orderBy(q: LibraryQuery): string {
    const dir = q.desc ? 'DESC' : 'ASC';
    switch (q.sort) {
      case 'added': return `ORDER BY m.added_at ${dir}, m.id`;
      case 'played': return `ORDER BY s.last_played_at ${dir} NULLS LAST, m.id`;
      case 'year': return `ORDER BY m.year ${dir} NULLS LAST, m.sort_title`;
      case 'duration': return `ORDER BY m.duration ${dir}, m.id`;
      case 'size': return `ORDER BY m.size ${dir}, m.id`;
      case 'rating': return `ORDER BY COALESCE(s.rating, 0) ${dir}, m.sort_title`;
      case 'progress': return `ORDER BY COALESCE(s.progress, 0) ${dir}, m.sort_title`;
      case 'track': return `ORDER BY COALESCE(m.disc_no, 1) ${dir}, COALESCE(m.track_no, 9999) ${dir}, m.sort_title`;
      case 'episode': return `ORDER BY COALESCE(m.season, 0) ${dir}, COALESCE(m.episode, 0) ${dir}, m.sort_title`;
      case 'name': return `ORDER BY m.sort_title ${dir}, m.id`;
      case 'random': return 'ORDER BY RANDOM()';
      case 'title':
      default: return `ORDER BY m.sort_title ${dir}, m.id`;
    }
  }

  query(q: LibraryQuery): QueryResult<MediaItem> {
    const { sql, params } = this.where(q);
    const needsState = /\bs\./.test(sql) || /\bs\./.test(this.orderBy(q));
    const limit = q.limit != null ? ` LIMIT ${Math.max(0, Math.floor(q.limit))} OFFSET ${Math.max(0, Math.floor(q.offset ?? 0))}` : '';
    const rows = this.db.all<Row>(`${SELECT_MEDIA} ${sql} ${this.orderBy(q)}${limit}`, params);
    const items = rows.map(mapMedia);
    let total = items.length;
    if (q.limit != null && (items.length >= q.limit || (q.offset ?? 0) > 0)) {
      const from = needsState ? 'media m LEFT JOIN state s ON s.media_id = m.id' : 'media m LEFT JOIN state s ON s.media_id = m.id';
      total = num(this.db.get<Row>(`SELECT COUNT(*) AS n FROM ${from} ${sql}`, params)?.n);
    }
    return { items, total };
  }

  // -------------------------------------------------------------------------
  // Groups

  albums(q: AlbumQuery): QueryResult<AlbumSummary> {
    const w: string[] = ["m.kind = 'audio'", 'm.missing = 0'];
    const p: SqlValue[] = [];
    if (q.text?.trim()) {
      const like = `%${likeEscape(q.text.trim())}%`;
      w.push(`(m.album LIKE ? ESCAPE '\\' OR m.artist LIKE ? ESCAPE '\\' OR m.album_artist LIKE ? ESCAPE '\\')`);
      p.push(like, like, like);
    }
    if (q.artistKey != null) { w.push('m.artist_key = ?'); p.push(q.artistKey); }
    const dir = q.desc ? 'DESC' : 'ASC';
    const order = {
      title: `album COLLATE NOCASE ${dir}`, artist: `artist COLLATE NOCASE ${dir}, album COLLATE NOCASE`,
      added: `added ${dir}`, year: `year ${dir} NULLS LAST`, played: `last_played ${dir} NULLS LAST`
    }[q.sort ?? 'title'];
    const inner = `
      SELECT m.album_key AS key, MIN(COALESCE(m.album, '')) AS album,
             MIN(COALESCE(NULLIF(m.album_artist, ''), NULLIF(m.artist, ''), '')) AS artist,
             MIN(m.year) AS year, COUNT(*) AS n, SUM(m.duration) AS dur,
             MIN(CASE WHEN m.art_src IS NOT NULL THEN m.id END) AS art_id,
             MAX(m.added_at) AS added, MAX(s.last_played_at) AS last_played, SUM(COALESCE(s.play_count, 0)) AS plays,
             COALESCE(cs.favorite, 0) AS fav
      FROM media m LEFT JOIN state s ON s.media_id = m.id
      LEFT JOIN collection_state cs ON cs.type = 'album' AND cs.key = m.album_key
      WHERE ${w.join(' AND ')} GROUP BY m.album_key`;
    const fav = q.favorite ? 'WHERE fav = 1' : '';
    const limit = q.limit != null ? ` LIMIT ${Math.floor(q.limit)} OFFSET ${Math.floor(q.offset ?? 0)}` : '';
    const rows = this.db.all<Row>(`SELECT * FROM (${inner}) ${fav} ORDER BY ${order}, key${limit}`, p);
    const items: AlbumSummary[] = rows.map((r) => ({
      key: str(r.key), album: str(r.album) || 'Unknown Album', artist: str(r.artist) || 'Unknown Artist', year: nnum(r.year),
      trackCount: num(r.n), durationSec: num(r.dur), artMediaId: nnum(r.art_id), favorite: num(r.fav) === 1,
      addedAt: num(r.added), lastPlayedAt: nnum(r.last_played), playCount: num(r.plays)
    }));
    let total = items.length;
    if (q.limit != null && (items.length >= q.limit || (q.offset ?? 0) > 0)) {
      total = num(this.db.get<Row>(`SELECT COUNT(*) AS n FROM (${inner}) ${fav}`, p)?.n);
    }
    return { items, total };
  }

  artists(text?: string): QueryResult<ArtistSummary> {
    const p: SqlValue[] = [];
    let extra = '';
    if (text?.trim()) {
      extra = `AND (m.artist LIKE ? ESCAPE '\\' OR m.album_artist LIKE ? ESCAPE '\\')`;
      const like = `%${likeEscape(text.trim())}%`;
      p.push(like, like);
    }
    const rows = this.db.all<Row>(
      `SELECT m.artist_key AS key, MIN(COALESCE(NULLIF(m.album_artist, ''), NULLIF(m.artist, ''), '')) AS name,
              COUNT(DISTINCT m.album_key) AS albums, COUNT(*) AS n, MIN(CASE WHEN m.art_src IS NOT NULL THEN m.id END) AS art_id
       FROM media m WHERE m.kind = 'audio' AND m.missing = 0 ${extra} GROUP BY m.artist_key ORDER BY name COLLATE NOCASE`,
      p
    );
    const items = rows.map((r) => ({
      key: str(r.key), name: str(r.name) || 'Unknown Artist', albumCount: num(r.albums), trackCount: num(r.n), artMediaId: nnum(r.art_id)
    }));
    return { items, total: items.length };
  }

  series(q: SeriesQuery): QueryResult<SeriesSummary> {
    const base = q.type === 'show' ? "m.kind = 'video' AND m.vclass = 'episode'" : "m.kind = 'comic'";
    const w = [base, 'm.missing = 0', 'm.series IS NOT NULL'];
    const p: SqlValue[] = [];
    if (q.text?.trim()) {
      w.push(`m.series LIKE ? ESCAPE '\\'`);
      p.push(`%${likeEscape(q.text.trim())}%`);
    }
    const dir = q.desc ? 'DESC' : 'ASC';
    const order = { title: `title COLLATE NOCASE ${dir}`, added: `added ${dir}`, played: `last_played ${dir} NULLS LAST` }[q.sort ?? 'title'];
    const inner = `
      SELECT m.series_key AS key, MIN(m.series) AS title, COUNT(DISTINCT COALESCE(m.season, 0)) AS seasons, COUNT(*) AS n,
             SUM(COALESCE(s.completed, 0)) AS done, MIN(m.year) AS year,
             (SELECT m2.id FROM media m2 WHERE m2.series_key = m.series_key AND m2.kind = m.kind AND m2.art_src IS NOT NULL AND m2.missing = 0
              ORDER BY COALESCE(m2.season, 0), COALESCE(m2.episode, 0), m2.id LIMIT 1) AS art_id,
             MAX(m.added_at) AS added, MAX(s.last_played_at) AS last_played, COALESCE(cs.favorite, 0) AS fav
      FROM media m LEFT JOIN state s ON s.media_id = m.id
      LEFT JOIN collection_state cs ON cs.type = 'series' AND cs.key = (CASE WHEN m.kind = 'comic' THEN 'comic:' ELSE 'show:' END) || m.series_key
      WHERE ${w.join(' AND ')} GROUP BY m.series_key`;
    const fav = q.favorite ? 'WHERE fav = 1' : '';
    const limit = q.limit != null ? ` LIMIT ${Math.floor(q.limit)} OFFSET ${Math.floor(q.offset ?? 0)}` : '';
    const rows = this.db.all<Row>(`SELECT * FROM (${inner}) ${fav} ORDER BY ${order}, key${limit}`, p);
    const items: SeriesSummary[] = rows.map((r) => ({
      key: str(r.key), title: str(r.title), type: q.type, seasonCount: num(r.seasons), episodeCount: num(r.n), completedCount: num(r.done),
      year: nnum(r.year), artMediaId: nnum(r.art_id), addedAt: num(r.added), lastPlayedAt: nnum(r.last_played), favorite: num(r.fav) === 1
    }));
    return { items, total: items.length };
  }

  facets(kind: MediaKind): LibraryFacets {
    const genreRows = this.db.all<Row>('SELECT genre, COUNT(*) AS n FROM media WHERE kind = ? AND missing = 0 AND genre IS NOT NULL GROUP BY genre', [kind]);
    const counts = new Map<string, number>();
    for (const r of genreRows) {
      for (const g of str(r.genre).split(';').map((x) => x.trim()).filter(Boolean)) counts.set(g, (counts.get(g) ?? 0) + num(r.n));
    }
    const genres = [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const years = this.db
      .all<Row>('SELECT year, COUNT(*) AS n FROM media WHERE kind = ? AND missing = 0 AND year IS NOT NULL GROUP BY year ORDER BY year DESC', [kind])
      .map((r) => ({ year: num(r.year), count: num(r.n) }));
    const total = num(this.db.get<Row>('SELECT COUNT(*) AS n FROM media WHERE kind = ? AND missing = 0', [kind])?.n);
    return { genres, years, total };
  }

  folderFavorites(): Set<string> {
    return new Set(this.db.all<Row>("SELECT key FROM collection_state WHERE type = 'folder' AND favorite = 1").map((r) => str(r.key)));
  }

  favoriteKeys(type: string): string[] {
    return this.db.all<Row>('SELECT key FROM collection_state WHERE type = ? AND favorite = 1', [type]).map((r) => str(r.key));
  }

  setCollectionFavorite(type: string, key: string, on: boolean): void {
    this.db.run(
      'INSERT INTO collection_state (type, key, favorite) VALUES (?, ?, ?) ON CONFLICT(type, key) DO UPDATE SET favorite = excluded.favorite',
      [type, key, on ? 1 : 0]
    );
  }

  // -------------------------------------------------------------------------
  // Browse (file-explorer view)

  browse(path: string | null, onlineRoots: Set<number>): BrowseResult {
    if (path == null) {
      const roots = this.listRoots().filter((r) => r.enabled);
      const folders: FolderEntry[] = roots.map((r) => this.folderEntry(r.path, r.name, r.id, onlineRoots.has(r.id)));
      return { path: null, parent: null, crumbs: [{ name: 'Library', path: null }], folders, items: [] };
    }
    const root = this.listRoots().filter((r) => path === r.path || path.startsWith(r.path + sep)).sort((a, b) => b.path.length - a.path.length)[0];
    const prefix = path + sep;
    const subs = new Map<string, FolderEntry>();
    const favs = this.folderFavorites();
    const rows = this.db.all<Row>(
      `SELECT sub, kind, COUNT(*) AS n FROM (
         SELECT substr(m.path, ?1, instr(substr(m.path, ?1), ?2) - 1) AS sub, m.kind AS kind
         FROM media m WHERE m.path > ?3 AND m.path < ?4 AND m.missing = 0 AND instr(substr(m.path, ?1), ?2) > 0
       ) GROUP BY sub, kind`,
      [prefix.length + 1, sep, prefix, prefixEnd(prefix)]
    );
    for (const r of rows) {
      const name = str(r.sub);
      if (!name) continue;
      let e = subs.get(name);
      if (!e) { e = { path: prefix + name, name, itemCount: 0, kinds: {}, artMediaIds: [], favorite: favs.has(prefix + name) }; subs.set(name, e); }
      e.itemCount += num(r.n);
      e.kinds[r.kind as MediaKind] = (e.kinds[r.kind as MediaKind] ?? 0) + num(r.n);
    }
    const artRows = this.db.all<Row>(
      `SELECT sub, id FROM (
         SELECT substr(m.path, ?1, instr(substr(m.path, ?1), ?2) - 1) AS sub, m.id AS id,
                row_number() OVER (PARTITION BY substr(m.path, ?1, instr(substr(m.path, ?1), ?2) - 1) ORDER BY m.sort_title) AS rn
         FROM media m WHERE m.path > ?3 AND m.path < ?4 AND m.missing = 0 AND m.art_src IS NOT NULL AND instr(substr(m.path, ?1), ?2) > 0
       ) WHERE rn <= 4`,
      [prefix.length + 1, sep, prefix, prefixEnd(prefix)]
    );
    for (const r of artRows) subs.get(str(r.sub))?.artMediaIds.push(num(r.id));
    const items = this.db.all<Row>(`${SELECT_MEDIA} WHERE m.dir = ? AND m.missing = 0 ORDER BY m.sort_title`, [path]).map(mapMedia);
    const folders = [...subs.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    // Breadcrumbs: Library > root > subfolders
    const crumbs: BrowseResult['crumbs'] = [{ name: 'Library', path: null }];
    let parent: string | null = null;
    if (root) {
      crumbs.push({ name: root.name, path: root.path });
      if (path !== root.path) {
        const rel = path.slice(root.path.length + 1).split(sep);
        let acc = root.path;
        for (const seg of rel) { acc += sep + seg; crumbs.push({ name: seg, path: acc }); }
        parent = crumbs[crumbs.length - 2]!.path;
      } else parent = null;
    }
    return { path, parent, crumbs, folders, items };
  }

  private folderEntry(path: string, name: string, rootId: number, online: boolean): FolderEntry {
    const kinds: Partial<Record<MediaKind, number>> = {};
    let count = 0;
    for (const r of this.db.all<Row>('SELECT kind, COUNT(*) AS n FROM media WHERE root_id = ? AND missing = 0 GROUP BY kind', [rootId])) {
      kinds[r.kind as MediaKind] = num(r.n);
      count += num(r.n);
    }
    const art = this.db.all<Row>('SELECT id FROM media WHERE root_id = ? AND missing = 0 AND art_src IS NOT NULL ORDER BY added_at DESC LIMIT 4', [rootId]).map((r) => num(r.id));
    void online;
    return { path, name, itemCount: count, kinds, artMediaIds: art, favorite: false };
  }

  // -------------------------------------------------------------------------
  // Home

  home(): HomeData {
    const take = (where: string, order: string, limit: number, params: SqlValue[] = []) =>
      this.db.all<Row>(`${SELECT_MEDIA} WHERE m.missing = 0 AND ${where} ORDER BY ${order} LIMIT ${limit}`, params).map(mapMedia);

    const inProgress = take(
      "m.kind = 'video' AND COALESCE(s.completed, 0) = 0 AND s.position > 10 AND s.last_played_at IS NOT NULL",
      's.last_played_at DESC', 20
    );
    // "Up next": the episode after the most recently completed one, per series.
    const upNext: MediaItem[] = [];
    const recentEpisodes = this.db.all<Row>(
      `SELECT m.id, m.series_key, m.season, m.episode, m.dir, m.path FROM media m JOIN state s ON s.media_id = m.id
       WHERE m.kind = 'video' AND m.vclass = 'episode' AND s.completed = 1 AND m.missing = 0 AND m.series_key IS NOT NULL
       ORDER BY s.last_played_at DESC LIMIT 60`
    );
    const seenSeries = new Set<string>(inProgress.map((m) => m.series?.toLowerCase()).filter((x): x is string => !!x));
    for (const r of recentEpisodes) {
      const key = str(r.series_key);
      if (seenSeries.has(key)) continue;
      seenSeries.add(key);
      const next = this.db.get<Row>(
        `${SELECT_MEDIA} WHERE m.kind = 'video' AND m.vclass = 'episode' AND m.series_key = ? AND m.missing = 0
           AND COALESCE(s.completed, 0) = 0 AND (COALESCE(m.season, 0) > ? OR (COALESCE(m.season, 0) = ? AND COALESCE(m.episode, 0) > ?))
         ORDER BY COALESCE(m.season, 0), COALESCE(m.episode, 0) LIMIT 1`,
        [key, num(r.season), num(r.season), num(r.episode)]
      );
      if (next) upNext.push(mapMedia(next));
      if (upNext.length >= 10) break;
    }
    const continueWatching = [...inProgress, ...upNext].slice(0, 24);

    const continueReading = take(
      "m.kind IN ('comic','book') AND COALESCE(s.completed, 0) = 0 AND COALESCE(s.progress, 0) > 0 AND s.last_played_at IS NOT NULL",
      's.last_played_at DESC', 20
    );
    const recentVideos = take("m.kind = 'video' AND (m.vclass != 'episode' OR m.vclass IS NULL)", 'm.added_at DESC', 24);
    const recentEpisodes2 = take("m.kind = 'video' AND m.vclass = 'episode'", 'm.added_at DESC', 12);
    const recentAlbums = this.albums({ sort: 'added', desc: true, limit: 24 }).items;
    const recentlyPlayedMusic = take("m.kind = 'audio' AND s.last_played_at IS NOT NULL", 's.last_played_at DESC', 24);
    const recentComics = take("m.kind IN ('comic','book')", 'm.added_at DESC', 20);
    const favorites = take('s.favorite = 1', 's.last_played_at DESC NULLS LAST, m.added_at DESC', 24);
    const counts = { video: 0, audio: 0, image: 0, comic: 0, book: 0 } as Record<MediaKind, number>;
    for (const r of this.db.all<Row>('SELECT kind, COUNT(*) AS n FROM media WHERE missing = 0 GROUP BY kind')) counts[r.kind as MediaKind] = num(r.n);
    // Fold recent episodes into the video shelf, interleaved by date.
    const videos = [...recentVideos, ...recentEpisodes2].sort((a, b) => b.addedAt - a.addedAt).slice(0, 24);
    return { continueWatching, continueReading, recentVideos: videos, recentAlbums, recentlyPlayedMusic, recentComics, favorites, counts };
  }

  // -------------------------------------------------------------------------
  // Search

  search(text: string): SearchResults {
    const t = text.trim();
    if (!t) return { media: [], albums: [], series: [], artists: [] };
    const fts = ftsQuery(t);
    const media = fts
      ? this.db
          .all<Row>(
            `${SELECT_MEDIA} JOIN media_fts f ON f.rowid = m.id WHERE media_fts MATCH ? AND m.missing = 0 AND m.kind != 'image' ORDER BY bm25(media_fts, 8, 4, 4, 6, 2, 1, 1) LIMIT 40`,
            [fts]
          )
          .map(mapMedia)
      : this.query({ text: t, limit: 40 }).items;
    const albums = this.albums({ text: t, limit: 12 }).items;
    const shows = this.series({ type: 'show', text: t }).items.slice(0, 8);
    const comics = this.series({ type: 'comic', text: t }).items.slice(0, 8);
    const artists = this.artists(t).items.slice(0, 8);
    return { media, albums, series: [...shows, ...comics], artists };
  }

  // -------------------------------------------------------------------------
  // Playback neighbours

  siblings(id: number): Siblings {
    const cur = this.get(id);
    if (!cur) return { prev: null, next: null };
    let rows: MediaItem[];
    if (cur.kind === 'video' && cur.vclass === 'episode' && cur.series) {
      rows = this.query({ kind: 'video', series: cur.series.toLowerCase(), sort: 'episode' }).items;
    } else if (cur.kind === 'comic' && cur.series) {
      rows = this.query({ kind: 'comic', series: cur.series.toLowerCase() }).items.sort(compareComic);
    } else {
      rows = this.query({ dir: cur.dir, kind: cur.kind, sort: 'name' }).items;
    }
    const i = rows.findIndex((r) => r.id === id);
    return { prev: i > 0 ? rows[i - 1]! : null, next: i >= 0 && i < rows.length - 1 ? rows[i + 1]! : null };
  }

  // -------------------------------------------------------------------------
  // State

  private ensureState(id: number): void {
    this.db.run('INSERT OR IGNORE INTO state (media_id) VALUES (?)', [id]);
  }

  updateState(id: number, patch: UserStatePatch): void {
    this.db.tx(() => {
      this.ensureState(id);
      if (patch.favorite !== undefined) this.db.run('UPDATE state SET favorite = ? WHERE media_id = ?', [patch.favorite ? 1 : 0, id]);
      if (patch.rating !== undefined) this.db.run('UPDATE state SET rating = ? WHERE media_id = ?', [Math.max(0, Math.min(5, Math.round(patch.rating))), id]);
      if (patch.notes !== undefined) this.db.run('UPDATE state SET notes = ? WHERE media_id = ?', [patch.notes.slice(0, 20000), id]);
      if (patch.reset) {
        this.db.run('UPDATE state SET position = 0, progress = 0, completed = 0, completed_at = NULL, location = NULL WHERE media_id = ?', [id]);
      }
      if (patch.completed !== undefined) {
        if (patch.completed) {
          this.db.run(
            `UPDATE state SET completed = 1, completed_at = ?, position = 0, progress = 1, last_played_at = COALESCE(last_played_at, ?),
                    play_count = CASE WHEN play_count = 0 THEN 1 ELSE play_count END WHERE media_id = ?`,
            [Date.now(), Date.now(), id]
          );
        } else {
          this.db.run('UPDATE state SET completed = 0, completed_at = NULL, position = 0, progress = 0 WHERE media_id = ?', [id]);
        }
      }
    });
  }

  setProgress(u: ProgressUpdate): void {
    this.db.tx(() => {
      this.ensureState(u.mediaId);
      const now = Date.now();
      const sets = ['last_played_at = ?'];
      const vals: SqlValue[] = [now];
      if (u.positionSec !== undefined) { sets.push('position = ?'); vals.push(u.positionSec); }
      if (u.location !== undefined) { sets.push('location = ?'); vals.push(u.location); }
      if (u.progress !== undefined) { sets.push('progress = ?'); vals.push(Math.max(0, Math.min(1, u.progress))); }
      if (u.completed !== undefined) {
        const was = this.db.get<Row>('SELECT completed FROM state WHERE media_id = ?', [u.mediaId]);
        sets.push('completed = ?');
        vals.push(u.completed ? 1 : 0);
        if (u.completed && num(was?.completed) !== 1) {
          sets.push('completed_at = ?', 'play_count = play_count + 1');
          vals.push(now);
        }
        if (!u.completed) sets.push('completed_at = NULL');
      }
      this.db.run(`UPDATE state SET ${sets.join(', ')} WHERE media_id = ?`, [...vals, u.mediaId]);
    });
  }

  markMany(ids: number[], completed: boolean): void {
    this.db.tx(() => {
      for (const id of ids) this.updateState(id, { completed });
    });
  }

  getPlaybackPrefs(id: number): { speed: number | null; audioIndex: number | null; subtitleId: string | null; subtitleDelay: number | null } {
    const r = this.db.get<Row>('SELECT speed, audio_index, subtitle_id, subtitle_delay FROM state WHERE media_id = ?', [id]);
    return { speed: nnum(r?.speed), audioIndex: nnum(r?.audio_index), subtitleId: nstr(r?.subtitle_id), subtitleDelay: nnum(r?.subtitle_delay) };
  }

  // -------------------------------------------------------------------------
  // History

  recordHistory(h: HistorySession): void {
    const media = this.getRow(h.mediaId);
    if (!media) return;
    const kind = str(media.kind);
    this.db.tx(() => {
      this.db.run(
        'INSERT INTO history (media_id, kind, started_at, watched_sec, media_sec, from_sec, to_sec, speed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [h.mediaId, kind, h.startedAt, Math.max(0, h.watchedSec), Math.max(0, h.mediaSec), h.fromSec, h.toSec, h.speed]
      );
      this.ensureState(h.mediaId);
      this.db.run('UPDATE state SET last_played_at = ? WHERE media_id = ?', [Date.now(), h.mediaId]);
      // A music play counts once a listener has stayed for 30 s or half the track.
      if (kind === 'audio') {
        const dur = num(media.duration);
        if (h.mediaSec >= Math.min(30, dur * 0.5)) this.db.run('UPDATE state SET play_count = play_count + 1 WHERE media_id = ?', [h.mediaId]);
      }
    });
  }

  recentlyPlayed(kinds: MediaKind[] | null, limit: number): MediaItem[] {
    const w = kinds && kinds.length ? `AND m.kind IN (${kinds.map(() => '?').join(',')})` : '';
    return this.db
      .all<Row>(`${SELECT_MEDIA} WHERE s.last_played_at IS NOT NULL AND m.missing = 0 ${w} ORDER BY s.last_played_at DESC LIMIT ${Math.floor(limit)}`, kinds ?? [])
      .map(mapMedia);
  }

  clearHistory(): void {
    this.db.tx(() => {
      this.db.run('DELETE FROM history');
      this.db.run('UPDATE state SET last_played_at = NULL, play_count = 0, position = 0, progress = 0, completed = 0, completed_at = NULL, location = NULL');
    });
  }

  // -------------------------------------------------------------------------
  // Maintenance

  mediaCount(): number {
    return num(this.db.get<Row>('SELECT COUNT(*) AS n FROM media WHERE missing = 0')?.n);
  }

  playbackPrefsUpdate(id: number, p: { speed?: number | null; audioIndex?: number | null; subtitleId?: string | null; subtitleDelay?: number | null }): void {
    this.db.tx(() => {
      this.ensureState(id);
      if (p.speed !== undefined) this.db.run('UPDATE state SET speed = ? WHERE media_id = ?', [p.speed, id]);
      if (p.audioIndex !== undefined) this.db.run('UPDATE state SET audio_index = ? WHERE media_id = ?', [p.audioIndex, id]);
      if (p.subtitleId !== undefined) this.db.run('UPDATE state SET subtitle_id = ? WHERE media_id = ?', [p.subtitleId, id]);
      if (p.subtitleDelay !== undefined) this.db.run('UPDATE state SET subtitle_delay = ? WHERE media_id = ?', [p.subtitleDelay, id]);
    });
  }
}

export function compareComic(a: MediaItem, b: MediaItem): number {
  const av = a.season ?? 0, bv = b.season ?? 0;
  if (av !== bv) return av - bv;
  const ac = a.episode ?? 0, bc = b.episode ?? 0;
  if (ac !== bc) return ac - bc;
  return a.sortTitle.localeCompare(b.sortTitle);
}
