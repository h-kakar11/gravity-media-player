import { execFileSync } from 'node:child_process';
import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CastDevice, CastStatus } from '@shared/cast';
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings';
import type { ProbeInfo, StreamInfo } from '@shared/types';
import { MessageReader, NS, encodeMessage } from '../../src/main/cast/castv2';
import { discoverChromecasts } from '../../src/main/cast/mdns';
import { CastService, type CastDeps, type Found } from '../../src/main/cast/service';
import { discoverDlna } from '../../src/main/cast/ssdp';

// These fakes speak just enough of each protocol to exercise our side of it on loopback.
// They prove the protocol logic, NOT compatibility with any real TV or Chromecast.

const waitFor = async (fn: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 15));
  }
};

const listen = (server: net.Server) => new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port)));
const fetchBytes = async (url: string, headers: Record<string, string> = {}) => {
  const res = await fetch(url, { headers });
  return { status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: res.headers };
};

// ---------- fake DLNA renderer ----------
class FakeRenderer {
  server = http.createServer((req, res) => this.handle(req, res));
  port = 0;
  actions: { action: string; body: string }[] = [];
  uri = '';
  state = 'STOPPED';
  rel = '0:00:00';
  fetched: Buffer[] = [];
  refuse: string | null = null;
  async start() { this.port = await listen(this.server); return this; }
  stop() { this.server.close(); this.server.closeAllConnections(); }
  private handle(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.method === 'GET' && req.url === '/desc.xml') {
      res.setHeader('Content-Type', 'text/xml');
      res.end(`<root><device><friendlyName>Fake TV</friendlyName><modelName>F-1</modelName><UDN>uuid:fake-1</UDN><serviceList>
        <service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/control</controlURL></service></serviceList></device></root>`);
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      const action = /SOAPACTION/i.test(Object.keys(req.headers).join()) ? String(req.headers['soapaction']).replace(/^"|"$/g, '').split('#')[1]! : '';
      this.actions.push({ action, body });
      if (this.refuse === action) {
        res.statusCode = 500;
        res.end('<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorDescription>Not allowed</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>');
        return;
      }
      let out = '';
      if (action === 'SetAVTransportURI') this.uri = /<CurrentURI>([^<]*)<\/CurrentURI>/.exec(body)![1]!.replace(/&amp;/g, '&');
      if (action === 'Play') { this.state = 'PLAYING'; void fetch(this.uri).then(async (r) => this.fetched.push(Buffer.from(await r.arrayBuffer()))).catch(() => {}); }
      if (action === 'Pause') this.state = 'PAUSED_PLAYBACK';
      if (action === 'Stop') this.state = 'STOPPED';
      if (action === 'Seek') this.rel = /<Target>([^<]*)<\/Target>/.exec(body)![1]!;
      if (action === 'GetTransportInfo') out = `<CurrentTransportState>${this.state}</CurrentTransportState>`;
      if (action === 'GetPositionInfo') out = `<RelTime>${this.rel}</RelTime><TrackDuration>0:01:40</TrackDuration>`;
      res.setHeader('Content-Type', 'text/xml');
      res.end(`<s:Envelope><s:Body><u:${action}Response>${out}</u:${action}Response></s:Body></s:Envelope>`);
    });
  }
}

