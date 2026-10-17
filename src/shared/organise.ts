/** Library tidy-up: turns messy file names and folders into a consistent layout. Planning is pure; the main process applies it. */
import { dePunctuate } from './parse-name';

/** Folder (inside each library folder) that holds everything the tidy-up removes. Never deleted automatically. */
export const BIN_NAME = 'Gravity Bin';

export interface OrganiseOptions {
  rootId: number;
  /** Movies and short clips. */
  movies: boolean;
  episodes: boolean;
  music: boolean;
  /** Put the parsed episode title in the file name ("Show - S01E02 - Title"). */
  episodeTitles: boolean;
  /** Prefer titles from a saved online match (Fix Match / metadata) over the parsed ones. */
  useOnlineTitles: boolean;
  /** Send duplicate copies, unfinished downloads and repeated artwork to the Gravity Bin. */
  duplicates: boolean;
}

export const DEFAULT_ORGANISE: Omit<OrganiseOptions, 'rootId'> = { movies: true, episodes: true, music: true, episodeTitles: true, useOnlineTitles: false, duplicates: true };

/** `bin` = goes to the Gravity Bin. */
export type OrganiseStatus = 'move' | 'bin' | 'ok' | 'skip' | 'conflict';

export interface OrganiseEntry {
  /** Library id of the file. Files the library does not track (artwork, unfinished downloads) get a negative id derived from their path. */
  id: number;
  /** Paths relative to the library folder, always with `/`. */
  from: string;
  to: string;
  status: OrganiseStatus;
  reason?: string;
  /** Subtitle / nfo / thumbnail files that share the file's name and travel with it. */
  sidecars: { from: string; to: string }[];
}

export interface OrganisePlan {
  rootId: number;
  rootPath: string;
  entries: OrganiseEntry[];
  counts: Record<OrganiseStatus, number>;
}

/** `moved` = files renamed or moved, `binned` = files sent to the Gravity Bin. */
export interface OrganiseResult { moved: number; binned: number; failed: number; errors: string[]; journalId: string | null }

export interface OrganiseJournalInfo { id: string; at: number; rootId: number; rootName: string; moved: number; binned: number; undone: boolean }

/** One thing in the Gravity Bin: a file plus the sidecars that went with it. */
export interface BinItem { id: string; name: string; from: string; reason: string; at: number; size: number; extras: number }

/** What the planner needs to know about one library file. */
export interface OrgRow {
  id: number; rel: string; kind: string; vclass: string | null; ext: string;
  title: string | null; series: string | null; season: number | null; episode: number | null; year: number | null;
  artist: string | null; albumArtist: string | null; album: string | null; trackNo: number | null; discNo: number | null;
  onlineTitle?: string | null; onlineYear?: number | null; onlineSeries?: string | null;
  /** Used to tell duplicates from different files and to pick the copy worth keeping. */
  size?: number | null; durationSec?: number | null; height?: number | null; audioTracks?: number | null;
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
const baseOf = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1);
const stemOf = (rel: string) => { const b = baseOf(rel); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(0, i) : b; };
const join = (...p: string[]) => p.filter(Boolean).join('/');

// ---------------------------------------------------------------------------
// Cleaning names that have no tags to go by (downloaded clips, untagged music)

const FORMAT_ID = /(?:\.f\d{2,4})+$/i;
const VIDEO_ID = /\s*\[(?=[\w-]*\d)(?=[\w-]*[a-z])[\w-]{11}\]$/i;
const JUNK_TAG = /\s*[([{]\s*(?:official\b[^)\]}]*|lyrics?(?:\s+video)?|(?:music\s+)?video|audio|visuali[sz]er|mv|hd|hq|4k)\s*[)\]}]/gi;
const INDEX_PREFIX = /^\s*(\d{1,3})\s*[-–.)_]+\s*(?=\D)/;

/**
 * "01 - Artist - Song (Official Video).f616" → "Artist - Song". Drops downloader format ids, video ids and
 * "(Official …)" decorations, folds fancy Unicode letters to plain ones and, when asked, the playlist position in front.
 */
export function cleanStem(stem: string, stripIndex = false): string {
  const folded = stem.normalize('NFKC');
  let s = dePunctuate(folded.replace(FORMAT_ID, '').replace(VIDEO_ID, '').replace(JUNK_TAG, ''));
  if (stripIndex) s = s.replace(INDEX_PREFIX, '');
  s = s.replace(/\s+/g, ' ').replace(/^[\s\-–_.]+|[\s\-–_]+$/g, '').trim();
  return s || folded.trim();
}

