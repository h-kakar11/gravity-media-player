import { describe, expect, it } from 'vitest';
import { audioMime, candidateMimes, chooseAudioIndex, planPlayback, videoCodecString, videoMime } from '@shared/playback-plan';
import type { ProbeInfo, StreamInfo } from '@shared/types';

const base: StreamInfo = {
  index: 0, type: 'video', codec: 'h264', profile: 'High', level: 41, width: 1920, height: 1080, pixFmt: 'yuv420p', bitDepth: 8,
  fps: 24, bitrate: 0, channels: 0, channelLayout: '', sampleRate: 0, language: '', title: '', isDefault: true, isForced: false,
  attachedPic: false, colorTransfer: '', rotation: 0
};
const v = (o: Partial<StreamInfo> = {}): StreamInfo => ({ ...base, ...o });
const a = (o: Partial<StreamInfo> = {}): StreamInfo => ({ ...base, type: 'audio', codec: 'aac', profile: 'LC', channels: 2, sampleRate: 48000, width: 0, height: 0, index: 1, ...o });
const probe = (streams: StreamInfo[]): ProbeInfo => ({ container: 'mp4', formatName: 'mov,mp4', durationSec: 100, bitrate: 0, size: 0, streams, chapters: [] });
// A fake platform that plays h264/vp9/av1 + aac/mp3/opus/flac, but not hevc/ac3.
const platform = (p: ProbeInfo, ext: string): Set<string> => {
  const ok = new Set<string>();
  for (const m of candidateMimes(p, ext)) if (!/hvc1|ac-3|ec-3/.test(m)) ok.add(m);
  return ok;
};

describe('codec strings', () => {
  it('builds avc1 strings from profile and level', () => {
    expect(videoCodecString(v())).toBe('avc1.640029');
    expect(videoCodecString(v({ profile: 'Main', level: 31 }))).toBe('avc1.4D001F');
    expect(videoCodecString(v({ profile: 'High 10', bitDepth: 10, level: 51 }))).toBe('avc1.6E0033');
    expect(videoCodecString(v({ codec: 'mpeg2video' }))).toBeNull();
  });
  it('wraps with the container mime', () => {
    expect(videoMime('mkv', v())).toBe('video/x-matroska; codecs="avc1.640029"');
    expect(audioMime('mp4', a({ codec: 'ac3' }))).toBe('audio/mp4; codecs="ac-3"');
  });
});

describe('planPlayback', () => {
  it('direct plays h264/aac mp4', () => {
    const p = probe([v(), a()]);
    expect(planPlayback({ probe: p, ext: 'mp4', supported: platform(p, 'mp4'), audioIndex: 0 }).mode).toBe('direct');
  });
  it('remuxes when there are multiple audio tracks', () => {
    const p = probe([v(), a(), a({ index: 2 })]);
    const plan = planPlayback({ probe: p, ext: 'mkv', supported: platform(p, 'mkv'), audioIndex: 1 });
    expect(plan).toMatchObject({ mode: 'remux', audioIndex: 1 });
  });
  it('remuxes avi-wrapped h264', () => {
    const p = probe([v(), a({ codec: 'mp3' })]);
    expect(planPlayback({ probe: p, ext: 'avi', supported: platform(p, 'avi'), audioIndex: 0 }).mode).toBe('remux');
  });
  it('transcodes unsupported video codecs', () => {
    const p = probe([v({ codec: 'hevc', profile: 'Main', level: 120 }), a({ codec: 'ac3' })]);
    const plan = planPlayback({ probe: p, ext: 'mkv', supported: platform(p, 'mkv'), audioIndex: 0 });
    expect(plan.mode).toBe('transcode');
    expect(plan.reason).toMatch(/HEVC/);
  });
  it('transcodes to burn subtitles or cap resolution', () => {
    const p = probe([v(), a()]);
    const sup = platform(p, 'mp4');
    expect(planPlayback({ probe: p, ext: 'mp4', supported: sup, audioIndex: 0, burnSubtitle: 3 }).mode).toBe('transcode');
    expect(planPlayback({ probe: p, ext: 'mp4', supported: sup, audioIndex: 0, maxHeight: 720 }).mode).toBe('transcode');
  });
  it('honours force', () => {
    const p = probe([v(), a()]);
    expect(planPlayback({ probe: p, ext: 'mp4', supported: platform(p, 'mp4'), audioIndex: 0, force: 'transcode' }).mode).toBe('transcode');
  });
  it('clamps an out-of-range audio index', () => {
    const p = probe([v(), a()]);
    expect(planPlayback({ probe: p, ext: 'mp4', supported: platform(p, 'mp4'), audioIndex: 9 }).audioIndex).toBe(0);
  });
});

describe('chooseAudioIndex', () => {
  const tracks = [a({ language: 'eng', isDefault: false }), a({ language: 'jpn', isDefault: true }), a({ language: 'spa', isDefault: false })];
  it('prefers remembered then language then default', () => {
    expect(chooseAudioIndex(tracks, ['es'], 0)).toBe(0);
    expect(chooseAudioIndex(tracks, ['es'], null)).toBe(2);
    expect(chooseAudioIndex(tracks, ['fr'], null)).toBe(1);
    expect(chooseAudioIndex(tracks, [], null)).toBe(1);
  });
});