// ---------- fake Chromecast ----------
let certDir = '';
class FakeChromecast {
  server!: tls.Server;
  port = 0;
  received: { namespace: string; body: Record<string, unknown> }[] = [];
  loaded = '';
  fetched: Buffer[] = [];
  private sockets: tls.TLSSocket[] = [];
  async start() {
    this.server = tls.createServer({ key: readFileSync(join(certDir, 'k.pem')), cert: readFileSync(join(certDir, 'c.pem')) }, (socket) => {
      this.sockets.push(socket);
      const reader = new MessageReader();
      const send = (namespace: string, destination: string, payload: unknown) => socket.write(encodeMessage({ source: 'receiver-0', destination, namespace, payload: JSON.stringify(payload) }));
      socket.on('error', () => {});
      socket.on('data', (d: Buffer) => {
        for (const m of reader.push(d)) {
          const body = JSON.parse(m.payload) as Record<string, unknown>;
          this.received.push({ namespace: m.namespace, body });
          const requestId = body['requestId'];
          if (m.namespace === NS.connection && body['type'] === 'CONNECT' && m.destination === 'receiver-0') send(NS.heartbeat, 'sender-0', { type: 'PING' });
          if (m.namespace === NS.receiver && body['type'] === 'LAUNCH') {
            send(NS.receiver, 'sender-0', { type: 'RECEIVER_STATUS', requestId, status: { applications: [{ appId: body['appId'], transportId: 'web-1', sessionId: 'sess-1' }] } });
          }
          if (m.namespace === NS.media && body['type'] === 'LOAD') {
            this.loaded = (body['media'] as { contentId: string }).contentId;
            void fetch(this.loaded).then(async (r) => this.fetched.push(Buffer.from(await r.arrayBuffer()))).catch(() => {});
            send(NS.media, 'sender-0', { type: 'MEDIA_STATUS', requestId, status: [{ mediaSessionId: 7, playerState: 'PLAYING', currentTime: Number(body['currentTime'] ?? 0), media: { duration: 100 } }] });
          }
          if (m.namespace === NS.media && body['type'] === 'GET_STATUS') send(NS.media, 'sender-0', { type: 'MEDIA_STATUS', status: [{ mediaSessionId: 7, playerState: 'PLAYING', currentTime: 12.5, media: { duration: 100 } }] });
          if (m.namespace === NS.media && (body['type'] === 'PAUSE' || body['type'] === 'PLAY')) send(NS.media, 'sender-0', { type: 'MEDIA_STATUS', requestId, status: [{ mediaSessionId: 7, playerState: body['type'] === 'PAUSE' ? 'PAUSED' : 'PLAYING', currentTime: 12.5 }] });
          if (m.namespace === NS.media && body['type'] === 'SEEK') send(NS.media, 'sender-0', { type: 'MEDIA_STATUS', requestId, status: [{ mediaSessionId: 7, playerState: 'PLAYING', currentTime: Number(body['currentTime']) }] });
          if (m.namespace === NS.receiver && body['type'] === 'STOP') send(NS.receiver, 'sender-0', { type: 'RECEIVER_STATUS', requestId, status: {} });
        }
      });
    });
    this.port = await listen(this.server as unknown as net.Server);
    return this;
  }
  stop() { for (const s of this.sockets) s.destroy(); this.server.close(); }
}

// ---------- service harness ----------
const sv = (o: Partial<StreamInfo>): StreamInfo => ({
  index: 0, type: 'video', codec: 'h264', profile: 'High', level: 41, width: 1920, height: 1080, pixFmt: 'yuv420p', bitDepth: 8,
  fps: 24, bitrate: 0, channels: 0, channelLayout: '', sampleRate: 0, language: '', title: '', isDefault: true, isForced: false,
  attachedPic: false, colorTransfer: '', rotation: 0, ...o
});
const probeOf = (streams: StreamInfo[]): ProbeInfo => ({ container: 'mp4', formatName: 'mov,mp4', durationSec: 100, bitrate: 0, size: 0, streams, chapters: [] });
const GOOD = probeOf([sv({}), sv({ index: 1, type: 'audio', codec: 'aac', channels: 2, width: 0, height: 0 })]);

let dir = '';
let file = '';
const FILE_BYTES = Buffer.from('0123456789'.repeat(100));

function harness(opts: { found: Found; probe?: ProbeInfo; ext?: string; enabled?: boolean }) {
  const settings = Object.assign(new EventEmitter(), { current: { ...DEFAULT_SETTINGS, cast: { enabled: opts.enabled ?? true } } as Settings, get() { return this.current; } });
  const statuses: CastStatus[] = [];
  const opened: { startSec: number; mode: string }[] = [];
  const closed: string[] = [];
  let n = 0;
  const deps: CastDeps = {
    getRow: (id) => (id === 1 ? { path: file, ext: opts.ext ?? 'mp4', kind: 'video', title: 'Test Film', duration: 100 } : undefined),
    playback: {
      probe: async () => opts.probe ?? GOOD,
      open: async (req) => {
        opened.push({ startSec: req.startSec, mode: req.mode });
        return { sid: `s${++n}`, mode: req.mode, url: '', offsetSec: req.startSec, durationSec: 100, audioIndex: 0, reason: req.reason, encoder: 'copy', videoCodecOut: '', audioCodecOut: '' };
      },
      stream: (sid) => new Response(`STREAM-${sid}`),
      close: (sid) => { closed.push(sid); }
    },
    settings,
    emit: (s) => statuses.push(s),
    discover: async () => [opts.found],
    interfaces: () => [{ address: '127.0.0.1', netmask: '255.0.0.0' }]
  };
  return { service: new CastService(deps), settings, statuses, opened, closed };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'gravity-cast-'));
  file = join(dir, 'film.mp4');
  writeFileSync(file, FILE_BYTES);
  // The fake Chromecast needs a TLS identity. It is generated here per run so no private key lives in the repo.
  certDir = join(dir, 'tls');
  execFileSync('mkdir', [certDir]);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', join(certDir, 'k.pem'), '-out', join(certDir, 'c.pem'), '-days', '1', '-subj', '/CN=fake-chromecast'], { stdio: 'ignore' });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const live: { stop(): void }[] = [];
