import { formatBitrate, formatResolution } from '../../shared/format';

/** The probe-derived fields used to rank copies of the same title. */
export interface QualityInput {
  path: string;
  size: number;
  durationSec: number;
  width: number;
  height: number;
  vcodec: string;
  bitrate: number;
}

/** Newer, more efficient codecs rank higher at the same resolution. Unknown codecs sit in the middle. */
const CODEC_RANK: Record<string, number> = {
  av1: 5,
  hevc: 4, h265: 4,
  vp9: 3,
  h264: 2, avc: 2, avc1: 2,
  vp8: 1, mpeg4: 1, xvid: 1, divx: 1, msmpeg4v3: 1,
  mpeg2video: 0, mpeg1video: 0, vc1: 0, wmv3: 0, wmv2: 0, wmv1: 0
};
const UNKNOWN_CODEC = 1.5;

const CODEC_LABEL: Record<string, string> = {
  av1: 'AV1', hevc: 'HEVC', h265: 'HEVC', vp9: 'VP9', h264: 'H.264', avc: 'H.264', avc1: 'H.264',
  vp8: 'VP8', mpeg4: 'MPEG-4', xvid: 'Xvid', divx: 'DivX', mpeg2video: 'MPEG-2', mpeg1video: 'MPEG-1', vc1: 'VC-1'
};

/** A bitrate this much lower than the best copy's is worth a mention; smaller gaps are encoder noise. */
const BITRATE_TOLERANCE = 0.85;

export function codecLabel(vcodec: string): string {
  const k = vcodec.toLowerCase();
  return CODEC_LABEL[k] ?? (k ? k.toUpperCase() : '');
}

/** Pixel rows, widened for letterboxed (scope) sources the same way `formatResolution` does. */
export function resolutionRows(width: number, height: number): number {
  if (!width || !height) return 0;
  return Math.max(height, Math.round((width * 9) / 16));
}

/** Reported bitrate, or an estimate from size and duration when the container did not report one. */
export function effectiveBitrate(q: Pick<QualityInput, 'bitrate' | 'size' | 'durationSec'>): number {
  if (q.bitrate > 0) return q.bitrate;
  return q.durationSec > 0 && q.size > 0 ? Math.round((q.size * 8) / q.durationSec) : 0;
}

function codecRank(vcodec: string): number | null {
  if (!vcodec) return null;
  return CODEC_RANK[vcodec.toLowerCase()] ?? UNKNOWN_CODEC;
}

/** "1080p · HEVC · 8.2 Mbps" from whatever is known. */
export function describeQuality(q: QualityInput): string {
  return [formatResolution(q.width, q.height), codecLabel(q.vcodec), formatBitrate(effectiveBitrate(q))].filter(Boolean).join(' · ');
}

/**
 * Total order used to pick the copy to keep: resolution, then codec generation, then bitrate, then
 * file size, with the path as a final deterministic tiebreak. Better copies sort first.
 */
export function compareQuality(a: QualityInput, b: QualityInput): number {
  const ra = resolutionRows(a.width, a.height), rb = resolutionRows(b.width, b.height);
  if (ra !== rb) return rb - ra;
  const ca = codecRank(a.vcodec) ?? -1, cb = codecRank(b.vcodec) ?? -1;
  if (ca !== cb) return cb - ca;
  const ba = effectiveBitrate(a), bb = effectiveBitrate(b);
  if (ba !== bb) return bb - ba;
  if (a.size !== b.size) return b.size - a.size;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/**
 * Human-readable reasons `copy` ranks below `best`. An empty result means the two are
 * indistinguishable on resolution, codec and bitrate.
 */
export function lowerQualityReasons(copy: QualityInput, best: QualityInput): string[] {
  const reasons: string[] = [];
  const rc = resolutionRows(copy.width, copy.height), rb = resolutionRows(best.width, best.height);
  if (rb > 0 && rc === 0) reasons.push('Resolution could not be read');
  else if (rc < rb) reasons.push(`Lower resolution (${formatResolution(copy.width, copy.height)} vs ${formatResolution(best.width, best.height)})`);

  const cc = codecRank(copy.vcodec), cb = codecRank(best.vcodec);
  if (cc != null && cb != null && cc < cb) reasons.push(`Older codec (${codecLabel(copy.vcodec)} vs ${codecLabel(best.vcodec)})`);

  const bc = effectiveBitrate(copy), bb = effectiveBitrate(best);
  if (bb > 0 && bc > 0 && bc < bb * BITRATE_TOLERANCE) reasons.push(`Lower bitrate (${formatBitrate(bc)} vs ${formatBitrate(bb)})`);
  return reasons;
}