/** Folders where several files start with the same number ("01 - A", "01 - B"): those numbers are playlist positions, not track numbers. */
function noisyDirs(rows: OrgRow[]): Set<string> {
  const seen = new Map<string, number>();
  const noisy = new Set<string>();
  for (const r of rows) {
    if (!inPlace(r)) continue;
    const m = INDEX_PREFIX.exec(stemOf(r.rel));
    if (!m) continue;
    const key = `${dirOf(r.rel)}\u0000${Number(m[1])}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) noisy.add(dirOf(r.rel));
  }
  return noisy;
}

/** Files with nothing to build a layout from are cleaned up where they are. */
const inPlace = (r: OrgRow) => (r.kind === 'video' && r.vclass !== 'movie' && r.vclass !== 'episode') || (r.kind === 'audio' && !(r.albumArtist || r.artist));

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

interface Names { series: Map<string, string>; album: Map<string, string>; artist: Map<string, string>; noisy: Set<string> }

export function targetFor(r: OrgRow, o: OrganiseOptions, names: Names): { to: string; inPlace?: boolean } | { skip: string } | null {
  const ext = r.ext ? `.${r.ext.replace(/^\./, '').toLowerCase()}` : '';
  const here = () => ({ to: join(dirOf(r.rel), safeName(cleanStem(stemOf(r.rel), names.noisy.has(dirOf(r.rel))), stemOf(r.rel)) + ext), inPlace: true });
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
    if (r.season == null) return { skip: 'No season/episode number' };
    const show = safeName(raw);
    // "Episode 7" is only the parser's placeholder, not a title worth putting in a file name.
    const title = r.title && !/^episode \d+$/i.test(r.title) && r.title.toLowerCase() !== raw.toLowerCase() ? safeName(r.title, '') : '';
    if (r.episode == null) {
      // Unnumbered extras (openings, endings, OVAs) live in Specials under their own name.
      if (r.season !== 0 || !title) return { skip: 'No season/episode number' };
      // "Black Clover - Opening 1" is already prefixed with the show name; don't repeat it.
      const own = title.toLowerCase().startsWith(raw.toLowerCase()) ? title.slice(raw.length).replace(/^[\s\-–:._]+/, '') : title;
      return { to: join(show, 'Specials', `${show} - ${own || title}${ext}`) };
    }
    const code = `S${pad(r.season)}E${pad(r.episode)}`;
    const season = r.season === 0 ? 'Specials' : `Season ${pad(r.season)}`;
    return { to: join(show, season, `${show} - ${code}${o.episodeTitles && title ? ` - ${title}` : ''}${ext}`) };
  }
  if (r.kind === 'video') return o.movies ? here() : null;
  if (r.kind === 'audio') {
    if (!o.music) return null;
    const artistRaw = r.albumArtist || r.artist;
    if (!artistRaw) return here();
    const stem = stemOf(r.rel);
    const title = r.title || stem;
    const artist = safeName((names.artist.get(artistRaw.toLowerCase())) || artistRaw);
    const albumRaw = r.album && (names.album.get(r.album.toLowerCase()) || r.album);
    if (!albumRaw) return { to: join(artist, safeName(title) + ext) };
    const album = safeName(r.year ? `${albumRaw} (${r.year})` : albumRaw);
    const multi = (r.discNo ?? 1) > 1;
    const num = r.trackNo ? `${multi ? `${r.discNo}-` : ''}${pad(r.trackNo)} - ` : '';
    return { to: join(artist, album, safeName(num + title) + ext) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Planning

const PARTIAL = /\.(?:part|ytdl)$/i;
const LOOSE_ART = /\.(?:jpe?g|png|webp|tbn|nfo)$/i;
/** "-thumb", "-poster"… files named after a video, as media centres write them. */
const ART_SUFFIX = /^-(?:thumb|poster|fanart|banner|landscape|clearlogo|logo|backdrop)$/i;

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 16777619); } return h >>> 0; };

/** Same length (within a few seconds) or the very same size: two copies of one thing rather than two different files. */
function sameFile(a: OrgRow, b: OrgRow): boolean {
  if (a.size && a.size === b.size) return true;
  const x = a.durationSec ?? 0, y = b.durationSec ?? 0;
  return x > 0 && y > 0 && Math.abs(x - y) <= Math.max(3, 0.03 * Math.max(x, y));
}

const topOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '');

/**
 * Library folders that hold several titles ("anime", "music") are sections and keep their files inside them: "anime/Black Clover/…".
 * A top-level folder that only ever leads to one title is just that title's messy folder, so its files move up to the library folder.
 */
function sectionsOf(targets: [OrgRow, { to: string; inPlace?: boolean } | { skip: string }][]): Set<string> {
  const titles = new Map<string, Set<string>>();
  const settled = new Set<string>();
  for (const [r, t] of targets) {
    const top = topOf(r.rel);
    if (!top || 'skip' in t || t.inPlace) continue;
    const set = titles.get(top) ?? new Set<string>();
    set.add(t.to.split('/')[0]!.toLowerCase());
    titles.set(top, set);
    if (r.rel === join(top, t.to)) settled.add(top);
  }
  return new Set([...titles].filter(([top, set]) => set.size > 1 || settled.has(top)).map(([top]) => top));
}

/** Build the plan. `siblings` lists every file path (relative) in the folder tree so sidecars can be found. `exists` tells whether a destination is already taken by something that is not being moved. */
export function buildPlan(rows: OrgRow[], o: OrganiseOptions, rootPath: string, siblings: string[], exists: (rel: string) => boolean): OrganisePlan {
  const names: Names = {
    series: canon(rows.filter((r) => r.vclass === 'episode').map((r) => r.series)),
    album: canon(rows.filter((r) => r.kind === 'audio').map((r) => r.album)),
    artist: canon(rows.filter((r) => r.kind === 'audio').map((r) => r.albumArtist || r.artist)),
    noisy: noisyDirs(rows)
  };
  const filesByDir = new Map<string, string[]>();
  for (const s of siblings) { const d = dirOf(s); const l = filesByDir.get(d) ?? []; l.push(s); filesByDir.set(d, l); }
  const media = new Set(rows.map((r) => r.rel.toLowerCase()));
  const sources = new Set<string>();
  const entries: OrganiseEntry[] = [];
  const rowOf = new Map<number, OrgRow>();
  const found = new Map<number, string[]>();

  const targets: [OrgRow, NonNullable<ReturnType<typeof targetFor>>][] = [];
  for (const r of rows) { const t = targetFor(r, o, names); if (t) targets.push([r, t]); }
  const sections = sectionsOf(targets);
  /** The title folder each moved file ends up in, such as "anime/Black Clover". */
  const homeOf = new Map<number, string>();

  for (const [r, t0] of targets) {
    rowOf.set(r.id, r);
    if ('skip' in t0) { entries.push({ id: r.id, from: r.rel, to: r.rel, status: 'skip', reason: t0.skip, sidecars: [] }); continue; }
    const top = topOf(r.rel);
    const t = !t0.inPlace && top && sections.has(top) ? { to: join(top, t0.to) } : t0;
    if (!t0.inPlace) homeOf.set(r.id, t.to.split('/').slice(0, t === t0 ? 1 : 2).join('/'));
    const dir = dirOf(r.rel);
    const stem = stemOf(r.rel);
    const own = (filesByDir.get(dir) ?? []).filter((s) => {
      if (s === r.rel || media.has(s.toLowerCase()) || PARTIAL.test(s)) return false;
      const rest = stemOf(s).slice(stem.length);
      return stemOf(s).startsWith(stem) && (rest === '' || rest.startsWith('.') || ART_SUFFIX.test(rest));
    });
    found.set(r.id, own);
    const toStem = stemOf(t.to);
    const sidecars = own.map((s) => ({ from: s, to: join(dirOf(t.to), toStem + s.slice((dir ? dir.length + 1 : 0) + stem.length)) }));
    const same = t.to === r.rel;
    entries.push({ id: r.id, from: r.rel, to: t.to, status: same ? 'ok' : 'move', sidecars: same ? [] : sidecars });
    sources.add(r.rel.toLowerCase());
    for (const c of sidecars) sources.add(c.from.toLowerCase());
  }

  const toBin = (e: OrganiseEntry, reason: string) => {
    e.status = 'bin';
    e.reason = reason;
    e.to = join(BIN_NAME, e.from);
    e.sidecars = (found.get(e.id) ?? []).map((s) => ({ from: s, to: join(BIN_NAME, s) }));
  };

  // Duplicates: several files heading for one name. Keep the best copy, bin the others, but only when they really are the same thing.
  if (o.duplicates) {
    const groups = new Map<string, OrganiseEntry[]>();
    for (const e of entries) {
      if (e.status !== 'move' && e.status !== 'ok') continue;
      const k = e.to.toLowerCase();
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    const score = (e: OrganiseEntry) => { const r = rowOf.get(e.id)!; return [r.height ?? 0, r.audioTracks ?? 0, r.size ?? 0, e.status === 'ok' ? 1 : 0]; };
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      g.sort((a, b) => {
        const x = score(a), y = score(b);
        for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i]! - x[i]!;
        return a.from.localeCompare(b.from);
      });
      const keep = g[0]!;
      for (const e of g.slice(1)) if (sameFile(rowOf.get(keep.id)!, rowOf.get(e.id)!)) toBin(e, `Duplicate of ${keep.from}`);
    }
  }

  // Collisions: two files to one name, or a name already taken by something staying put.
  const claimed = new Map<string, OrganiseEntry>();
  for (const e of entries) if (e.status === 'ok') claimed.set(e.to.toLowerCase(), e);
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

  // Files the library does not track: unfinished downloads, and the artwork left behind when a folder empties out.
  const rowsPerDir = new Map<string, number>();
  for (const r of rows) rowsPerDir.set(dirOf(r.rel), (rowsPerDir.get(dirOf(r.rel)) ?? 0) + 1);
  const entriesByDir = new Map<string, OrganiseEntry[]>();
  for (const e of entries) entriesByDir.set(dirOf(e.from), [...(entriesByDir.get(dirOf(e.from)) ?? []), e]);
  const handled = new Set(sources);
  const used = new Set<number>();
  const extra = (from: string, to: string, status: 'move' | 'bin', reason?: string) => {
    let id = -1 - hash(from);
    while (used.has(id)) id--;
    used.add(id);
    handled.add(from.toLowerCase());
    entries.push({ id, from, to, status, reason, sidecars: [] });
  };
  if (o.duplicates) {
    for (const f of [...siblings].sort()) if (PARTIAL.test(f) && !handled.has(f.toLowerCase())) extra(f, join(BIN_NAME, f), 'bin', 'Unfinished download');
  }
  const taken = new Set<string>();
  for (const e of entries) if (e.status === 'move' || e.status === 'ok') for (const t of [e.to, ...e.sidecars.map((s) => s.to)]) taken.add(t.toLowerCase());
  for (const d of [...entriesByDir.keys()].sort()) {
    const list = entriesByDir.get(d)!;
    // Only a folder that is emptying out entirely has leftovers to take care of; never the library folder itself.
    if (!d || list.length !== rowsPerDir.get(d) || !list.every((e) => e.status === 'bin' || (e.status === 'move' && dirOf(e.to) !== d))) continue;
    const loose = (filesByDir.get(d) ?? []).filter((f) => !handled.has(f.toLowerCase())).sort();
    if (list.every((e) => e.status === 'bin')) {
      for (const f of loose) extra(f, join(BIN_NAME, f), 'bin', 'Left in a folder of duplicates');
      continue;
    }
    const homes = new Set(list.filter((e) => e.status === 'move').map((e) => homeOf.get(e.id) ?? e.to.split('/')[0]!));
    if (homes.size !== 1) continue;
    const home = [...homes][0]!;
    for (const f of loose) {
      if (!LOOSE_ART.test(f)) continue;
      const to = join(home, baseOf(f));
      const k = to.toLowerCase();
      if (k === f.toLowerCase()) continue;
      if (taken.has(k) || exists(to)) {
        if (o.duplicates) extra(f, join(BIN_NAME, f), 'bin', `“${home}” already has this artwork`);
        continue;
      }
      taken.add(k);
      extra(f, to, 'move');
    }
  }

  const counts: Record<OrganiseStatus, number> = { move: 0, bin: 0, ok: 0, skip: 0, conflict: 0 };
  for (const e of entries) counts[e.status]++;
  entries.sort((a, b) => (a.status === b.status ? a.from.localeCompare(b.from) : order(a.status) - order(b.status)));
  return { rootId: o.rootId, rootPath, entries, counts };
}
const order = (s: OrganiseStatus) => ({ move: 0, bin: 1, conflict: 2, skip: 3, ok: 4 })[s];