afterEach(() => { for (const l of live.splice(0)) l.stop(); });

describe('discovery on loopback', () => {
  it('finds a DLNA renderer through SSDP and reads its description', async () => {
    const renderer = await new FakeRenderer().start();
    live.push(renderer);
    const responder = dgram.createSocket('udp4');
    live.push({ stop: () => responder.close() });
    responder.on('message', (_m, rinfo) => responder.send(`HTTP/1.1 200 OK\r\nLOCATION: http://127.0.0.1:${renderer.port}/desc.xml\r\nST: urn:schemas-upnp-org:service:AVTransport:1\r\n\r\n`, rinfo.port, rinfo.address));
    await new Promise<void>((r) => responder.bind(0, '127.0.0.1', () => r()));
    const found = await discoverDlna({ timeoutMs: 400, target: { address: '127.0.0.1', port: responder.address().port } });
    expect(found).toHaveLength(1);
    expect(found[0]!.device).toMatchObject({ id: 'uuid:fake-1', name: 'Fake TV', protocol: 'dlna', address: '127.0.0.1' });
    expect(found[0]!.controlUrl).toBe(`http://127.0.0.1:${renderer.port}/control`);
  });
  it('ignores an SSDP reply whose LOCATION is a public address', async () => {
    const responder = dgram.createSocket('udp4');
    live.push({ stop: () => responder.close() });
    responder.on('message', (_m, rinfo) => responder.send('HTTP/1.1 200 OK\r\nLOCATION: http://8.8.8.8/desc.xml\r\n\r\n', rinfo.port, rinfo.address));
    await new Promise<void>((r) => responder.bind(0, '127.0.0.1', () => r()));
    expect(await discoverDlna({ timeoutMs: 300, target: { address: '127.0.0.1', port: responder.address().port } })).toEqual([]);
  });
  it('finds a Chromecast through mDNS', async () => {
    const name = (n: string) => Buffer.concat([...n.split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])), Buffer.from([0])]);
    const rr = (n: string, type: number, data: Buffer) => { const h = Buffer.alloc(10); h.writeUInt16BE(type, 0); h.writeUInt16BE(1, 2); h.writeUInt16BE(data.length, 8); return Buffer.concat([name(n), h, data]); };
    const inst = 'Chromecast-x._googlecast._tcp.local';
    const txtb = Buffer.concat(['id=feed', 'fn=Den'].map((s) => Buffer.concat([Buffer.from([s.length]), Buffer.from(s)])));
    const header = Buffer.alloc(12); header.writeUInt16BE(0x8400, 2); header.writeUInt16BE(3, 6);
    const reply = Buffer.concat([header, rr('_googlecast._tcp.local', 12, name(inst)), rr(inst, 33, Buffer.concat([Buffer.from([0, 0, 0, 0, 0x1f, 0x49]), name('x.local')])), rr(inst, 16, txtb)]);
    const responder = dgram.createSocket('udp4');
    live.push({ stop: () => responder.close() });
    responder.on('message', (_m, rinfo) => responder.send(reply, rinfo.port, rinfo.address));
    await new Promise<void>((r) => responder.bind(0, '127.0.0.1', () => r()));
    const found = await discoverChromecasts({ timeoutMs: 400, target: { address: '127.0.0.1', port: responder.address().port } });
    expect(found).toHaveLength(1);
    expect(found[0]!.device).toMatchObject({ id: 'cast:feed', name: 'Den', protocol: 'chromecast', address: '127.0.0.1' });
    expect(found[0]!.port).toBe(8009);
  });
});

