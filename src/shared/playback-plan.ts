import type { PlaybackMode, ProbeInfo, StreamInfo } from './types';
import { NATIVE_VIDEO_CONTAINERS } from './formats';

/**
 * Decides how a file should be played:
 *  - direct:    Chromium demuxes + decodes the file itself (range requests, no ffmpeg)
 *  - remux:     stream-copy into fragmented MP4 (cheap) — used for multi-audio files or
 *               when only the container/audio is unsupported
 *  - transcode: re-encode video (and audio) with ffmpeg
 *
 * The planner is a pure function. The renderer supplies `supported`, a set of MIME strings
 * (see `candidateMimes`) that its media stack reported as playable.
 */

export function containerMime(container: string, kind: 'video' | 'audio'): string {
  const c = container.toLowerCase();
  if (c === 'mkv' || c === 'matroska') return kind === 'video' ? 'video/x-matroska' : 'audio/x-matroska';
  if (c === 'webm') return kind === 'video' ? 'video/webm' : 'audio/webm';
  if (c === 'ogv' || c === 'ogg') return kind === 'video' ? 'video/ogg' : 'audio/ogg';
  return kind === 'video' ? 'video/mp4' : 'audio/mp4';
}

const H264_PROFILES: Record<string, string> = {
  'constrained baseline': '42', baseline: '42', main: '4D', extended: '58', high: '64',
  'high 10': '6E', 'high 10 intra': '6E', 'high 4:2:2': '7A', 'high 4:2:2 intra': '7A',
  'high 4:4:4 predictive': 'F4', 'high 4:4:4 intra': 'F4'
};

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');

/** RFC 6381 style codec string for a video stream, or null if the codec can't be expressed / played. */
export function videoCodecString(s: StreamInfo): string | null {
  switch (s.codec) {
    case 'h264': {
      const profile = H264_PROFILES[s.profile.toLowerCase()] ?? '64';
      const constraints = s.profile.toLowerCase() === 'constrained baseline' ? 'C0' : '00';
      return `avc1.${profile}${constraints}${hex2(s.level > 0 ? s.level : 40)}`;
    }
    case 'hevc': {
      const main10 = s.bitDepth > 8 || /main 10/i.test(s.profile);
      const level = s.level > 0 ? s.level : 120;
      return `hvc1.${main10 ? '2.4' : '1.6'}.L${level}.B0`;
    }
    case 'vp9': {
      const p2 = s.bitDepth > 8 ? '02' : '00';
      return `vp09.${p2}.${s.height > 1080 ? '50' : '41'}.${String(s.bitDepth || 8).padStart(2, '0')}`;
    }
    case 'av1': {
      const lvl = s.height > 2160 ? '16' : s.height > 1080 ? '12' : '08';
      return `av01.0.${lvl}M.${String(s.bitDepth || 8).padStart(2, '0')}`;
    }
    case 'vp8': return 'vp8';
    case 'theora': return 'theora';
    case 'mpeg4': return 'mp4v.20.9';
    default: return null;
  }
}

export function audioCodecString(s: StreamInfo): string | null {
  switch (s.codec) {
    case 'aac': return /he-aac|he_aac/i.test(s.profile) ? 'mp4a.40.5' : 'mp4a.40.2';
    case 'mp3': return 'mp3';
    case 'opus': return 'opus';
    case 'vorbis': return 'vorbis';
    case 'flac': return 'flac';
    case 'ac3': return 'ac-3';
    case 'eac3': return 'ec-3';
    case 'alac': return 'alac';
    default:
      if (s.codec.startsWith('pcm_')) return '1';
      return null;
  }
}

export function videoMime(container: string, s: StreamInfo): string | null {
  const cs = videoCodecString(s);
  return cs ? `${containerMime(container, 'video')}; codecs="${cs}"` : null;
}

export function audioMime(container: string, s: StreamInfo): string | null {
  const cs = audioCodecString(s);
  return cs ? `${containerMime(container, 'audio')}; codecs="${cs}"` : null;
}

/** Codecs that can live inside the fragmented MP4 we emit for remux/transcode. */
const MP4_VIDEO_COPY = new Set(['h264', 'hevc', 'vp9', 'av1']);
const MP4_AUDIO_COPY = new Set(['aac', 'mp3', 'opus', 'flac', 'ac3', 'eac3', 'alac']);

export interface PlanInput {
  probe: ProbeInfo;
  /** File extension without the dot, lowercase. */
  ext: string;
  /** MIME strings the platform reported as supported. */
  supported: Set<string>;
  /** Preferred audio stream (0-based among audio streams). */
  audioIndex: number;
  /** Absolute stream index of a bitmap subtitle to burn in, or -1. */
  burnSubtitle?: number;
  maxHeight?: number;
  /** User forced a mode (for troubleshooting or after a playback failure). */
  force?: PlaybackMode;
}

export interface Plan {
  mode: PlaybackMode;
  reason: string;
  audioIndex: number;
  maxHeight: number;
}

/** MIME strings worth asking the platform about for this file. */
export function candidateMimes(probe: ProbeInfo, ext: string): string[] {
  const container = ext;
  const out: string[] = [];
  const v = probe.streams.find((s) => s.type === 'video' && !s.attachedPic);
  if (v) {
    const m = videoMime(container, v);
    if (m) out.push(m);
    const mp4 = videoMime('mp4', v); // what the remux path would produce
    if (mp4) out.push(mp4);
  }
  for (const a of probe.streams.filter((s) => s.type === 'audio')) {
    const m = audioMime(container, a);
    if (m) out.push(m);
    const mp4 = audioMime('mp4', a);
    if (mp4) out.push(mp4);
  }
  return [...new Set(out)];
}

