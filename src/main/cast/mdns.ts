import dgram from 'node:dgram';
import type { CastDevice } from '@shared/cast';
import { isPrivateIPv4 } from '@shared/cast';
import { logger } from '../log';

const log = logger('cast:mdns');

export const MDNS_ADDRESS = '224.0.0.251';
export const MDNS_PORT = 5353;
const SERVICE = '_googlecast._tcp.local';

const TYPE = { A: 1, PTR: 12, TXT: 16, SRV: 33 } as const;

export function buildQuery(name = SERVICE): Buffer {
  const labels = name.split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)]));
  const header = Buffer.alloc(12);
  header.writeUInt16BE(1, 4); // one question
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(TYPE.PTR, 0);
  tail.writeUInt16BE(0x8001, 2); // IN, with the "unicast response" bit so replies come straight to our socket
  return Buffer.concat([header, ...labels, Buffer.from([0]), tail]);
}

interface Rr { name: string; type: number; data: Buffer; offset: number }

function readName(buf: Buffer, start: number): { name: string; next: number } {
  const labels: string[] = [];
  let pos = start;
  let next = -1;
  for (let hops = 0; hops < 32; hops++) {
    const len = buf[pos];
    if (len === undefined) throw new Error('Truncated name');
    if (len === 0) { pos++; break; }
    if ((len & 0xc0) === 0xc0) {
      if (next < 0) next = pos + 2;
      pos = ((len & 0x3f) << 8) | buf[pos + 1]!;
      continue;
    }
    labels.push(buf.toString('utf8', pos + 1, pos + 1 + len));
    pos += 1 + len;
  }
  return { name: labels.join('.'), next: next < 0 ? pos : next };
}

function records(buf: Buffer): Rr[] {
  if (buf.length < 12) return [];
  let pos = 12;
  const questions = buf.readUInt16BE(4);
  const total = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  const out: Rr[] = [];
  try {
    for (let i = 0; i < questions; i++) pos = readName(buf, pos).next + 4;
    for (let i = 0; i < total && pos + 10 <= buf.length; i++) {
      const { name, next } = readName(buf, pos);
      const type = buf.readUInt16BE(next);
      const len = buf.readUInt16BE(next + 8);
      const offset = next + 10;
      if (offset + len > buf.length) break;
      out.push({ name, type, data: buf.subarray(offset, offset + len), offset });
      pos = offset + len;
    }
  } catch { /* a damaged packet yields whatever parsed before the damage */ }
  return out;
}

function txt(data: Buffer): Record<string, string> {
  const o: Record<string, string> = {};
  for (let p = 0; p < data.length;) {
    const l = data[p]!;
    const kv = data.toString('utf8', p + 1, p + 1 + l);
    const i = kv.indexOf('=');
    if (i > 0) o[kv.slice(0, i)] = kv.slice(i + 1);
    p += 1 + l;
  }
  return o;
}

export interface ChromecastRecord { instance: string; port: number; txt: Record<string, string>; host: string }

/** Chromecast instances announced in one mDNS packet, with the A records it carried. */
export function parseAnnouncement(buf: Buffer): { casts: ChromecastRecord[]; addresses: Map<string, string> } {
  const rrs = records(buf);
  const addresses = new Map<string, string>();
  const srv = new Map<string, { port: number; host: string }>();
  const texts = new Map<string, Record<string, string>>();
  const ptrs: string[] = [];
  for (const r of rrs) {
    try {
      if (r.type === TYPE.A && r.data.length === 4) addresses.set(r.name.toLowerCase(), [...r.data].join('.'));
      else if (r.type === TYPE.SRV) srv.set(r.name, { port: r.data.readUInt16BE(4), host: readName(buf, r.offset + 6).name.toLowerCase() });
      else if (r.type === TYPE.TXT) texts.set(r.name, txt(r.data));
      else if (r.type === TYPE.PTR && r.name.toLowerCase() === SERVICE) ptrs.push(readName(buf, r.offset).name);
    } catch { /* ignore a malformed record, keep the rest */ }
  }
  const casts: ChromecastRecord[] = [];
  for (const instance of new Set([...ptrs, ...srv.keys()])) {
    const s = srv.get(instance);
    if (s) casts.push({ instance, port: s.port, host: s.host, txt: texts.get(instance) ?? {} });
  }
  return { casts, addresses };
}

export function toDevice(c: ChromecastRecord, address: string): CastDevice | null {
  if (!isPrivateIPv4(address)) return null;
  const id = c.txt['id'] || c.instance;
  return { id: `cast:${id}`, name: c.txt['fn'] || c.instance.replace(/\._googlecast\._tcp\.local$/i, ''), protocol: 'chromecast', address, model: c.txt['md'] ?? '' };
}

export interface MdnsOptions { timeoutMs?: number; target?: { address: string; port: number } }

/** Ask for Chromecasts and collect the replies that arrive within the timeout. */
export function discoverChromecasts(opts: MdnsOptions = {}): Promise<{ device: CastDevice; port: number }[]> {
  const timeoutMs = opts.timeoutMs ?? 2500;
  const target = opts.target ?? { address: MDNS_ADDRESS, port: MDNS_PORT };
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const found = new Map<string, { device: CastDevice; port: number }>();
    const finish = () => { try { socket.close(); } catch { /* closed */ } resolve([...found.values()]); };
    socket.on('error', (err) => { log.warn(`mDNS socket error: ${err.message}`); finish(); });
    socket.on('message', (msg, rinfo) => {
      if (found.size >= 64) return;
      try {
        const { casts, addresses } = parseAnnouncement(msg);
        for (const c of casts) {
          // The sender's own address is authoritative; an A record naming some other host is ignored.
          const ip = rinfo.address;
          const claimed = addresses.get(c.host);
          if (claimed && claimed !== ip) continue;
          const device = toDevice(c, ip);
          if (device) found.set(device.id, { device, port: c.port });
        }
      } catch (err) { log.debug(`Bad mDNS packet from ${rinfo.address}: ${(err as Error).message}`); }
    });
    socket.bind(0, () => {
      socket.send(buildQuery(), target.port, target.address, (err) => { if (err) log.debug(`mDNS query failed: ${err.message}`); });
      setTimeout(finish, timeoutMs);
    });
  });
}
