import tls from 'node:tls';
import { logger } from '../log';

const log = logger('cast:v2');

export const NS = {
  connection: 'urn:x-cast:com.google.cast.tp.connection',
  heartbeat: 'urn:x-cast:com.google.cast.tp.heartbeat',
  receiver: 'urn:x-cast:com.google.cast.receiver',
  media: 'urn:x-cast:com.google.cast.media'
} as const;

/** Google's Default Media Receiver: plays a URL, needs no registration. */
export const DEFAULT_MEDIA_RECEIVER = 'CC1AD845';

export interface CastMessage { source: string; destination: string; namespace: string; payload: string }

// --- the one protobuf message Chromecast speaks: CastMessage -------------------------------------

function varint(n: number): Buffer {
  const out: number[] = [];
  let v = n;
  while (v > 0x7f) { out.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
  out.push(v);
  return Buffer.from(out);
}

const field = (num: number, wire: number, body: Buffer) => Buffer.concat([varint((num << 3) | wire), body]);
const str = (num: number, s: string) => { const b = Buffer.from(s, 'utf8'); return field(num, 2, Buffer.concat([varint(b.length), b])); };

/** Length-prefixed CastMessage: protocol_version 0, string payload. */
export function encodeMessage(m: CastMessage): Buffer {
  const body = Buffer.concat([
    field(1, 0, varint(0)), str(2, m.source), str(3, m.destination), str(4, m.namespace), field(5, 0, varint(0)), str(6, m.payload)
  ]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  return Buffer.concat([len, body]);
}

function readVarint(buf: Buffer, pos: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  for (let i = pos; i < buf.length && shift < 35; i++) {
    const b = buf[i]!;
    value += (b & 0x7f) * 2 ** shift;
    if (!(b & 0x80)) return { value, next: i + 1 };
    shift += 7;
  }
  throw new Error('Bad varint');
}

export function decodeMessage(body: Buffer): CastMessage {
  const m: CastMessage = { source: '', destination: '', namespace: '', payload: '' };
  let pos = 0;
  while (pos < body.length) {
    const tag = readVarint(body, pos);
    pos = tag.next;
    const num = tag.value >> 3;
    const wire = tag.value & 7;
    if (wire === 0) { pos = readVarint(body, pos).next; continue; }
    if (wire !== 2) throw new Error(`Unsupported wire type ${wire}`);
    const len = readVarint(body, pos);
    const end = len.next + len.value;
    if (end > body.length) throw new Error('Truncated field');
    const text = body.toString('utf8', len.next, end);
    if (num === 2) m.source = text; else if (num === 3) m.destination = text; else if (num === 4) m.namespace = text; else if (num === 6) m.payload = text;
    pos = end;
  }
  return m;
}

/** Splits a TCP byte stream into CastMessages, tolerating arbitrary chunking. */
export class MessageReader {
  private buf = Buffer.alloc(0);
  constructor(private readonly maxBytes = 1 << 20) {}
  push(chunk: Buffer): CastMessage[] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out: CastMessage[] = [];
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32BE(0);
      if (len > this.maxBytes) throw new Error('Cast message too large');
      if (this.buf.length < 4 + len) break;
      out.push(decodeMessage(this.buf.subarray(4, 4 + len)));
      this.buf = this.buf.subarray(4 + len);
    }
    return out;
  }
}

// --- connection ------------------------------------------------------------------------------

export interface MediaStatus {
  mediaSessionId: number;
  playerState: 'IDLE' | 'BUFFERING' | 'PLAYING' | 'PAUSED';
  currentTime: number;
  duration: number;
  idleReason: string;
}

interface Pending { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

export interface CastV2Options { port?: number; timeoutMs?: number }

/**
 * One sender connection to a Chromecast. The device presents a self-signed certificate that only
 * Google's device-auth chain can vouch for, which this client does not implement; the socket is
 * therefore opened only to private LAN addresses found by discovery (see docs/features/07-casting.md).
 */
export class CastV2 {
  private socket: tls.TLSSocket | null = null;
  private reader = new MessageReader();
  private requestId = 0;
  private pending = new Map<number, Pending>();
  private heartbeat: NodeJS.Timeout | null = null;
  private transportId = '';
  private sessionId = '';
  private mediaSessionId = 0;
  onMedia: (s: MediaStatus) => void = () => {};
  onClose: (err?: Error) => void = () => {};

