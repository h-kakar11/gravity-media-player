import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { castContentType, isPrivateIPv4, pickLocalAddress, planCast } from '@shared/cast';
import type { ProbeInfo, StreamInfo } from '@shared/types';
import { MessageReader, decodeMessage, encodeMessage } from '../../src/main/cast/castv2';
import { didl, formatHms, parseHms, soapEnvelope } from '../../src/main/cast/dlna';
import { buildQuery, parseAnnouncement, toDevice } from '../../src/main/cast/mdns';
import { CastServer, newToken, parseRange, tokenMatches } from '../../src/main/cast/server';
import { parseDescription, parseSsdpResponse, safeDeviceUrl } from '../../src/main/cast/ssdp';
import { escapeXml, tagText, unescapeXml } from '../../src/main/cast/xml';

const base: StreamInfo = {
  index: 0, type: 'video', codec: 'h264', profile: 'High', level: 41, width: 1920, height: 1080, pixFmt: 'yuv420p', bitDepth: 8,
  fps: 24, bitrate: 0, channels: 0, channelLayout: '', sampleRate: 0, language: '', title: '', isDefault: true, isForced: false,
  attachedPic: false, colorTransfer: '', rotation: 0
};
const v = (o: Partial<StreamInfo> = {}): StreamInfo => ({ ...base, ...o });
const a = (o: Partial<StreamInfo> = {}): StreamInfo => ({ ...base, type: 'audio', codec: 'aac', profile: 'LC', channels: 2, sampleRate: 48000, width: 0, height: 0, index: 1, ...o });
const probe = (streams: StreamInfo[]): ProbeInfo => ({ container: 'mp4', formatName: 'mov,mp4', durationSec: 100, bitrate: 0, size: 0, streams, chapters: [] });

describe('planCast', () => {
  it('sends an H.264/AAC mp4 as it is', () => {
    expect(planCast(probe([v(), a()]), 'mp4', 'dlna', 0).mode).toBe('direct');
    expect(planCast(probe([v(), a()]), 'mp4', 'chromecast', 0).mode).toBe('direct');
  });
  it('repackages H.264/AAC in a container the device cannot open', () => {
    const plan = planCast(probe([v(), a()]), 'mkv', 'dlna', 0);
    expect(plan.mode).toBe('remux');
    expect(plan.reason).toMatch(/MKV/);
  });
  it('converts video the device cannot decode', () => {
    expect(planCast(probe([v({ codec: 'hevc', profile: 'Main' }), a()]), 'mp4', 'dlna', 0).mode).toBe('transcode');
    expect(planCast(probe([v({ profile: 'High 10', bitDepth: 10 }), a()]), 'mp4', 'dlna', 0).mode).toBe('transcode');
    expect(planCast(probe([v({ level: 52 }), a()]), 'mp4', 'dlna', 0).mode).toBe('transcode');
    expect(planCast(probe([v({ colorTransfer: 'smpte2084' }), a()]), 'mp4', 'dlna', 0).mode).toBe('transcode');
  });
  it('converts audio the device cannot decode but keeps the video', () => {
    expect(planCast(probe([v(), a({ codec: 'dts', channels: 6 })]), 'mp4', 'dlna', 0).mode).not.toBe('direct');
    expect(planCast(probe([v(), a({ codec: 'aac', channels: 6 })]), 'mp4', 'dlna', 0).mode).not.toBe('direct');
  });
  it('caps the output height at 1080p when converting 4K', () => {
    const plan = planCast(probe([v({ width: 3840, height: 2160 }), a()]), 'mp4', 'chromecast', 0);
    expect(plan.mode).toBe('transcode');
    expect(plan.maxHeight).toBe(1080);
  });
});

describe('cast helpers', () => {
  it('classifies private addresses', () => {
    for (const ip of ['10.0.0.5', '192.168.1.20', '172.16.0.1', '172.31.255.255', '169.254.1.1', '127.0.0.1']) expect(isPrivateIPv4(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '172.32.0.1', '192.169.0.1', '1.2.3.4', 'example.com', '10.0.0.256', '::1', '']) expect(isPrivateIPv4(ip)).toBe(false);
  });
  it('picks the local address on the device’s subnet', () => {
    const ifs = [{ address: '10.1.2.3', netmask: '255.255.255.0' }, { address: '192.168.1.10', netmask: '255.255.255.0' }];
    expect(pickLocalAddress('192.168.1.55', ifs)).toBe('192.168.1.10');
    expect(pickLocalAddress('192.168.2.55', ifs)).toBeNull();
    expect(pickLocalAddress('not-an-ip', ifs)).toBeNull();
  });
  it('advertises converted streams as mp4', () => {
    expect(castContentType('remux', 'mkv', () => 'video/x-matroska')).toBe('video/mp4');
    expect(castContentType('direct', 'mp4', () => 'video/mp4')).toBe('video/mp4');
  });
});

