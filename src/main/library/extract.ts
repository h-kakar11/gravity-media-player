import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, sep } from 'node:path';
import { parseFile } from 'music-metadata';
import sharp from 'sharp';
import { IMAGE_EXTS } from '@shared/formats';
import { naturalCompare, sortKey } from '@shared/natural-sort';
import { classifyVideo, parseComicName, parseTrackName, parseVideoName, pickSidecarArt } from '@shared/parse-name';
import type { Settings } from '@shared/settings';
import type { MediaKind, RootType } from '@shared/types';
import type { AppPaths } from '../paths';
import type { Ffmpeg } from '../media/ffmpeg';
import { parseEpub } from '../readers/epub';
import { ZipArchive } from '../readers/zip';
import { logger } from '../log';
import { padDigits } from '../db/repo';
import { emptyFields, type MediaFields } from './types';
import { parseNfo } from './nfo';

const log = logger('extract');

export interface FileInfo {
  path: string;
  dir: string;
  name: string;
  ext: string;
  base: string;
  size: number;
  mtimeMs: number;
  ino: string | null;
  dev: string | null;
}

export interface ExtractContext {
  root: { id: number; path: string; type: RootType };
  settings: Settings;
  ffmpeg: Ffmpeg;
  paths: AppPaths;
  /** File names present in the file's directory (for sidecar art / nfo detection). */
  siblings: string[];
}

const isImageExt = (e: string) => (IMAGE_EXTS as readonly string[]).includes(e.toLowerCase());

const hash = (s: string | Buffer) => createHash('sha1').update(s).digest('hex').slice(0, 20);

/** Folder names between the root and the file, nearest first (max 3). */
export function relativeDirs(dir: string, rootPath: string): string[] {
  const rel = dir.startsWith(rootPath) ? dir.slice(rootPath.length).split(sep).filter(Boolean) : [dir.split(sep).pop() ?? ''];
  return rel.reverse().slice(0, 3);
}

async function sidecarArt(base: string, ctx: ExtractContext, dir: string): Promise<{ key: string; src: string } | null> {
  const pick = pickSidecarArt(base, ctx.siblings, isImageExt);
  if (!pick) return null;
  const full = join(dir, pick);
  try {
    const st = await stat(full);
    return { key: hash(`${full}|${st.mtimeMs}|${st.size}`), src: `file:${full}` };
  } catch {
    return null;
  }
}

async function saveCover(buf: Buffer, ext: string, ctx: ExtractContext): Promise<{ key: string; src: string }> {
  const key = hash(buf);
  const file = join(ctx.paths.artSrc, `${key}.${ext}`);
  if (!existsSync(file)) {
    await mkdir(ctx.paths.artSrc, { recursive: true });
    await writeFile(file, buf);
  }
  return { key, src: `file:${file}` };
}

function mimeToExt(mime: string | undefined): string {
  if (!mime) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('bmp')) return 'bmp';
  return 'jpg';
}

/** music-metadata reports human-readable codec names; normalise to ffprobe-style identifiers. */
export function audioCodecName(codec: string | undefined, ext: string): string {
  const c = (codec ?? '').toLowerCase();
  if (/layer 3|mp3/.test(c)) return 'mp3';
  if (/layer 2|mp2/.test(c)) return 'mp2';
  if (/flac/.test(c)) return 'flac';
  if (/alac|apple lossless/.test(c)) return 'alac';
  if (/aac|mpeg-4/.test(c)) return 'aac';
  if (/vorbis/.test(c)) return 'vorbis';
  if (/opus/.test(c)) return 'opus';
  if (/pcm|wav/.test(c)) return 'pcm';
  if (/wma|windows media/.test(c)) return 'wma';
  if (/monkey|ape/.test(c)) return 'ape';
  if (/wavpack/.test(c)) return 'wavpack';
  if (/dsd/.test(c)) return 'dsd';
  return c || ext;
}

function genreString(list: string[] | undefined): string | null {
  if (!list || list.length === 0) return null;
  const g = [...new Set(list.flatMap((x) => x.split(/[;/]/)).map((x) => x.trim()).filter(Boolean))];
  return g.length ? g.join('; ') : null;
}