export function planPlayback(input: PlanInput): Plan {
  const { probe, ext, supported } = input;
  const video = probe.streams.find((s) => s.type === 'video' && !s.attachedPic);
  const audios = probe.streams.filter((s) => s.type === 'audio');
  const audioIndex = Math.min(Math.max(0, input.audioIndex), Math.max(0, audios.length - 1));
  const audio = audios[audioIndex];
  const maxHeight = input.maxHeight ?? 0;
  const burn = (input.burnSubtitle ?? -1) >= 0;

  if (input.force) return { mode: input.force, reason: 'Forced by user', audioIndex, maxHeight };

  if (!video) {
    // Audio-only file played in the video player: let the audio path handle it.
    const am = audio ? audioMime(ext, audio) : null;
    return am && supported.has(am) && NATIVE_VIDEO_CONTAINERS.has(ext)
      ? { mode: 'direct', reason: 'Native audio', audioIndex, maxHeight }
      : { mode: 'transcode', reason: 'Audio format needs conversion', audioIndex, maxHeight };
  }

  const vm = videoMime(ext, video);
  const vmMp4 = videoMime('mp4', video);
  const videoNative = !!vm && supported.has(vm);
  const videoRemuxable = MP4_VIDEO_COPY.has(video.codec) && !!vmMp4 && supported.has(vmMp4);
  const am = audio ? audioMime(ext, audio) : null;
  const amMp4 = audio ? audioMime('mp4', audio) : null;
  const audioNative = !audio || (!!am && supported.has(am));
  const audioRemuxable = !audio || (MP4_AUDIO_COPY.has(audio.codec) && !!amMp4 && supported.has(amMp4));
  const containerNative = NATIVE_VIDEO_CONTAINERS.has(ext);
  const tooTall = maxHeight > 0 && video.height > maxHeight;

  if (burn || tooTall) {
    return { mode: 'transcode', reason: burn ? 'Burning in image-based subtitles' : `Limiting resolution to ${maxHeight}p`, audioIndex, maxHeight };
  }

  if (videoNative && audioNative && containerNative && audios.length <= 1) {
    return { mode: 'direct', reason: 'Direct play', audioIndex, maxHeight };
  }

  if (videoRemuxable) {
    const why: string[] = [];
    if (audios.length > 1) why.push('selecting among multiple audio tracks');
    if (!containerNative) why.push(`${ext.toUpperCase()} container isn't supported natively`);
    if (!audioNative || !audioRemuxable) why.push(`audio (${audio?.codec.toUpperCase()}) is converted to AAC`);
    return { mode: 'remux', reason: `Direct stream: ${why.join(', ') || 'repackaging'}`, audioIndex, maxHeight };
  }

  return {
    mode: 'transcode',
    reason: `Video codec ${video.codec.toUpperCase()}${video.bitDepth > 8 ? ` ${video.bitDepth}-bit` : ''} isn't supported by this system — converting`,
    audioIndex,
    maxHeight
  };
}

/** Pick the audio track to use given language preferences and flags. */
export function chooseAudioIndex(audios: StreamInfo[], preferredLangs: string[], rememberedIndex: number | null): number {
  if (rememberedIndex != null && rememberedIndex >= 0 && rememberedIndex < audios.length) return rememberedIndex;
  for (const lang of preferredLangs) {
    const i = audios.findIndex((a) => langMatches(a.language, lang));
    if (i >= 0) return i;
  }
  const def = audios.findIndex((a) => a.isDefault);
  return def >= 0 ? def : 0;
}

export function langMatches(a: string, b: string): boolean {
  if (!a || !b) return false;
  const na = normalizeLang(a), nb = normalizeLang(b);
  return na === nb;
}

const LANG_ALIASES: Record<string, string> = {
  eng: 'en', jpn: 'ja', spa: 'es', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', ita: 'it', por: 'pt',
  rus: 'ru', kor: 'ko', chi: 'zh', zho: 'zh', ara: 'ar', hin: 'hi', dut: 'nl', nld: 'nl', swe: 'sv',
  nor: 'no', dan: 'da', fin: 'fi', pol: 'pl', tur: 'tr', cze: 'cs', ces: 'cs', hun: 'hu', gre: 'el',
  ell: 'el', heb: 'he', tha: 'th', vie: 'vi', ind: 'id', ukr: 'uk', rum: 'ro', ron: 'ro'
};

export function normalizeLang(l: string): string {
  const x = l.toLowerCase().split(/[-_]/)[0]!;
  return LANG_ALIASES[x] ?? x;
}

const LANG_NAMES = new Intl.DisplayNames(['en'], { type: 'language' });

export function languageName(code: string): string {
  if (!code || code === 'und') return '';
  try {
    return LANG_NAMES.of(normalizeLang(code)) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

export function audioTrackLabel(a: StreamInfo, i: number): string {
  const lang = languageName(a.language);
  const ch = a.channels >= 8 ? '7.1' : a.channels >= 6 ? '5.1' : a.channels === 2 ? 'Stereo' : a.channels === 1 ? 'Mono' : '';
  const codec = a.codec.toUpperCase().replace('EAC3', 'Dolby Digital+').replace('AC3', 'Dolby Digital').replace('TRUEHD', 'Dolby TrueHD');
  const bits = [lang || a.title || `Track ${i + 1}`, [codec, ch].filter(Boolean).join(' ')].filter(Boolean);
  return bits.join(' · ');
}