describe('xml helpers', () => {
  it('unescapes entities without expanding anything else', () => {
    expect(unescapeXml('a &amp; b &lt;c&gt; &#65;&#x42; &bogus;')).toBe('a & b <c> AB &bogus;');
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');
  });
  it('finds tags regardless of namespace prefix', () => {
    expect(tagText('<root><u:Foo xmlns:u="x"> bar </u:Foo></root>', 'Foo')).toBe('bar');
    expect(tagText('<a>nothing</a>', 'b')).toBe('');
  });
});

describe('DLNA', () => {
  it('formats and parses H:MM:SS', () => {
    expect(formatHms(3725)).toBe('1:02:05');
    expect(parseHms('1:02:05.250')).toBe(3725);
    expect(parseHms('NOT_IMPLEMENTED')).toBe(0);
  });
  it('escapes titles inside DIDL and SOAP', () => {
    const d = didl('Tom & <Jerry>', 'http://192.168.1.2:80/x?a=1&b=2', 'video/mp4');
    expect(d).toContain('Tom &amp; &lt;Jerry&gt;');
    expect(d).toContain('a=1&amp;b=2');
    expect(soapEnvelope('Play', { Speed: '1' })).toContain('<u:Play xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><Speed>1</Speed></u:Play>');
  });
  it('parses SSDP replies', () => {
    const h = parseSsdpResponse('HTTP/1.1 200 OK\r\nLOCATION: http://192.168.1.9:49152/desc.xml\r\nST: urn:x\r\n\r\n');
    expect(h['location']).toBe('http://192.168.1.9:49152/desc.xml');
  });
  const desc = `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><device><friendlyName>Living Room &amp; TV</friendlyName><modelName>X1</modelName><UDN>uuid:abc</UDN>
    <serviceList><service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/rc</controlURL></service>
    <service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/avt/control</controlURL></service></serviceList></device></root>`;
  it('reads a renderer description', () => {
    const d = parseDescription(desc, new URL('http://192.168.1.9:49152/desc.xml'));
    expect(d).toEqual({ id: 'uuid:abc', name: 'Living Room & TV', model: 'X1', controlUrl: 'http://192.168.1.9:49152/avt/control' });
  });
  it('rejects a control URL that points at another host', () => {
    const evil = desc.replace('/avt/control', 'http://203.0.113.9/steal');
    expect(parseDescription(evil, new URL('http://192.168.1.9:49152/desc.xml'))).toBeNull();
    expect(parseDescription(desc.replace('/avt/control', 'http://192.168.1.77/other'), new URL('http://192.168.1.9:49152/desc.xml'))).toBeNull();
  });
  it('only follows same-host private http locations (no SSRF)', () => {
    expect(safeDeviceUrl('http://192.168.1.9:80/d.xml', '192.168.1.9')).not.toBeNull();
    expect(safeDeviceUrl('http://192.168.1.10/d.xml', '192.168.1.9')).toBeNull(); // answers for another host
    expect(safeDeviceUrl('http://8.8.8.8/d.xml', '8.8.8.8')).toBeNull(); // public
    expect(safeDeviceUrl('https://192.168.1.9/d.xml', '192.168.1.9')).toBeNull();
    expect(safeDeviceUrl('http://user:pw@192.168.1.9/d.xml', '192.168.1.9')).toBeNull();
    expect(safeDeviceUrl('file:///etc/passwd', '192.168.1.9')).toBeNull();
  });
});

describe('Chromecast wire format', () => {
  const msg = { source: 'sender-0', destination: 'receiver-0', namespace: 'urn:x-cast:com.google.cast.tp.connection', payload: '{"type":"CONNECT"}' };
  it('round-trips a CastMessage', () => {
    const framed = encodeMessage(msg);
    expect(framed.readUInt32BE(0)).toBe(framed.length - 4);
    expect(decodeMessage(framed.subarray(4))).toEqual(msg);
  });
  it('reassembles messages split across, or glued into, TCP chunks', () => {
    const one = encodeMessage(msg);
    const two = encodeMessage({ ...msg, payload: '{"type":"PING"}' });
    const all = Buffer.concat([one, two]);
    const r = new MessageReader();
    const got = [...r.push(all.subarray(0, 7)), ...r.push(all.subarray(7, 40)), ...r.push(all.subarray(40))];
    expect(got.map((m) => m.payload)).toEqual(['{"type":"CONNECT"}', '{"type":"PING"}']);
  });
  it('handles payloads longer than 127 bytes (multi-byte varint lengths)', () => {
    const big = { ...msg, payload: JSON.stringify({ type: 'LOAD', pad: 'x'.repeat(5000) }) };
    expect(decodeMessage(encodeMessage(big).subarray(4)).payload).toBe(big.payload);
  });
  it('refuses oversized frames', () => {
    const r = new MessageReader(1024);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(10_000_000);
    expect(() => r.push(head)).toThrow(/too large/);
  });
  it('rejects a truncated field', () => {
    expect(() => decodeMessage(Buffer.from([0x12, 0x20, 0x41]))).toThrow();
  });
});