  constructor(private readonly host: string, private readonly opts: CastV2Options = {}) {}

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = tls.connect({ host: this.host, port: this.opts.port ?? 8009, rejectUnauthorized: false }, () => resolve());
      this.socket = socket;
      socket.setTimeout(this.opts.timeoutMs ?? 8000, () => socket.destroy(new Error('Chromecast did not respond')));
      socket.once('error', reject);
      socket.on('data', (d: Buffer) => this.onData(d));
      socket.on('close', () => this.closed());
      socket.on('error', (err) => log.debug(`Chromecast socket: ${err.message}`));
    });
    this.socket!.setTimeout(0);
    this.send(NS.connection, 'sender-0', 'receiver-0', { type: 'CONNECT' });
    this.heartbeat = setInterval(() => this.send(NS.heartbeat, 'sender-0', 'receiver-0', { type: 'PING' }), 5000);
    this.heartbeat.unref();
  }

  private send(namespace: string, source: string, destination: string, payload: Record<string, unknown>): void {
    if (!this.socket || this.socket.destroyed) throw new Error('Not connected to the Chromecast');
    this.socket.write(encodeMessage({ source, destination, namespace, payload: JSON.stringify(payload) }));
  }

  private request(namespace: string, destination: string, payload: Record<string, unknown>, timeoutMs = 10000): Promise<Record<string, unknown>> {
    const requestId = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error(`Chromecast did not answer ${String(payload['type'])}`)); }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      try { this.send(namespace, 'sender-0', destination, { ...payload, requestId }); } catch (err) { clearTimeout(timer); this.pending.delete(requestId); reject(err as Error); }
    });
  }

  private onData(chunk: Buffer): void {
    let messages: CastMessage[];
    try { messages = this.reader.push(chunk); } catch (err) { this.socket?.destroy(err as Error); return; }
    for (const m of messages) {
      let body: Record<string, unknown>;
      try { body = JSON.parse(m.payload) as Record<string, unknown>; } catch { continue; }
      if (m.namespace === NS.heartbeat && body['type'] === 'PING') { try { this.send(NS.heartbeat, 'sender-0', m.source, { type: 'PONG' }); } catch { /* closing */ } continue; }
      const id = body['requestId'];
      if (typeof id === 'number' && this.pending.has(id)) {
        const p = this.pending.get(id)!;
        this.pending.delete(id);
        clearTimeout(p.timer);
        if (typeof body['type'] === 'string' && /ERROR|FAILED/.test(body['type'])) p.reject(new Error(`Chromecast reported ${body['type']}${body['reason'] ? `: ${String(body['reason'])}` : ''}`));
        else p.resolve(body);
      }
      if (m.namespace === NS.media && body['type'] === 'MEDIA_STATUS') this.handleMedia(body);
      if (m.namespace === NS.connection && body['type'] === 'CLOSE') this.socket?.destroy();
    }
  }

  private handleMedia(body: Record<string, unknown>): void {
    const status = (body['status'] as Record<string, unknown>[] | undefined)?.[0];
    if (!status) return;
    this.mediaSessionId = Number(status['mediaSessionId'] ?? this.mediaSessionId);
    const media = status['media'] as Record<string, unknown> | undefined;
    this.onMedia({
      mediaSessionId: this.mediaSessionId,
      playerState: (status['playerState'] as MediaStatus['playerState']) ?? 'IDLE',
      currentTime: Number(status['currentTime'] ?? 0),
      duration: Number(media?.['duration'] ?? 0),
      idleReason: String(status['idleReason'] ?? '')
    });
  }

  private closed(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Chromecast connection closed')); }
    this.pending.clear();
    this.socket = null;
    this.onClose();
  }

  /** Start the Default Media Receiver and open a channel to it. */
  async launch(): Promise<void> {
    const status = await this.request(NS.receiver, 'receiver-0', { type: 'LAUNCH', appId: DEFAULT_MEDIA_RECEIVER });
    const app = ((status['status'] as Record<string, unknown> | undefined)?.['applications'] as Record<string, unknown>[] | undefined)?.find((a) => a['appId'] === DEFAULT_MEDIA_RECEIVER);
    if (!app) throw new Error('The Chromecast did not start its media receiver');
    this.transportId = String(app['transportId']);
    this.sessionId = String(app['sessionId']);
    this.send(NS.connection, 'sender-0', this.transportId, { type: 'CONNECT' });
  }

  async load(url: string, contentType: string, title: string, startSec = 0): Promise<void> {
    const res = await this.request(NS.media, this.transportId, {
      type: 'LOAD', sessionId: this.sessionId, autoplay: true, currentTime: startSec,
      media: { contentId: url, contentType, streamType: 'BUFFERED', metadata: { type: 0, metadataType: 0, title } }
    }, 30000);
    const st = (res['status'] as Record<string, unknown>[] | undefined)?.[0];
    if (st?.['mediaSessionId'] != null) this.mediaSessionId = Number(st['mediaSessionId']);
  }

  private mediaControl(type: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return this.request(NS.media, this.transportId, { type, mediaSessionId: this.mediaSessionId, ...extra });
  }
  play() { return this.mediaControl('PLAY'); }
  pause() { return this.mediaControl('PAUSE'); }
  seek(sec: number) { return this.mediaControl('SEEK', { currentTime: sec, resumeState: 'PLAYBACK_START' }); }
  async poll(): Promise<void> { this.send(NS.media, 'sender-0', this.transportId, { type: 'GET_STATUS', requestId: ++this.requestId }); }

  async stop(): Promise<void> {
    try { if (this.sessionId) await this.request(NS.receiver, 'receiver-0', { type: 'STOP', sessionId: this.sessionId }, 3000); } catch { /* going away anyway */ }
    this.close();
  }

  close(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.socket?.destroy();
  }
}