function base(file: FileInfo, kind: MediaKind, ctx: ExtractContext, title: string): MediaFields {
  const f = emptyFields({ rootId: ctx.root.id, path: file.path, dir: file.dir, fileName: file.name, ext: file.ext, kind, title, size: file.size, mtimeMs: file.mtimeMs });
  f.ino = file.ino;
  f.dev = file.dev;
  f.sortTitle = padDigits(sortKey(title));
  return f;
}

// ---------------------------------------------------------------------------

export async function extractVideo(file: FileInfo, ctx: ExtractContext): Promise<MediaFields> {
  const dirs = relativeDirs(file.dir, ctx.root.path);
  const parsed = parseVideoName(file.base, dirs);
  const f = base(file, 'video', ctx, parsed.title);
  f.container = file.ext;
  let tags: Record<string, string> = {};
  let attachedPic = -1;
  try {
    const { info, raw } = await ctx.ffmpeg.probe(file.path);
    const v = info.streams.find((s) => s.type === 'video' && !s.attachedPic);
    const audio = info.streams.filter((s) => s.type === 'audio');
    f.durationSec = info.durationSec;
    f.bitrate = info.bitrate;
    f.width = v?.width ?? 0;
    f.height = v?.height ?? 0;
    f.fps = v?.fps ?? 0;
    f.vcodec = v?.codec ?? '';
    f.bitDepth = v?.bitDepth ?? 0;
    f.hdr = !!v && (v.colorTransfer === 'smpte2084' || v.colorTransfer === 'arib-std-b67');
    f.acodec = audio[0]?.codec ?? '';
    f.channels = audio[0]?.channels ?? 0;
    f.sampleRate = audio[0]?.sampleRate ?? 0;
    f.audioTracks = audio.length;
    f.subTracks = info.streams.filter((s) => s.type === 'subtitle').length;
    f.probeJson = raw;
    attachedPic = info.streams.find((s) => s.attachedPic)?.index ?? -1;
    tags = ((JSON.parse(raw) as { format?: { tags?: Record<string, string> } }).format?.tags) ?? {};
    // Rotation swaps the displayed dimensions.
    if (v && (v.rotation === 90 || v.rotation === 270)) [f.width, f.height] = [f.height, f.width];
  } catch (err) {
    log.warn(`ffprobe failed for ${file.path}:`, (err as Error).message);
  }

  f.year = parsed.year;
  f.series = parsed.series;
  f.season = parsed.season;
  f.episode = parsed.episode;
  const lower = Object.fromEntries(Object.entries(tags).map(([k, v]) => [k.toLowerCase(), v]));
  const tagYear = parseInt(String(lower.date ?? lower.year ?? '').slice(0, 4), 10);
  if (f.year == null && tagYear > 1900 && tagYear < 2100) f.year = tagYear;
  f.genre = genreString(lower.genre ? String(lower.genre).split(/[;,]/) : undefined);
  f.plot = lower.synopsis || lower.description || lower.comment || null;
  if (f.plot && f.plot.length > 4000) f.plot = f.plot.slice(0, 4000);

  if (ctx.settings.library.useNfo) {
    const nfoName = ctx.siblings.find((n) => n.toLowerCase() === `${file.base.toLowerCase()}.nfo`) ?? ctx.siblings.find((n) => n.toLowerCase() === 'movie.nfo');
    if (nfoName) {
      try {
        const nfo = parseNfo(await readFile(join(file.dir, nfoName), 'utf8'));
        if (nfo) {
          if (nfo.title && !parsed.isEpisode) f.title = nfo.title;
          else if (nfo.title && parsed.isEpisode) f.title = nfo.title;
          f.year = nfo.year ?? f.year;
          f.plot = nfo.plot ?? f.plot;
          if (nfo.genres?.length) f.genre = genreString(nfo.genres);
          if (nfo.showTitle) f.series = nfo.showTitle;
          if (nfo.season != null) f.season = nfo.season;
          if (nfo.episode != null) f.episode = nfo.episode;
          f.sortTitle = padDigits(sortKey(f.title));
        }
      } catch { /* unreadable nfo */ }
    }
  }

  f.vclass = classifyVideo(parsed, f.durationSec);
  if (f.vclass !== 'episode') { f.series = null; f.season = null; f.episode = null; }
  if (f.vclass === 'episode' && !f.title) f.title = `Episode ${f.episode ?? ''}`.trim();

  const side = await sidecarArt(file.base, ctx, file.dir);
  if (side) { f.artKey = side.key; f.artSrc = side.src; }
  else if (attachedPic >= 0) { f.artKey = hash(`${file.path}|${file.mtimeMs}|${file.size}|apic`); f.artSrc = `apic:${attachedPic}`; }
  else if (ctx.settings.library.frameArt && f.durationSec > 0 && f.width > 0) { f.artKey = hash(`${file.path}|${file.mtimeMs}|${file.size}|frame`); f.artSrc = 'frame'; }
  return f;
}

