import { MAX_XML_BYTES, escapeXml, tagText } from './xml';

const SERVICE = 'urn:schemas-upnp-org:service:AVTransport:1';

export function formatHms(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function parseHms(v: string): number {
  const m = /^(\d+):(\d{1,2}):(\d{1,2})(?:\.\d+)?$/.exec(v.trim());
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

export function didl(title: string, url: string, mime: string): string {
  return '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">'
    + `<item id="0" parentID="-1" restricted="1"><dc:title>${escapeXml(title)}</dc:title><upnp:class>object.item.videoItem</upnp:class>`
    + `<res protocolInfo="http-get:*:${escapeXml(mime)}:*">${escapeXml(url)}</res></item></DIDL-Lite>`;
}

export function soapEnvelope(action: string, args: Record<string, string>): string {
  const body = Object.entries(args).map(([k, v]) => `<${k}>${escapeXml(v)}</${k}>`).join('');
  return '<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">'
    + `<s:Body><u:${action} xmlns:u="${SERVICE}">${body}</u:${action}></s:Body></s:Envelope>`;
}

export interface DlnaPosition { positionSec: number; durationSec: number }
export type DlnaTransportState = 'PLAYING' | 'PAUSED_PLAYBACK' | 'STOPPED' | 'TRANSITIONING' | 'NO_MEDIA_PRESENT' | string;

/** Minimal AVTransport control point: the handful of actions needed to play, pause, seek and stop. */
export class DlnaClient {
  constructor(private readonly controlUrl: string, private readonly timeoutMs = 5000) {}

  private async call(action: string, args: Record<string, string>): Promise<string> {
    const res = await fetch(this.controlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: `"${SERVICE}#${action}"` },
      body: soapEnvelope(action, { InstanceID: '0', ...args }),
      signal: AbortSignal.timeout(this.timeoutMs),
      redirect: 'error'
    });
    const text = await res.text();
    if (text.length > MAX_XML_BYTES) throw new Error('Renderer reply too large');
    if (!res.ok) {
      const desc = tagText(text, 'errorDescription');
      throw new Error(`Renderer refused ${action}${desc ? `: ${desc}` : ` (HTTP ${res.status})`}`);
    }
    return text;
  }

  async setUri(url: string, title: string, mime: string): Promise<void> {
    await this.call('SetAVTransportURI', { CurrentURI: url, CurrentURIMetaData: didl(title, url, mime) });
  }
  async play(): Promise<void> { await this.call('Play', { Speed: '1' }); }
  async pause(): Promise<void> { await this.call('Pause', {}); }
  async stop(): Promise<void> { await this.call('Stop', {}); }
  async seek(sec: number): Promise<void> { await this.call('Seek', { Unit: 'REL_TIME', Target: formatHms(sec) }); }

  async position(): Promise<DlnaPosition> {
    const x = await this.call('GetPositionInfo', {});
    return { positionSec: parseHms(tagText(x, 'RelTime')), durationSec: parseHms(tagText(x, 'TrackDuration')) };
  }
  async transportState(): Promise<DlnaTransportState> {
    return tagText(await this.call('GetTransportInfo', {}), 'CurrentTransportState');
  }
}
