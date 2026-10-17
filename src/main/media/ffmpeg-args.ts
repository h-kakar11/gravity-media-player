import type { PlaybackMode, ProbeInfo, StreamInfo } from '@shared/types';

export type Quality = 'fast' | 'balanced' | 'high';

export interface StreamArgsInput {
  file: string;
  mode: Exclude<PlaybackMode, 'direct'>;
  /** Media time at which the output starts (already snapped to a keyframe for stream copy). */
  startSec: number;
  probe: ProbeInfo;
  audioIndex: number;
  /** Absolute index of a subtitle stream to burn in, or -1. */
  burnSubtitle: number;
  maxHeight: number;
  /** Encoder chosen for transcodes (libx264 or a working hardware encoder). */
  encoder: string;
  quality: Quality;
  hasZscale: boolean;
}

export interface StreamPlan {
  args: string[];
  videoOut: string;
  audioOut: string;
  encoder: string;
}

const COPY_AUDIO = new Set(['aac', 'mp3', 'opus', 'flac']);

const CRF: Record<Quality, number> = { fast: 26, balanced: 22, high: 18 };
const X264_PRESET: Record<Quality, string> = { fast: 'superfast', balanced: 'veryfast', high: 'fast' };

export function isHdr(v: StreamInfo | undefined): boolean {
  return !!v && (v.colorTransfer === 'smpte2084' || v.colorTransfer === 'arib-std-b67');
}

/**
 * Build ffmpeg arguments that turn a source file into a fragmented MP4 on stdout.
 *  - `remux` copies the video stream untouched and converts audio only when needed.
 *  - `transcode` re-encodes video (hardware when available) and audio to AAC.
 * Frame rate is never altered, so 120/240/300 fps sources keep their cadence.
 */