describe('opt-in', () => {
  const dev: CastDevice = { id: 'uuid:x', name: 'TV', protocol: 'dlna', address: '127.0.0.1', model: '' };
  it('does nothing while casting is disabled', async () => {
    let scans = 0;
    const h = harness({ found: { device: dev, controlUrl: 'http://127.0.0.1:1/c' }, enabled: false });
    (h.service as unknown as { d: CastDeps }).d.discover = async () => { scans++; return []; };
    await expect(h.service.discover()).rejects.toThrow(/turned off/);
    await expect(h.service.start(dev.id, 1, 0, 0)).rejects.toThrow(/turned off/);
    expect(h.service.devices()).toEqual([]);
    expect(scans).toBe(0);
  });
});

describe('casting to a DLNA renderer', () => {
  async function setup(overrides: { probe?: ProbeInfo; ext?: string } = {}) {
    const renderer = await new FakeRenderer().start();
    live.push(renderer);
    const device: CastDevice = { id: 'uuid:fake-1', name: 'Fake TV', protocol: 'dlna', address: '127.0.0.1', model: '' };
    const h = harness({ found: { device, controlUrl: `http://127.0.0.1:${renderer.port}/control` }, ...overrides });
    await h.service.discover();
    live.push({ stop: () => void h.service.closeAll() });
    return { renderer, h, device };
  }

  it('lists the device, plays a direct file, and the renderer can read it with ranges', async () => {
    const { renderer, h, device } = await setup();
    expect(h.service.devices()).toEqual([device]);
    const status = await h.service.start(device.id, 1, 0, 0);
    expect(status).toMatchObject({ state: 'buffering', mode: 'direct', seekRestarts: false, title: 'Test Film' });
    expect(renderer.actions.map((a) => a.action)).toEqual(['SetAVTransportURI', 'Play']);
    await waitFor(() => renderer.fetched.length === 1);
    expect(renderer.fetched[0]!.equals(FILE_BYTES)).toBe(true);
    const part = await fetchBytes(renderer.uri, { Range: 'bytes=10-19' });
    expect(part.status).toBe(206);
    expect(part.body.toString()).toBe('0123456789');
    expect(renderer.actions[0]!.body).toContain('video/mp4');
  });

  it('follows renderer state and position', async () => {
    const { renderer, h, device } = await setup();
    await h.service.start(device.id, 1, 0, 0);
    renderer.rel = '0:00:42';
    await waitFor(() => h.service.getStatus().state === 'playing' && h.service.getStatus().positionSec === 42);
    expect(h.service.getStatus().durationSec).toBe(100);
  });

  it('pauses, seeks and stops, then closes the server', async () => {
    const { renderer, h, device } = await setup();
    await h.service.start(device.id, 1, 0, 0);
    const url = renderer.uri;
    await h.service.control({ type: 'pause' });
    expect(renderer.state).toBe('PAUSED_PLAYBACK');
    expect(h.service.getStatus().state).toBe('paused');
    await h.service.control({ type: 'seek', sec: 75 });
    expect(renderer.rel).toBe('0:01:15');
    await h.service.control({ type: 'stop' });
    expect(renderer.actions.at(-1)!.action).toBe('Stop');
    expect(h.service.getStatus().state).toBe('idle');
    await expect(fetch(url)).rejects.toThrow(); // nothing is listening any more
  });

  it('a seek in a converted stream starts a new conversion and re-points the renderer', async () => {
    const { renderer, h, device } = await setup({ ext: 'mkv' });
    await h.service.start(device.id, 1, 0, 0);
    expect(h.service.getStatus()).toMatchObject({ mode: 'remux', seekRestarts: true });
    const first = renderer.uri;
    await h.service.control({ type: 'seek', sec: 60 });
    expect(h.opened.map((o) => o.startSec)).toEqual([0, 60]);
    expect(h.closed).toEqual(['s1']);
    expect(renderer.uri).not.toBe(first);
    expect(renderer.uri.split('?')[0]).toBe(first.split('?')[0]);
    expect((await fetchBytes(renderer.uri)).body.toString()).toBe('STREAM-s2');
    expect(h.service.getStatus().positionSec).toBeGreaterThanOrEqual(60);
  });

  it('reports a refusal from the renderer and cleans up', async () => {
    const { renderer, h, device } = await setup();
    renderer.refuse = 'SetAVTransportURI';
    await expect(h.service.start(device.id, 1, 0, 0)).rejects.toThrow(/Not allowed/);
    expect(h.service.getStatus()).toMatchObject({ state: 'error', error: expect.stringContaining('Not allowed') });
  });

  it('stops casting when the setting is switched off', async () => {
    const { renderer, h, device } = await setup();
    await h.service.start(device.id, 1, 0, 0);
    h.settings.current = { ...h.settings.current, cast: { enabled: false } };
    h.settings.emit('changed', h.settings.current);
    await waitFor(() => h.service.getStatus().state === 'idle');
    expect(renderer.actions.at(-1)!.action).toBe('Stop');
    expect(h.service.devices()).toEqual([]);
  });

  it('only casts videos', async () => {
    const { h, device } = await setup();
    await expect(h.service.start(device.id, 99, 0, 0)).rejects.toThrow(/Only videos/);
  });
});

