import { createReadStream, statSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { logger } from '../log';

const log = logger('cast:server');

export type CastSource =
  | { kind: 'file'; path: string; mime: string }
  /** Live output (remux/transcode). `open` starts the stream; the signal aborts it when the device disconnects. */
  | { kind: 'stream'; mime: string; open: (signal: AbortSignal) => Response };

export const normaliseAddress = (a: string | undefined) => (a ?? '').replace(/^::ffff:/i, '');

export function newToken(): string {
  return randomBytes(16).toString('hex'); // 128 bits
}

export function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Parse a single `bytes=a-b` range. Returns null when absent, 'bad' when unsatisfiable. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'bad' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'bad';
  let start: number;
  let end = size - 1;
  if (m[1] === '') start = Math.max(0, size - Number(m[2]));
  else { start = Number(m[1]); if (m[2] !== '') end = Math.min(end, Number(m[2])); }
  return start > end || start >= size ? 'bad' : { start, end };
}

/**
 * A short-lived HTTP server that hands one media stream to one cast device.
 *
 *  - It is created when a cast starts and closed when it ends; nothing listens otherwise.
 *  - It binds to a single LAN address (never 0.0.0.0) on an ephemeral port.
 *  - Only the chosen device's IP is served; every other client gets 403.
 *  - The URL carries an unguessable per-session token; a wrong token gets 404.
 *  - GET and HEAD only. The only thing it can ever serve is the session's media.
 */
export class CastServer {
  private server: http.Server | null = null;
  private source: CastSource | null = null;
  readonly token = newToken();
  private generation = 0;

  constructor(private readonly allowedRemote: string) {}

  get port(): number { return (this.server?.address() as AddressInfo | null)?.port ?? 0; }

  /** Swap what is served (a seek on a live stream starts a new session). Returns the cache-busting query for the new URL. */
  setSource(source: CastSource): string {
    this.source = source;
    return `?n=${++this.generation}`;
  }

  async listen(bindAddress: string): Promise<void> {
    this.server = http.createServer((req, res) => this.handle(req, res));
    this.server.keepAliveTimeout = 5000;
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, bindAddress, () => resolve());
    });
    log.info(`Casting server on ${bindAddress}:${this.port} for ${this.allowedRemote}`);
  }

  url(host: string, ext = 'mp4'): string {
    return `http://${host}:${this.port}/cast/${this.token}/video.${ext}`;
  }

  close(): void {
    const s = this.server;
    this.server = null;
    this.source = null;
    if (s) { s.close(); s.closeAllConnections(); log.info('Casting server closed'); }
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const deny = (code: number) => { res.writeHead(code, { 'Content-Type': 'text/plain' }); res.end(); };
    if (normaliseAddress(req.socket.remoteAddress) !== this.allowedRemote) return deny(403);
    const m = /^\/cast\/([0-9a-f]{32})\/video\.\w+$/.exec((req.url ?? '').split('?')[0]!);
    if (!m || !tokenMatches(m[1]!, this.token) || !this.source) return deny(404);
    if (req.method !== 'GET' && req.method !== 'HEAD') return deny(405);
    const source = this.source;
    const dlna = { 'transferMode.dlna.org': 'Streaming', 'contentFeatures.dlna.org': 'DLNA.ORG_OP=00;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000' };
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length' };
    if (source.kind === 'file') {
      let size: number;
      try { size = statSync(source.path).size; } catch { return deny(404); }
      const range = parseRange(req.headers.range, size);
      if (range === 'bad') { res.writeHead(416, { 'Content-Range': `bytes */${size}`, ...cors }); res.end(); return; }
      const start = range?.start ?? 0;
      const end = range?.end ?? size - 1;
      res.writeHead(range ? 206 : 200, {
        'Content-Type': source.mime, 'Accept-Ranges': 'bytes', 'Content-Length': String(size === 0 ? 0 : end - start + 1),
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}), ...cors, ...dlna
      });
      if (req.method === 'HEAD' || size === 0) { res.end(); return; }
      const stream = createReadStream(source.path, { start, end, highWaterMark: 1 << 20 });
      res.on('close', () => stream.destroy());
      stream.on('error', () => res.destroy());
      stream.pipe(res);
      return;
    }
    // Live output: headers only for HEAD (so a probing device doesn't start an ffmpeg process).
    res.writeHead(200, { 'Content-Type': source.mime, 'Cache-Control': 'no-store', 'Accept-Ranges': 'none', ...cors, ...dlna });
    if (req.method === 'HEAD') { res.end(); return; }
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    const out = source.open(ac.signal);
    if (!out.body) { res.end(); return; }
    const body = Readable.fromWeb(out.body as import('node:stream/web').ReadableStream);
    body.on('error', () => res.destroy());
    body.pipe(res);
  }
}