describe('mDNS', () => {
  // A PTR + SRV + TXT + A answer as a Chromecast sends it.
  function name(n: string): Buffer { return Buffer.concat([...n.split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])), Buffer.from([0])]); }
  function rr(n: string, type: number, data: Buffer): Buffer {
    const h = Buffer.alloc(10);
    h.writeUInt16BE(type, 0); h.writeUInt16BE(1, 2); h.writeUInt32BE(120, 4); h.writeUInt16BE(data.length, 8);
    return Buffer.concat([name(n), h, data]);
  }
  const svc = '_googlecast._tcp.local';
  const inst = `Chromecast-abc._googlecast._tcp.local`;
  const txtRec = (kv: string[]) => Buffer.concat(kv.map((s) => Buffer.concat([Buffer.from([s.length]), Buffer.from(s)])));
  function packet(ip: number[]): Buffer {
    const srv = Buffer.concat([Buffer.from([0, 0, 0, 0, 0x1f, 0x49]), name('abc.local')]);
    const header = Buffer.alloc(12);
    header.writeUInt16BE(0x8400, 2); header.writeUInt16BE(4, 6);
    return Buffer.concat([header, rr(svc, 12, name(inst)), rr(inst, 33, srv), rr(inst, 16, txtRec(['id=1234abcd', 'fn=Bedroom TV', 'md=Chromecast'])), rr('abc.local', 1, Buffer.from(ip))]);
  }
  it('builds a PTR question with the unicast-response bit', () => {
    const q = buildQuery();
    expect(q.readUInt16BE(4)).toBe(1);
    expect(q.readUInt16BE(q.length - 2)).toBe(0x8001);
  });
  it('reads a Chromecast announcement', () => {
    const { casts, addresses } = parseAnnouncement(packet([192, 168, 1, 40]));
    expect(casts).toHaveLength(1);
    expect(casts[0]).toMatchObject({ port: 8009, host: 'abc.local', txt: { id: '1234abcd', fn: 'Bedroom TV', md: 'Chromecast' } });
    expect(addresses.get('abc.local')).toBe('192.168.1.40');
    expect(toDevice(casts[0]!, '192.168.1.40')).toEqual({ id: 'cast:1234abcd', name: 'Bedroom TV', protocol: 'chromecast', address: '192.168.1.40', model: 'Chromecast' });
  });
  it('ignores devices on public addresses and survives garbage', () => {
    const { casts } = parseAnnouncement(packet([192, 168, 1, 40]));
    expect(toDevice(casts[0]!, '8.8.8.8')).toBeNull();
    expect(() => parseAnnouncement(Buffer.from([1, 2, 3]))).not.toThrow();
    expect(parseAnnouncement(Buffer.alloc(40, 0xff)).casts).toEqual([]);
  });
});

describe('casting server', () => {
  const get = (port: number, path: string, headers: http.OutgoingHttpHeaders = {}, method = 'GET') => new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString(), headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
  const source = { kind: 'stream' as const, mime: 'video/mp4', open: () => new Response('LIVE-BYTES') };

  it('makes unguessable tokens and compares them safely', () => {
    const t = newToken();
    expect(t).toMatch(/^[0-9a-f]{32}$/);
    expect(newToken()).not.toBe(t);
    expect(tokenMatches(t, t)).toBe(true);
    expect(tokenMatches(t, newToken())).toBe(false);
    expect(tokenMatches('short', t)).toBe(false);
  });
  it('parses ranges', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=200-', 100)).toBe('bad');
    expect(parseRange('bytes=0-1,5-6', 100)).toBe('bad');
  });
  it('serves the session only with the right token, to the right device, over GET/HEAD', async () => {
    const server = new CastServer('127.0.0.1');
    await server.listen('127.0.0.1');
    server.setSource(source);
    const path = new URL(server.url('127.0.0.1')).pathname;
    try {
      const ok = await get(server.port, path);
      expect(ok.status).toBe(200);
      expect(ok.body).toBe('LIVE-BYTES');
      expect(ok.headers['content-type']).toBe('video/mp4');
      expect((await get(server.port, path, {}, 'HEAD')).status).toBe(200);
      expect((await get(server.port, path.replace(server.token, newToken()))).status).toBe(404);
      expect((await get(server.port, '/cast/' + server.token + '/../../etc/passwd')).status).toBe(404);
      expect((await get(server.port, '/')).status).toBe(404);
      expect((await get(server.port, path, {}, 'POST')).status).toBe(405);
    } finally { server.close(); }
  });
  it('refuses clients other than the chosen device', async () => {
    const server = new CastServer('192.168.1.99'); // anyone connecting from loopback is "someone else"
    await server.listen('127.0.0.1');
    server.setSource(source);
    try {
      expect((await get(server.port, new URL(server.url('127.0.0.1')).pathname)).status).toBe(403);
    } finally { server.close(); }
  });
  it('stops listening when closed', async () => {
    const server = new CastServer('127.0.0.1');
    await server.listen('127.0.0.1');
    const port = server.port;
    server.close();
    await expect(get(port, '/')).rejects.toThrow();
  });
});