// ---------------------------------------------------------------------------

export async function extractAudio(file: FileInfo, ctx: ExtractContext): Promise<MediaFields> {
  const parsedName = parseTrackName(file.base);
  const dirs = relativeDirs(file.dir, ctx.root.path);
  const f = base(file, 'audio', ctx, parsedName.title);
  f.container = file.ext;
  let cover: { data: Uint8Array; format?: string } | undefined;
  try {
    const md = await parseFile(file.path, { duration: true, skipCovers: false, skipPostHeaders: true });
    const c = md.common;
    f.title = c.title?.trim() || parsedName.title;
    f.artist = c.artist?.trim() || c.artists?.[0]?.trim() || parsedName.artist || null;
    f.albumArtist = c.albumartist?.trim() || null;
    f.album = c.album?.trim() || null;
    f.trackNo = c.track?.no ?? parsedName.trackNo;
    f.discNo = c.disk?.no ?? parsedName.discNo;
    f.year = c.year ?? (c.date ? parseInt(c.date.slice(0, 4), 10) || null : null);
    f.genre = genreString(c.genre);
    f.durationSec = md.format.duration ?? 0;
    f.bitrate = Math.round(md.format.bitrate ?? 0);
    f.sampleRate = md.format.sampleRate ?? 0;
    f.channels = md.format.numberOfChannels ?? 0;
    f.bitDepth = md.format.bitsPerSample ?? 0;
    f.acodec = audioCodecName(md.format.codec ?? md.format.container, file.ext);
    f.replayGain = c.replaygain_track_gain?.dB ?? null;
    cover = c.picture?.find((p) => /front/i.test(p.type ?? '')) ?? c.picture?.[0];
  } catch (err) {
    log.warn(`Tag parse failed for ${file.path}:`, (err as Error).message);
    f.artist = parsedName.artist;
    f.trackNo = parsedName.trackNo;
    f.discNo = parsedName.discNo;
    if (ctx.settings.library.previews !== 'off') {
      try {
        const { info } = await ctx.ffmpeg.probe(file.path);
        f.durationSec = info.durationSec;
        f.acodec = info.streams.find((s) => s.type === 'audio')?.codec ?? '';
      } catch { /* unreadable */ }
    }
  }
  // Folder names stand in for missing tags (Artist/Album/track.mp3).
  if (!f.album) f.album = dirs[0] ?? null;
  if (!f.artist && !f.albumArtist && dirs.length >= 2) f.artist = dirs[1] ?? null;
  f.sortTitle = padDigits(sortKey(f.title));

  if (cover?.data?.length) {
    const saved = await saveCover(Buffer.from(cover.data), mimeToExt(cover.format), ctx);
    f.artKey = saved.key;
    f.artSrc = saved.src;
  } else {
    const side = await sidecarArt(file.base, ctx, file.dir);
    if (side) { f.artKey = side.key; f.artSrc = side.src; }
  }
  return f;
}

// ---------------------------------------------------------------------------

export async function extractImage(file: FileInfo, ctx: ExtractContext): Promise<MediaFields> {
  const f = base(file, 'image', ctx, file.base);
  f.container = file.ext;
  try {
    const meta = await sharp(file.path, { failOn: 'none' }).metadata();
    f.width = meta.width ?? 0;
    f.height = (meta.pageHeight ?? meta.height) ?? 0;
    f.pages = meta.pages ?? 1;
    if (meta.orientation && meta.orientation >= 5) [f.width, f.height] = [f.height, f.width];
  } catch { /* unsupported by sharp; viewer still shows it natively */ }
  f.artKey = hash(`${file.path}|${file.mtimeMs}|${file.size}`);
  f.artSrc = 'self';
  return f;
}

