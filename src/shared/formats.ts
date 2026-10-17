import type { MediaKind } from './types';

/** File extensions the library understands, grouped by the kind of media they produce. */
export const VIDEO_EXTS = [
  'mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'f4v', 'ts', 'm2ts', 'mts',
  'mpg', 'mpeg', 'vob', 'ogv', '3gp', '3g2', 'divx', 'asf', 'rm', 'rmvb', 'mxf'
] as const;

export const AUDIO_EXTS = [
  'mp3', 'flac', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'm4b', 'aac', 'wma', 'alac', 'aiff',
  'aif', 'ape', 'wv', 'mka', 'dsf', 'dff', 'mp2', 'amr', 'tta', 'mpc'
] as const;

export const IMAGE_EXTS = ['jpg', 'jpeg', 'jfif', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico', 'tif', 'tiff', 'apng'] as const;

/** Formats that hold comic/manga pages. CBZ is read natively; PDF pages are rendered on demand. */
export const COMIC_EXTS = ['cbz', 'pdf'] as const;

export const BOOK_EXTS = ['epub'] as const;

export const SUBTITLE_EXTS = ['srt', 'vtt', 'ass', 'ssa'] as const;

const kindByExt = new Map<string, MediaKind>();
for (const e of VIDEO_EXTS) kindByExt.set(e, 'video');
for (const e of AUDIO_EXTS) kindByExt.set(e, 'audio');
for (const e of IMAGE_EXTS) kindByExt.set(e, 'image');
for (const e of COMIC_EXTS) kindByExt.set(e, 'comic');
for (const e of BOOK_EXTS) kindByExt.set(e, 'book');

// `.ts` is both MPEG transport stream and TypeScript. Only treat it as video when it is
// a plausible media size; the scanner enforces this (see MIN_TS_BYTES).
export const MIN_TS_BYTES = 1024 * 1024;

export function extOf(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i <= 0 ? '' : fileName.slice(i + 1).toLowerCase();
}

export function kindOfExt(ext: string): MediaKind | null {
  return kindByExt.get(ext.toLowerCase()) ?? null;
}

export function isSubtitleExt(ext: string): boolean {
  return (SUBTITLE_EXTS as readonly string[]).includes(ext.toLowerCase());
}

/** Containers Chromium can demux directly. Everything else needs the ffmpeg path. */
export const NATIVE_VIDEO_CONTAINERS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv', '3gp']);
export const NATIVE_AUDIO_CONTAINERS = new Set(['mp3', 'flac', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'm4b', 'aac', 'mka']);

export function mimeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'mp4': case 'm4v': return 'video/mp4';
    case 'mov': return 'video/quicktime';
    case 'mkv': return 'video/x-matroska';
    case 'webm': return 'video/webm';
    case 'ogv': return 'video/ogg';
    case '3gp': return 'video/3gpp';
    case 'mp3': return 'audio/mpeg';
    case 'flac': return 'audio/flac';
    case 'wav': return 'audio/wav';
    case 'ogg': case 'oga': return 'audio/ogg';
    case 'opus': return 'audio/ogg; codecs=opus';
    case 'm4a': case 'm4b': return 'audio/mp4';
    case 'aac': return 'audio/aac';
    case 'mka': return 'audio/x-matroska';
    case 'jpg': case 'jpeg': case 'jfif': return 'image/jpeg';
    case 'png': case 'apng': return 'image/png';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'avif': return 'image/avif';
    case 'bmp': return 'image/bmp';
    case 'svg': return 'image/svg+xml';
    case 'ico': return 'image/x-icon';
    case 'tif': case 'tiff': return 'image/tiff';
    case 'vtt': return 'text/vtt; charset=utf-8';
    case 'srt': case 'ass': case 'ssa': return 'text/plain; charset=utf-8';
    case 'css': return 'text/css; charset=utf-8';
    case 'html': case 'htm': return 'text/html; charset=utf-8';
    case 'xhtml': return 'application/xhtml+xml; charset=utf-8';
    case 'js': return 'text/javascript; charset=utf-8';
    case 'json': return 'application/json; charset=utf-8';
    case 'woff': return 'font/woff';
    case 'woff2': return 'font/woff2';
    case 'ttf': return 'font/ttf';
    case 'otf': return 'font/otf';
    case 'xml': case 'opf': case 'ncx': return 'application/xml; charset=utf-8';
    default: return 'application/octet-stream';
  }
}
