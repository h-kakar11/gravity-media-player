import type { VideoClass } from './types';

/**
 * Filename / folder heuristics used when a file has no usable tags or .nfo.
 * Pure functions so they can be unit-tested without a file system.
 */

const TECH_TOKENS = [
  '2160p', '1080p', '1080i', '720p', '576p', '480p', '4k', 'uhd', 'bluray', 'blu-ray', 'bdrip',
  'brrip', 'bdremux', 'remux', 'webrip', 'web-dl', 'webdl', 'web', 'hdtv', 'pdtv', 'dvdrip',
  'dvdscr', 'hdrip', 'x264', 'x265', 'h264', 'h265', 'h.264', 'h.265', 'hevc', 'avc', 'av1', 'xvid',
  'divx', 'aac', 'ac3', 'eac3', 'dts', 'dts-hd', 'truehd', 'atmos', 'ddp5', 'dd5', 'flac', 'hdr',
  'hdr10', 'hdr10plus', 'dv', 'dolby', 'vision', '10bit', '8bit', 'proper', 'repack', 'extended',
  'unrated', 'remastered', 'imax', 'multi', 'dual', 'subbed', 'dubbed', 'internal', 'limited', 'amzn', 'nf',
  'dsnp', 'hmax', 'atvp'
];
const TECH_RE = new RegExp(`(?:^|[\\s._\\-\\[(])(?:${TECH_TOKENS.map(escapeRe).join('|')})(?=$|[\\s._\\-\\])])`, 'i');

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface ParsedVideoName {
  title: string;
  year: number | null;
  series: string | null;
  season: number | null;
  episode: number | null;
  episodeEnd: number | null;
  episodeTitle: string | null;
  isEpisode: boolean;
}