// ---------------------------------------------------------------------------

export function isComicPageName(name: string): boolean {
  return isImageExt(extname(name).slice(1)) && !/(^|\/)(__MACOSX|\.)/.test(name) && !/thumbs\.db$/i.test(name);
}

export async function extractComicArchive(file: FileInfo, ctx: ExtractContext): Promise<MediaFields> {
  const parent = basename(file.dir);
  const parsed = parseComicName(file.base, parent);
  const f = base(file, 'comic', ctx, parsed.title);
  f.container = file.ext;
  f.series = parsed.series;
  f.season = parsed.volume;
  f.episode = parsed.chapter;
  try {
    const zip = await ZipArchive.open(file.path);
    f.pages = zip.entries.filter((e) => isComicPageName(e.name)).length;
    zip.close();
  } catch (err) {
    log.warn(`Cannot open ${file.path}:`, (err as Error).message);
  }
  f.artKey = hash(`${file.path}|${file.mtimeMs}|${file.size}|comic`);
  f.artSrc = f.pages > 0 ? 'comic' : null;
  return f;
}

/** A folder of page images becomes one comic item. `images` are file names in `dir`. */
export async function extractComicFolder(dir: string, images: string[], dirStat: { mtimeMs: number; ino: string | null; dev: string | null }, totalSize: number, ctx: ExtractContext): Promise<MediaFields> {
  const parent = basename(join(dir, '..'));
  const name = basename(dir);
  const parsed = parseComicName(name, parent);
  const parentDir = join(dir, '..');
  const f = emptyFields({ rootId: ctx.root.id, path: dir, dir: parentDir, fileName: name, ext: '', kind: 'comic', title: parsed.title, size: totalSize, mtimeMs: dirStat.mtimeMs });
  f.ino = dirStat.ino;
  f.dev = dirStat.dev;
  f.sortTitle = padDigits(sortKey(parsed.title));
  f.series = parsed.series;
  f.season = parsed.volume;
  f.episode = parsed.chapter;
  f.pages = images.length;
  f.container = 'folder';
  f.artKey = hash(`${dir}|${dirStat.mtimeMs}|${images.length}|comic`);
  f.artSrc = 'comic';
  return f;
}

// ---------------------------------------------------------------------------

export async function extractBook(file: FileInfo, ctx: ExtractContext): Promise<MediaFields> {
  const f = base(file, 'book', ctx, file.base);
  f.container = file.ext;
  let zip: ZipArchive | null = null;
  try {
    zip = await ZipArchive.open(file.path);
    const epub = await parseEpub(zip);
    f.title = epub.title || file.base;
    f.sortTitle = padDigits(sortKey(f.title));
    f.artist = epub.author || null;
    f.plot = epub.description ? epub.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000) : null;
    f.pages = epub.spine.length;
    f.series = epub.series;
    f.episode = epub.seriesIndex;
    if (epub.coverPath && zip.find(epub.coverPath)) {
      const buf = await zip.read(epub.coverPath, 32 * 1024 * 1024);
      const saved = await saveCover(buf, extname(epub.coverPath).slice(1).toLowerCase() || 'jpg', ctx);
      f.artKey = saved.key;
      f.artSrc = saved.src;
    }
  } catch (err) {
    log.warn(`Cannot read EPUB ${file.path}:`, (err as Error).message);
  } finally {
    zip?.close();
  }
  return f;
}

export async function extract(kind: MediaKind, file: FileInfo, ctx: ExtractContext): Promise<MediaFields> {
  switch (kind) {
    case 'video': return extractVideo(file, ctx);
    case 'audio': return extractAudio(file, ctx);
    case 'image': return extractImage(file, ctx);
    case 'comic': return extractComicArchive(file, ctx);
    case 'book': return extractBook(file, ctx);
  }
}

export { naturalCompare };
