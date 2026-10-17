/** Library tidy-up: turns messy file names and folders into a consistent layout. Planning is pure; the main process applies it. */

export interface OrganiseOptions {
  rootId: number;
  movies: boolean;
  episodes: boolean;
  music: boolean;
  /** Put the parsed episode title in the file name ("Show - S01E02 - Title"). */
  episodeTitles: boolean;
  /** Prefer titles from a saved online match (Fix Match / metadata) over the parsed ones. */
  useOnlineTitles: boolean;
}

export const DEFAULT_ORGANISE: Omit<OrganiseOptions, 'rootId'> = { movies: true, episodes: true, music: true, episodeTitles: true, useOnlineTitles: false };

export type OrganiseStatus = 'move' | 'ok' | 'skip' | 'conflict';

export interface OrganiseEntry {
  id: number;
  /** Paths relative to the library folder, always with `/`. */
  from: string;
  to: string;
  status: OrganiseStatus;
  reason?: string;
  /** Subtitle / nfo files that share the file's name and travel with it. */
  sidecars: { from: string; to: string }[];
}

export interface OrganisePlan {
  rootId: number;
  rootPath: string;
  entries: OrganiseEntry[];
  counts: { move: number; ok: number; skip: number; conflict: number };
}

export interface OrganiseResult { moved: number; failed: number; errors: string[]; journalId: string | null }

export interface OrganiseJournalInfo { id: string; at: number; rootId: number; rootName: string; moved: number; undone: boolean }

/** What the planner needs to know about one library file. */
export interface OrgRow {
  id: number; rel: string; kind: string; vclass: string | null; ext: string;
  title: string | null; series: string | null; season: number | null; episode: number | null; year: number | null;
  artist: string | null; albumArtist: string | null; album: string | null; trackNo: number | null; discNo: number | null;
  onlineTitle?: string | null; onlineYear?: number | null; onlineSeries?: string | null;
}