describe('casting to a Chromecast', () => {
  it('connects, launches the receiver, loads the stream and relays controls', async () => {
    const cast = await new FakeChromecast().start();
    live.push(cast);
    const device: CastDevice = { id: 'cast:feed', name: 'Den', protocol: 'chromecast', address: '127.0.0.1', model: 'Chromecast' };
    const h = harness({ found: { device, port: cast.port } });
    await h.service.discover();
    live.push({ stop: () => void h.service.closeAll() });

    await h.service.start(device.id, 1, 30, 0);
    const types = cast.received.map((r) => `${r.namespace.split('.').pop()}:${String(r.body['type'])}`);
    expect(types).toContain('connection:CONNECT');
    expect(types).toContain('receiver:LAUNCH');
    expect(cast.received.find((r) => r.body['type'] === 'LAUNCH')!.body['appId']).toBe('CC1AD845');
    const load = cast.received.find((r) => r.body['type'] === 'LOAD')!.body;
    expect(load['currentTime']).toBe(30); // direct file: the device seeks itself
    expect((load['media'] as { contentType: string }).contentType).toBe('video/mp4');
    await waitFor(() => cast.fetched.length === 1);
    expect(cast.fetched[0]!.equals(FILE_BYTES)).toBe(true);

    await waitFor(() => h.service.getStatus().state === 'playing');
    await waitFor(() => h.service.getStatus().positionSec === 12.5);

    await h.service.control({ type: 'pause' });
    expect(cast.received.some((r) => r.body['type'] === 'PAUSE' && r.body['mediaSessionId'] === 7)).toBe(true);
    expect(h.service.getStatus().state).toBe('paused');
    await h.service.control({ type: 'seek', sec: 80 });
    expect(cast.received.find((r) => r.body['type'] === 'SEEK')!.body['currentTime']).toBe(80);
    await h.service.control({ type: 'stop' });
    expect(cast.received.some((r) => r.body['type'] === 'STOP')).toBe(true);
    expect(h.service.getStatus().state).toBe('idle');
  });

  it('answers a heartbeat PING with PONG', async () => {
    const cast = await new FakeChromecast().start();
    live.push(cast);
    const { CastV2 } = await import('../../src/main/cast/castv2');
    const c = new CastV2('127.0.0.1', { port: cast.port });
    await c.connect();
    await waitFor(() => cast.received.some((r) => r.body['type'] === 'PONG'));
    c.close();
  });

  it('converts and restarts when seeking a transcoded cast', async () => {
    const cast = await new FakeChromecast().start();
    live.push(cast);
    const device: CastDevice = { id: 'cast:feed', name: 'Den', protocol: 'chromecast', address: '127.0.0.1', model: '' };
    const hevc = probeOf([sv({ codec: 'hevc', profile: 'Main' }), sv({ index: 1, type: 'audio', codec: 'aac', channels: 2, width: 0, height: 0 })]);
    const h = harness({ found: { device, port: cast.port }, probe: hevc });
    await h.service.discover();
    live.push({ stop: () => void h.service.closeAll() });
    await h.service.start(device.id, 1, 0, 0);
    expect(h.service.getStatus()).toMatchObject({ mode: 'transcode', seekRestarts: true });
    await h.service.control({ type: 'seek', sec: 50 });
    expect(h.opened).toEqual([{ startSec: 0, mode: 'transcode' }, { startSec: 50, mode: 'transcode' }]);
    expect(cast.received.filter((r) => r.body['type'] === 'LOAD')).toHaveLength(2);
  });
});
