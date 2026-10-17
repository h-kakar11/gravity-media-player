import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import { mimeForExt } from '@shared/formats';
import type { LibraryRepo } from './db/repo';
import type { ArtService } from './library/art';
import type { PlaybackService } from './media/playback-service';
import type { SpriteService } from './media/sprites';
import type { ComicReader } from './readers/comic';
import type { ZipCache } from './readers/zip';
import { logger } from './log';

const log = logger('protocol');

/**
 * Everything the renderer loads from disk goes through `gravity://app/...`:
 *   /media/:id            original file, with HTTP range support (direct play, images)
 *   /stream/:sid          live ffmpeg output (remux / transcode)
 *   /art/:id?s=thumb|large  cached artwork
 *   /sprite/:id/:n.jpg    seek-bar preview sheets
 *   /comic/:id/:page      comic page images
 *   /book/:id/<path>      files inside an EPUB
 *   anything else         the bundled renderer app (production only)
 * Files are only ever resolved through database ids, never from client-supplied paths.
 */

export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'gravity', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
  ]);
}

export interface ProtocolDeps {
  repo: LibraryRepo;
  playback: PlaybackService;
  art: ArtService;
  sprites: SpriteService;
  comics: ComicReader;
  zips: ZipCache;
  rendererDir: string | null;
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length' };

function text(status: number, message: string): Response {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS } });
}

async function fileResponse(path: string, req: Request, mime: string, extra: Record<string, string> = {}): Promise<Response> {
  let st;
  try {
    st = await stat(path);
  } catch {
    return text(404, 'File not found');
  }
  if (!st.isFile()) return text(404, 'Not a file');
  const headers: Record<string, string> = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', ...CORS, ...extra };
  const range = req.headers.get('range');
  let start = 0;
  let end = st.size - 1;
  let status = 200;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (m[1] === '' && m[2] === '')) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}`, ...CORS } });
    if (m[1] === '') { // suffix range: last N bytes
      start = Math.max(0, st.size - Number(m[2]));
    } else {
      start = Number(m[1]);
      if (m[2] !== '') end = Math.min(end, Number(m[2]));
    }
    if (start > end || start >= st.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}`, ...CORS } });
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
  }
  headers['Content-Length'] = String(end - start + 1);
  if (st.size === 0) return new Response(null, { status: 200, headers });
  // 1 MiB chunks: large sequential reads are what spinning disks like best.
  const stream = createReadStream(path, { start, end, highWaterMark: 1 << 20 });
  req.signal.addEventListener('abort', () => stream.destroy(), { once: true });
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, { status, headers });
}

function bufferResponse(data: Buffer, mime: string, extra: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(data), { status: 200, headers: { 'Content-Type': mime, 'Content-Length': String(data.length), ...CORS, ...extra } });
}

export function installProtocol(d: ProtocolDeps): void {
  protocol.handle('gravity', async (req) => {
    try {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      const url = new URL(req.url);
      const parts = url.pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p));
      const route = parts[0];

      if (route === 'media') {
        const row = d.repo.getRow(Number(parts[1]));
        if (!row || String(row.ext) === '') return text(404, 'Unknown media');
        return await fileResponse(String(row.path), req, mimeForExt(String(row.ext)));
      }
      if (route === 'stream') return d.playback.stream(parts[1] ?? '', req.signal);

      if (route === 'art') {
        const file = await d.art.get(Number(parts[1]), url.searchParams.get('s') === 'large' ? 'large' : 'thumb', req.signal);
        if (!file) return text(404, 'No artwork');
        return await fileResponse(file, req, 'image/jpeg', { 'Cache-Control': 'private, max-age=86400' });
      }

      if (route === 'sprite') {
        const n = parseInt((parts[2] ?? '').replace(/\.jpg$/, ''), 10);
        const file = await d.sprites.sheet(Number(parts[1]), n);
        return await fileResponse(file, req, 'image/jpeg', { 'Cache-Control': 'private, max-age=86400' });
      }

      if (route === 'comic') {
        const row = d.repo.getRow(Number(parts[1]));
        if (!row || String(row.kind) !== 'comic') return text(404, 'Unknown comic');
        const page = await d.comics.page({ path: String(row.path), isFolder: String(row.ext) === '', mtimeMs: Number(row.mtime_ms) }, Number(parts[2]), Number(url.searchParams.get('w') ?? 0));
        return bufferResponse(page.data, mimeForExt(page.ext), { 'Cache-Control': 'private, max-age=3600' });
      }

      if (route === 'book') {
        const row = d.repo.getRow(Number(parts[1]));
        if (!row || String(row.kind) !== 'book') return text(404, 'Unknown book');
        const zip = await d.zips.get(String(row.path), Number(row.mtime_ms));
        const entry = parts.slice(2).join('/');
        const data = await zip.read(entry);
        const ext = extname(entry).slice(1).toLowerCase();
        // Book content is untrusted: no scripts, no network, only the book's own resources.
        return bufferResponse(data, mimeForExt(ext), {
          'Content-Security-Policy': "default-src 'none'; img-src gravity: data:; style-src gravity: 'unsafe-inline'; font-src gravity: data:; media-src gravity: data:",
          'Cache-Control': 'private, max-age=3600'
        });
      }

      if (d.rendererDir) {
        const rel = normalize(url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
        let file = join(d.rendererDir, rel);
        if (!file.startsWith(d.rendererDir + sep) && file !== d.rendererDir) return text(403, 'Forbidden');
        try {
          return bufferResponse(await readFile(file), mimeForExt(extname(file).slice(1)));
        } catch {
          file = join(d.rendererDir, 'index.html');
          return bufferResponse(await readFile(file), 'text/html; charset=utf-8');
        }
      }
      return text(404, 'Not found');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return text(404, 'Not found');
      log.warn(`Request failed ${req.url}:`, (err as Error).message);
      return text(500, 'Internal error');
    }
  });
}
