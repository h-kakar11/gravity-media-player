import { audioMime, planPlayback, videoMime, type Plan } from './playback-plan';
import type { PlaybackMode, ProbeInfo, StreamInfo } from './types';

export type CastProtocol = 'dlna' | 'chromecast';

export interface CastDevice {
  /** Stable across scans: the UDN for DLNA, the mDNS `id` for Chromecast. */
  id: string;
  name: string;
  protocol: CastProtocol;
  /** The device's LAN address. Only this address is allowed to fetch the stream. */
  address: string;
  model: string;
}

export type CastState = 'idle' | 'connecting' | 'buffering' | 'playing' | 'paused' | 'error';

export interface CastStatus {
  state: CastState;
  device: CastDevice | null;
  mediaId: number | null;
  title: string;
  /** Position within the title, in seconds. */
  positionSec: number;
  durationSec: number;
  /** How the file is being served to the device. */
  mode: PlaybackMode | null;
  reason: string;
  /** True when the stream is live (remuxed/transcoded), so seeking restarts it. */
  seekRestarts: boolean;
  error: string | null;
}

export type CastCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'seek'; sec: number };

export const IDLE_CAST: CastStatus = {
  state: 'idle', device: null, mediaId: null, title: '', positionSec: 0, durationSec: 0, mode: null, reason: '', seekRestarts: false, error: null
};

/** What a kind of device can be handed as-is. Deliberately conservative: anything else is converted. */
export interface CastProfile {
  containers: Set<string>;
  maxHeight: number;
  /** Highest H.264 level, in ffprobe's units (42 = 4.2). */
  maxH264Level: number;
}

const PROFILE: CastProfile = { containers: new Set(['mp4', 'm4v']), maxHeight: 1080, maxH264Level: 42 };
export const castProfile = (_protocol: CastProtocol): CastProfile => PROFILE;

const BAD_H264_PROFILES = /high 10|4:2:2|4:4:4|extended/i;
const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67']);

function videoOk(s: StreamInfo, p: CastProfile): boolean {
  return s.codec === 'h264' && s.bitDepth <= 8 && !BAD_H264_PROFILES.test(s.profile) && (s.level <= 0 || s.level <= p.maxH264Level)
    && s.height <= p.maxHeight && !HDR_TRANSFERS.has(s.colorTransfer) && s.rotation === 0;
}
const audioOk = (s: StreamInfo) => (s.codec === 'aac' || s.codec === 'mp3') && s.channels <= 2;

/**
 * Decide how to serve a file to a cast device. This reuses the player's own planner
 * (`planPlayback`): the device profile is turned into the set of MIME strings the "platform"
 * supports, and containers the device can't open are hidden from the planner so it falls
 * through to remux or transcode.
 */
export function planCast(probe: ProbeInfo, ext: string, protocol: CastProtocol, audioIndex: number): Plan {
  const profile = castProfile(protocol);
  const e = ext.toLowerCase();
  const containerOk = profile.containers.has(e);
  // A container the planner does not consider native, so it never picks "direct" for it.
  const plannerExt = containerOk ? e : 'avi';
  const supported = new Set<string>();
  const v = probe.streams.find((s) => s.type === 'video' && !s.attachedPic);
  if (v && videoOk(v, profile)) for (const c of [plannerExt, 'mp4']) { const m = videoMime(c, v); if (m) supported.add(m); }
  for (const a of probe.streams.filter((s) => s.type === 'audio')) {
    if (!audioOk(a)) continue;
    for (const c of [plannerExt, 'mp4']) { const m = audioMime(c, a); if (m) supported.add(m); }
  }
  const plan = planPlayback({ probe, ext: plannerExt, supported, audioIndex, maxHeight: v && v.height > profile.maxHeight ? profile.maxHeight : 0 });
  if (!containerOk && plan.mode !== 'direct') {
    return { ...plan, reason: plan.mode === 'remux' ? `Repackaging ${e.toUpperCase()} for the device` : plan.reason.replace(/AVI/g, e.toUpperCase()) };
  }
  return plan;
}

/** `file.mp4` style MIME the device is told it is receiving. */
export function castContentType(mode: PlaybackMode, ext: string, mimeForExt: (ext: string) => string): string {
  return mode === 'direct' ? mimeForExt(ext) : 'video/mp4';
}

/** The local address to serve from: the one on the same IPv4 /24 as the device, else the first private one. */
export function pickLocalAddress(deviceAddress: string, local: { address: string; netmask: string }[]): string | null {
  const toInt = (ip: string) => ip.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
  const valid = (ip: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && ip.split('.').every((o) => Number(o) <= 255);
  if (!valid(deviceAddress)) return null;
  const candidates = local.filter((l) => valid(l.address) && valid(l.netmask));
  const same = candidates.find((l) => (toInt(l.address) & toInt(l.netmask)) === (toInt(deviceAddress) & toInt(l.netmask)));
  return same?.address ?? null;
}

/** Only private, link-local and loopback IPv4 addresses are ever contacted or served. */
export function isPrivateIPv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return false;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}