/** Replace dot/underscore separators by spaces when the name uses them as word breaks. */
export function dePunctuate(s: string): string {
  let out = s.trim();
  const spaces = (out.match(/ /g) ?? []).length;
  const seps = (out.match(/[._]/g) ?? []).length;
  if (seps > spaces) out = out.replace(/[._]+/g, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

function stripBrackets(s: string): string {
  return s.replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ');
}

function cutAtTechToken(s: string): string {
  const m = TECH_RE.exec(s);
  return m ? s.slice(0, m.index) : s;
}

function cleanTitle(s: string): string {
  return dePunctuate(s)
    .replace(/\(\s*\)/g, '')
    .replace(/^[\s\-–—:,.]+|[\s\-–—:,.(]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Find a plausible release year in `s`, preferring parenthesised years. Returns [year, indexOfMatch]. */
export function findYear(s: string): [number, number] | null {
  const paren = /[([](19[2-9]\d|20[0-4]\d)[)\]]/g;
  let m: RegExpExecArray | null;
  let last: [number, number] | null = null;
  while ((m = paren.exec(s))) last = [Number(m[1]), m.index];
  if (last) return last;
  // Bare year: only accept when it is delimited and not the whole title.
  const bare = /(?:^|[\s._-])(19[2-9]\d|20[0-4]\d)(?=$|[\s._-])/g;
  while ((m = bare.exec(s))) {
    const idx = m.index + (m[0].length - m[1].length);
    if (idx > 0) last = [Number(m[1]), idx];
  }
  return last;
}

const SXXEXX = /(?:^|[^a-z0-9])s(\d{1,2})[ ._-]?e(\d{1,3})(?:[ ._-]?(?:-|e|-e)[ ._-]?(\d{1,3}))?(?![a-z0-9]*\d{3})/i;
const NXNN = /(?:^|[^a-z0-9])(\d{1,2})x(\d{2,3})(?![0-9]|p\b)/i;
const SEASON_DIR = /^(?:season|series|staffel|saison|temporada|s)[ ._-]*(\d{1,2})(?:\b|$)/i;
const SPECIALS_DIR = /^(?:specials?|extras?)$/i;
const EP_WORD = /(?:^|[^a-z0-9])(?:episode|ep|e)[ ._-]?(\d{1,3})(?![0-9])/i;
const ANIME = /^\s*(?:\[[^\]]+\]\s*)?(.+?)\s+-\s+(\d{1,3})(?:v\d)?(?:\s|\.|\[|\(|$)/;
const LEADING_NUM = /^\s*(\d{1,3})\s*(?:[-.)_]|\s)\s*(.*)$/;

/**
 * Parse a video file name (without extension) in the context of its parent folders.
 * `dirs` is ordered nearest-first: [parent, grandparent, ...].
 */
export function parseVideoName(baseName: string, dirs: string[] = []): ParsedVideoName {
  const raw = baseName;
  const noBrackets = stripBrackets(raw);

  let season: number | null = null;
  let episode: number | null = null;
  let episodeEnd: number | null = null;
  let seriesPart: string | null = null;
  let tail = '';

  let m = SXXEXX.exec(noBrackets) ?? NXNN.exec(noBrackets);
  if (m) {
    season = Number(m[1]);
    episode = Number(m[2]);
    episodeEnd = m[3] ? Number(m[3]) : null;
    seriesPart = noBrackets.slice(0, m.index);
    tail = noBrackets.slice(m.index + m[0].length);
  } else {
    // Season folder + loose episode number ("Show/Season 2/05 - Title.mkv").
    const seasonDirIdx = dirs.findIndex((d) => SEASON_DIR.test(d.trim()) || SPECIALS_DIR.test(d.trim()));
    if (seasonDirIdx >= 0) {
      const sd = dirs[seasonDirIdx]!.trim();
      const sm = SEASON_DIR.exec(sd);
      season = sm ? Number(sm[1]) : 0;
      const em = EP_WORD.exec(noBrackets);
      const lm = LEADING_NUM.exec(cutAtTechToken(noBrackets));
      if (em) {
        episode = Number(em[1]);
        tail = noBrackets.slice(em.index + em[0].length);
        seriesPart = noBrackets.slice(0, em.index);
      } else if (lm) {
        episode = Number(lm[1]);
        tail = lm[2] ?? '';
        seriesPart = '';
      }
      if (episode != null && !(seriesPart && cleanTitle(seriesPart))) {
        seriesPart = dirs[seasonDirIdx + 1] ?? null;
      }
    } else {
      const am = ANIME.exec(raw);
      if (am && (/^\s*\[/.test(raw) || /\[\d{3,4}p|\[[A-F0-9]{8}\]/i.test(raw))) {
        season = 1;
        episode = Number(am[2]);
        seriesPart = am[1] ?? '';
      }
    }
  }

  if (episode != null) {
    let series = seriesPart != null ? cleanTitle(cutAtTechToken(seriesPart)) : '';
    if (!series) series = cleanTitle(dirs.find((d) => !SEASON_DIR.test(d.trim()) && !SPECIALS_DIR.test(d.trim())) ?? '');
    const yearInSeries = findYear(series);
    let year: number | null = null;
    if (yearInSeries) {
      year = yearInSeries[0];
      series = cleanTitle(series.slice(0, yearInSeries[1]));
    }
    const epTitle = cleanTitle(cutAtTechToken(tail).replace(/^[\s\-–—._]+/, '')) || null;
    return {
      title: epTitle ?? `Episode ${episode}`,
      year,
      series: series || null,
      season: season ?? 1,
      episode,
      episodeEnd,
      episodeTitle: epTitle,
      isEpisode: true
    };
  }

  // Movie / generic video.
  const base = cutAtTechToken(noBrackets);
  const y = findYear(base) ?? findYear(noBrackets);
  let titlePart = base;
  let year: number | null = null;
  if (y) {
    year = y[0];
    const before = noBrackets.slice(0, y[1]);
    if (cleanTitle(cutAtTechToken(before))) titlePart = cutAtTechToken(before);
  }
  let title = cleanTitle(titlePart);
  if (!title) title = cleanTitle(noBrackets) || cleanTitle(raw) || raw;
  if (year == null) {
    // "Movies/Title (2019)/title.mkv" — the folder often carries the year.
    const dirYear = dirs[0] ? findYear(dirs[0]) : null;
    if (dirYear) year = dirYear[0];
  }
  return { title, year, series: null, season: null, episode: null, episodeEnd: null, episodeTitle: null, isEpisode: false };
}

/** Movies need a year or feature length; short year-less files are treated as clips. */
export function classifyVideo(parsed: ParsedVideoName, durationSec: number): VideoClass {
  if (parsed.isEpisode) return 'episode';
  if (parsed.year != null) return 'movie';
  if (durationSec >= 40 * 60) return 'movie';
  return 'clip';
}

// ---------------------------------------------------------------------------
// Music

export interface ParsedTrackName {
  trackNo: number | null;
  discNo: number | null;
  artist: string | null;
  title: string;
}

/** "01 - Title", "1-05 Title", "Artist - Title", "03. Title" */
export function parseTrackName(baseName: string): ParsedTrackName {
  let s = dePunctuate(baseName);
  let trackNo: number | null = null;
  let discNo: number | null = null;
  const disc = /^(\d{1,2})[-.](\d{1,3})\s*[-.)]?\s+(.+)$/.exec(s);
  if (disc) {
    discNo = Number(disc[1]);
    trackNo = Number(disc[2]);
    s = disc[3]!;
  } else {
    const lead = /^(\d{1,3})\s*(?:[-.)]|\s)\s*(.+)$/.exec(s);
    if (lead && lead[2] && !/^\d+$/.test(lead[2])) {
      trackNo = Number(lead[1]);
      s = lead[2];
    }
  }
  let artist: string | null = null;
  const parts = s.split(/\s+-\s+/);
  if (parts.length === 2 && parts[0]!.length <= 60) {
    artist = parts[0]!.trim();
    s = parts[1]!.trim();
  }
  return { trackNo, discNo, artist, title: s || baseName };
}

// ---------------------------------------------------------------------------
// Comics / manga

export interface ParsedComicName {
  series: string;
  volume: number | null;
  chapter: number | null;
  title: string;
}

const VOL_RE = /(?:^|[\s._\-([])(?:vol(?:ume)?\.?|v)[\s._-]*(\d{1,3}(?:\.\d)?)(?![0-9a-z])/i;
const CH_RE = /(?:^|[\s._\-([])(?:ch(?:apter)?\.?|c)[\s._-]*(\d{1,4}(?:\.\d)?)(?![0-9a-z])/i;
const TRAILING_NUM = /^(.*?)[\s._-]+(\d{1,4})$/;

export function parseComicName(baseName: string, parentDir: string | null): ParsedComicName {
  const noBr = stripBrackets(baseName).replace(/\([^)]*\)/g, ' ');
  const vm = VOL_RE.exec(noBr);
  const cm = CH_RE.exec(noBr);
  let seriesPart = noBr;
  const cut = Math.min(vm ? vm.index : Infinity, cm ? cm.index : Infinity);
  if (Number.isFinite(cut)) seriesPart = noBr.slice(0, cut);
  let series = cleanTitle(seriesPart);
  let volume = vm ? Number(vm[1]) : null;
  let chapter = cm ? Number(cm[1]) : null;
  if (volume == null && chapter == null) {
    const t = TRAILING_NUM.exec(cleanTitle(noBr));
    if (t) {
      series = cleanTitle(t[1]!);
      volume = Number(t[2]);
    }
  }
  if (!series && parentDir) series = cleanTitle(parentDir);
  const title = cleanTitle(noBr) || baseName;
  return { series: series || cleanTitle(parentDir ?? '') || title, volume, chapter, title };
}

/** Does this list of file names look like numbered comic pages? */
export function looksLikeComicPages(names: string[]): boolean {
  if (names.length < 5) return false;
  const numbered = names.filter((n) => /(^|[^0-9])\d{1,4}(?=[^0-9]*$)/.test(n.replace(/\.[^.]+$/, '')));
  return numbered.length / names.length >= 0.8;
}

// ---------------------------------------------------------------------------
// Sidecar artwork

const POSTER_NAMES = ['poster', 'folder', 'cover', 'front', 'thumb', 'albumart', 'albumartsmall', 'movie', 'show'];

/**
 * Pick the best artwork file for a media file from the names present in its folder.
 * `siblings` are file names (not paths) in the same directory.
 */
export function pickSidecarArt(mediaBase: string, siblings: string[], isImageExt: (ext: string) => boolean): string | null {
  const lowerBase = mediaBase.toLowerCase();
  const imgs = siblings.filter((n) => {
    const i = n.lastIndexOf('.');
    return i > 0 && isImageExt(n.slice(i + 1));
  });
  const stem = (n: string) => n.slice(0, n.lastIndexOf('.')).toLowerCase();
  // 1) <media>-poster.jpg / <media>.jpg / <media>-thumb.jpg
  const exact = imgs.find((n) => {
    const s = stem(n);
    return s === lowerBase || s === `${lowerBase}-poster` || s === `${lowerBase}-thumb` || s === `${lowerBase}-cover` || s === `${lowerBase}.poster`;
  });
  if (exact) return exact;
  // 2) folder-level poster
  for (const p of POSTER_NAMES) {
    const hit = imgs.find((n) => stem(n) === p);
    if (hit) return hit;
  }
  return null;
}