export function buildStreamArgs(i: StreamArgsInput): StreamPlan {
  const video = i.probe.streams.find((s) => s.type === 'video' && !s.attachedPic);
  const audios = i.probe.streams.filter((s) => s.type === 'audio');
  const audio = audios[Math.min(Math.max(0, i.audioIndex), Math.max(0, audios.length - 1))];
  if (!video) throw new Error('No video stream');

  const args: string[] = [];
  const hw = i.mode === 'transcode' && /vaapi/.test(i.encoder);
  if (hw) args.push('-vaapi_device', '/dev/dri/renderD128');
  if (i.startSec > 0.05) args.push('-ss', i.startSec.toFixed(3));
  args.push('-i', i.file);

  const burn = i.burnSubtitle >= 0 && i.mode === 'transcode';
  const filters: string[] = [];
  if (i.mode === 'transcode') {
    if (isHdr(video)) {
      if (i.hasZscale) filters.push('zscale=t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709', 'tonemap=tonemap=hable:desat=0', 'zscale=t=bt709:m=bt709:r=tv');
      else filters.push('colorspace=all=bt709:iall=bt2020:fast=1');
    }
    if (i.maxHeight > 0 && video.height > i.maxHeight) filters.push(`scale=-2:${i.maxHeight}`);
    filters.push(hw ? 'format=nv12,hwupload' : 'format=yuv420p');
  }

  if (burn) {
    const chain = filters.length ? `,${filters.join(',')}` : '';
    args.push('-filter_complex', `[0:${video.index}][0:${i.burnSubtitle}]overlay=format=auto${chain}[v]`, '-map', '[v]');
  } else {
    args.push('-map', `0:${video.index}`);
    if (filters.length) args.push('-vf', filters.join(','));
  }
  if (audio) args.push('-map', `0:${audio.index}`);
  args.push('-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1');

  let encoder = 'copy';
  let videoOut = video.codec;
  if (i.mode === 'remux') {
    args.push('-c:v', 'copy');
    if (video.codec === 'hevc') args.push('-tag:v', 'hvc1');
  } else {
    encoder = i.encoder;
    videoOut = 'h264';
    const fps = video.fps > 0 ? video.fps : 30;
    const gop = Math.max(12, Math.round(fps * 2));
    const crf = CRF[i.quality];
    switch (i.encoder) {
      case 'h264_videotoolbox':
        args.push('-c:v', i.encoder, '-q:v', String(Math.round(100 - crf * 1.6)), '-allow_sw', '1', '-profile:v', 'high', '-g', String(gop));
        break;
      case 'h264_nvenc':
        args.push('-c:v', i.encoder, '-preset', 'p4', '-rc', 'vbr', '-cq', String(crf + 2), '-b:v', '0', '-profile:v', 'high', '-g', String(gop));
        break;
      case 'h264_qsv':
        args.push('-c:v', i.encoder, '-global_quality', String(crf + 2), '-preset', 'veryfast', '-g', String(gop));
        break;
      case 'h264_amf':
        args.push('-c:v', i.encoder, '-quality', 'speed', '-rc', 'cqp', '-qp_i', String(crf), '-qp_p', String(crf + 2), '-g', String(gop));
        break;
      case 'h264_vaapi':
        args.push('-c:v', i.encoder, '-qp', String(crf + 1), '-g', String(gop));
        break;
      default:
        encoder = 'libx264';
        args.push('-c:v', 'libx264', '-preset', X264_PRESET[i.quality], '-crf', String(crf), '-profile:v', 'high', '-g', String(gop), '-keyint_min', String(Math.max(1, Math.round(gop / 2))), '-sc_threshold', '0', '-x264-params', 'rc-lookahead=12');
    }
  }

  let audioOut = 'none';
  if (audio) {
    if (COPY_AUDIO.has(audio.codec) && audio.channels <= 2) {
      args.push('-c:a', 'copy');
      audioOut = audio.codec;
    } else {
      args.push('-c:a', 'aac', '-b:a', audio.channels > 2 ? '256k' : '192k', '-ac', '2', '-af', 'aresample=async=1:first_pts=0');
      audioOut = 'aac';
    }
  }

  args.push('-avoid_negative_ts', 'make_zero', '-max_muxing_queue_size', '2048', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', 'pipe:1');
  return { args, videoOut, audioOut, encoder };
}

export interface AudioStreamInput {
  file: string;
  startSec: number;
  probe: ProbeInfo;
  audioIndex: number;
}

/** Audio-only conversion for formats Chromium can't decode (ALAC, APE, WavPack, DSD, WMA…). Output is streamable FLAC. */
export function buildAudioArgs(i: AudioStreamInput): { args: string[]; mime: string } {
  const audios = i.probe.streams.filter((s) => s.type === 'audio');
  const a = audios[Math.min(Math.max(0, i.audioIndex), Math.max(0, audios.length - 1))];
  const args: string[] = [];
  if (i.startSec > 0.05) args.push('-ss', i.startSec.toFixed(3));
  args.push('-i', i.file, '-vn', '-sn', '-dn', '-map', a ? `0:${a.index}` : '0:a:0', '-map_metadata', '-1');
  if (a?.codec.startsWith('dsd')) args.push('-af', 'aresample=88200', '-sample_fmt', 's32');
  else if ((a?.sampleRate ?? 0) > 192000) args.push('-ar', '192000');
  args.push('-c:a', 'flac', '-compression_level', '0', '-f', 'flac', 'pipe:1');
  return { args, mime: 'audio/flac' };
}

/** One frame at time `t`, scaled to `width`, as JPEG on stdout — keyframe-only decode keeps disk reads tiny. */
export function buildThumbArgs(file: string, t: number, width: number): string[] {
  return [
    '-skip_frame', 'nokey', '-noaccurate_seek', '-ss', Math.max(0, t).toFixed(2), '-i', file,
    '-frames:v', '1', '-an', '-sn', '-dn', '-vf', `scale=${width}:-2`, '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '6', 'pipe:1'
  ];
}