const BAD = /[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** Make a string safe as one path segment on Windows, macOS and Linux. */
export function safeName(s: string, fallback = 'Untitled'): string {
  let o = s.replace(BAD, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').replace(/^\.+/, '').trim();
  if (o.length > 120) o = o.slice(0, 120).trim();
  if (!o) return fallback;
  if (RESERVED.test(o.split('.')[0]!)) o = `${o}_`;
  return o;
}

const pad = (n: number, w = 2) => String(Math.max(0, Math.trunc(n))).padStart(w, '0');
const dirOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const stemOf = (rel: string) => { const b = rel.slice(rel.lastIndexOf('/') + 1); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(0, i) : b; };
const join = (...p: string[]) => p.filter(Boolean).join('/');

/** The most common spelling wins, so "the expanse"/"The Expanse" end up in one folder. */
function canon(values: (string | null | undefined)[]): Map<string, string> {
  const tally = new Map<string, Map<string, number>>();
  for (const v of values) {
    if (!v) continue;
    const k = v.toLowerCase();
    const m = tally.get(k) ?? new Map<string, number>();
    m.set(v, (m.get(v) ?? 0) + 1);
    tally.set(k, m);
  }
  const out = new Map<string, string>();
  for (const [k, m] of tally) {
    out.set(k, [...m.entries()].sort((a, b) => b[1] - a[1] || Number(/[A-Z]/.test(b[0])) - Number(/[A-Z]/.test(a[0])))[0]![0]);
  }
  return out;
}

export function targetFor(r: OrgRow, o: OrganiseOptions, names: { series: Map<string, string>; album: Map<string, string>; artist: Map<string, string> }): { to: string } | { skip: string } | null {
  const ext = r.ext ? `.${r.ext.replace(/^\./, '').toLowerCase()}` : '';
  if (r.kind === 'video' && r.vclass === 'movie') {
    if (!o.movies) return null;
    const title = (o.useOnlineTitles && r.onlineTitle) || r.title;
    if (!title) return { skip: 'No title could be read' };
    const year = (o.useOnlineTitles && r.onlineYear) || r.year;
    const name = safeName(year ? `${title} (${year})` : title);
    return { to: join(name, name + ext) };
  }
  if (r.kind === 'video' && r.vclass === 'episode') {
    if (!o.episodes) return null;
    const raw = (o.useOnlineTitles && r.onlineSeries) || (r.series && names.series.get(r.series.toLowerCase())) || r.series;
    if (!raw) return { skip: 'No show name' };
    if (r.season == null || r.episode == null) return { skip: 'No season/episode number' };
    const show = safeName(raw);
    const code = `S${pad(r.season)}E${pad(r.episode)}`;
    const et = o.episodeTitles && r.title && r.title.toLowerCase() !== raw.toLowerCase() ? safeName(r.title, '') : '';
    const season = r.season === 0 ? 'Specials' : `Season ${pad(r.season)}`;
    return { to: join(show, season, `${show} - ${code}${et ? ` - ${et}` : ''}${ext}`) };
  }
  if (r.kind === 'audio') {
    if (!o.music) return null;
    const stem = stemOf(r.rel);
    const title = r.title || stem;
    const artistRaw = r.albumArtist || r.artist;
    const artist = safeName((artistRaw && names.artist.get(artistRaw.toLowerCase())) || artistRaw || 'Unknown Artist');
    const albumRaw = r.album && (names.album.get(r.album.toLowerCase()) || r.album);
    const album = safeName(albumRaw ? (r.year ? `${albumRaw} (${r.year})` : albumRaw) : 'Unknown Album');
    const multi = (r.discNo ?? 1) > 1;
    const num = r.trackNo ? `${multi ? `${r.discNo}-` : ''}${pad(r.trackNo)} - ` : '';
    return { to: join(artist, album, safeName(num + title) + ext) };
  }
  return null;
}

/** Build the plan. `siblings` lists every file path (relative) in the folder tree so sidecars can be found. `exists` tells whether a destination is already taken by something that is not being moved. */
export function buildPlan(rows: OrgRow[], o: OrganiseOptions, rootPath: string, siblings: string[], exists: (rel: string) => boolean): OrganisePlan {
  const names = {
    series: canon(rows.filter((r) => r.vclass === 'episode').map((r) => r.series)),
    album: canon(rows.filter((r) => r.kind === 'audio').map((r) => r.album)),
    artist: canon(rows.filter((r) => r.kind === 'audio').map((r) => r.albumArtist || r.artist))
  };
  const sidecarsByDir = new Map<string, string[]>();
  for (const s of siblings) { const d = dirOf(s); const l = sidecarsByDir.get(d) ?? []; l.push(s); sidecarsByDir.set(d, l); }
  const media = new Set(rows.map((r) => r.rel.toLowerCase()));
  const sources = new Set<string>();
  const entries: OrganiseEntry[] = [];

  for (const r of rows) {
    const t = targetFor(r, o, names);
    if (!t) continue;
    if ('skip' in t) { entries.push({ id: r.id, from: r.rel, to: r.rel, status: 'skip', reason: t.skip, sidecars: [] }); continue; }
    const stem = stemOf(r.rel);
    const toStem = stemOf(t.to);
    const sidecars = (sidecarsByDir.get(dirOf(r.rel)) ?? [])
      .filter((s) => s !== r.rel && !media.has(s.toLowerCase()) && (stemOf(s) === stem || stemOf(s).startsWith(stem + '.')))
      .map((s) => ({ from: s, to: join(dirOf(t.to), toStem + s.slice(dirOf(r.rel) ? dirOf(r.rel).length + 1 + stem.length : stem.length)) }));
    const same = t.to === r.rel;
    entries.push({ id: r.id, from: r.rel, to: t.to, status: same ? 'ok' : 'move', sidecars: same ? [] : sidecars });
    sources.add(r.rel.toLowerCase());
    for (const c of sidecars) sources.add(c.from.toLowerCase());
  }

  // Collisions: two files to one name, or a name already taken by something staying put.
  const claimed = new Map<string, OrganiseEntry>();
  for (const e of entries) {
    if (e.status !== 'move') { if (e.status === 'ok') claimed.set(e.to.toLowerCase(), e); continue; }
  }
  for (const e of entries) {
    if (e.status !== 'move') continue;
    const targets = [e.to, ...e.sidecars.map((s) => s.to)];
    let why: string | null = null;
    for (const t of targets) {
      const k = t.toLowerCase();
      if (claimed.has(k)) { why = 'Another file already goes to this name'; break; }
      if (!sources.has(k) && exists(t)) { why = 'A file with this name already exists'; break; }
    }
    if (why) { e.status = 'conflict'; e.reason = why; continue; }
    for (const t of targets) claimed.set(t.toLowerCase(), e);
  }
  const counts = { move: 0, ok: 0, skip: 0, conflict: 0 };
  for (const e of entries) counts[e.status]++;
  entries.sort((a, b) => (a.status === b.status ? a.from.localeCompare(b.from) : order(a.status) - order(b.status)));
  return { rootId: o.rootId, rootPath, entries, counts };
}
const order = (s: OrganiseStatus) => ({ move: 0, conflict: 1, skip: 2, ok: 3 })[s];
