import dgram from 'node:dgram';
import type { CastDevice } from '@shared/cast';
import { isPrivateIPv4 } from '@shared/cast';
import { logger } from '../log';
import { MAX_XML_BYTES, blocks, tagText } from './xml';

const log = logger('cast:ssdp');

export const SSDP_ADDRESS = '239.255.255.250';
export const SSDP_PORT = 1900;
const AVTRANSPORT = 'urn:schemas-upnp-org:service:AVTransport:1';

export interface DlnaDescription {
  id: string;
  name: string;
  model: string;
  /** Absolute control URL of the AVTransport service. */
  controlUrl: string;
}

/** An SSDP response's headers, lower-cased. */
export function parseSsdpResponse(text: string): Record<string, string> {
  const h: Record<string, string> = {};
  for (const line of text.split(/\r?\n/).slice(1)) {
    const i = line.indexOf(':');
    if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return h;
}

/**
 * A device may only point us at itself: the URL must be plain http, on a private address, and
 * on the same host that answered. This stops a spoofed SSDP reply from steering requests at
 * the internet or at another machine on the network (SSRF).
 */
export function safeDeviceUrl(raw: string, expectedHost: string, base?: string): URL | null {
  let u: URL;
  try { u = new URL(raw, base); } catch { return null; }
  if (u.protocol !== 'http:' || u.username || u.password) return null;
  if (u.hostname !== expectedHost || !isPrivateIPv4(u.hostname)) return null;
  return u;
}

/** Pull the renderer's name, UDN and AVTransport control URL out of a device description. */
export function parseDescription(xml: string, location: URL): DlnaDescription | null {
  const device = blocks(xml, 'device')[0] ?? xml;
  const udn = tagText(device, 'UDN');
  const name = tagText(device, 'friendlyName');
  const model = tagText(device, 'modelName');
  const service = blocks(xml, 'service').find((s) => tagText(s, 'serviceType') === AVTRANSPORT);
  const control = service ? tagText(service, 'controlURL') : '';
  if (!udn || !control) return null;
  const controlUrl = safeDeviceUrl(control, location.hostname, location.href);
  if (!controlUrl) return null;
  return { id: udn, name: name || 'DLNA renderer', model, controlUrl: controlUrl.href };
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_XML_BYTES) throw new Error('Device description too large');
  const text = await res.text();
  if (text.length > MAX_XML_BYTES) throw new Error('Device description too large');
  return text;
}

export async function describeDlna(location: string, address: string, timeoutMs = 3000): Promise<{ device: CastDevice; controlUrl: string } | null> {
  const url = safeDeviceUrl(location, address);
  if (!url) { log.warn(`Ignoring SSDP location from ${address}: not a same-host private http URL`); return null; }
  try {
    const d = parseDescription(await fetchText(url.href, timeoutMs), url);
    if (!d) return null;
    return { device: { id: d.id, name: d.name, protocol: 'dlna', address, model: d.model }, controlUrl: d.controlUrl };
  } catch (err) {
    log.debug(`Description fetch from ${address} failed: ${(err as Error).message}`);
    return null;
  }
}

export interface DiscoverOptions {
  timeoutMs?: number;
  /** Where M-SEARCH is sent. Overridable so tests can stay on loopback. */
  target?: { address: string; port: number };
}

/** Multicast an M-SEARCH and collect the media renderers that answer. */
export function discoverDlna(opts: DiscoverOptions = {}): Promise<{ device: CastDevice; controlUrl: string }[]> {
  const timeoutMs = opts.timeoutMs ?? 2500;
  const target = opts.target ?? { address: SSDP_ADDRESS, port: SSDP_PORT };
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const seen = new Map<string, string>(); // address -> location
    const done = async () => {
      try { socket.close(); } catch { /* already closed */ }
      const found = await Promise.all([...seen].map(([address, location]) => describeDlna(location, address)));
      const byId = new Map<string, { device: CastDevice; controlUrl: string }>();
      for (const f of found) if (f) byId.set(f.device.id, f);
      resolve([...byId.values()]);
    };
    socket.on('error', (err) => { log.warn(`SSDP socket error: ${err.message}`); void done(); });
    socket.on('message', (msg, rinfo) => {
      if (seen.size >= 64) return;
      const h = parseSsdpResponse(msg.toString('utf8', 0, Math.min(msg.length, 4096)));
      if (h['location'] && !seen.has(rinfo.address)) seen.set(rinfo.address, h['location']);
    });
    socket.bind(0, () => {
      const search = (st: string) => Buffer.from(
        ['M-SEARCH * HTTP/1.1', `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`, 'MAN: "ssdp:discover"', 'MX: 2', `ST: ${st}`, '', ''].join('\r\n')
      );
      for (const st of [AVTRANSPORT, 'urn:schemas-upnp-org:device:MediaRenderer:1']) {
        socket.send(search(st), target.port, target.address, (err) => { if (err) log.debug(`M-SEARCH failed: ${err.message}`); });
      }
      setTimeout(() => void done(), timeoutMs);
    });
  });
}
