import { describe, expect, it } from 'vitest';
import { buildAudioArgs, buildStreamArgs, buildThumbArgs } from '../../src/main/media/ffmpeg-args';
import type { ProbeInfo, StreamInfo } from '@shared/types';

const s = (o: Partial<StreamInfo>): StreamInfo => ({
  index: 0, type: 'video', codec: 'h264', profile: 'High', level: 41, width: 1920, height: 1080, pixFmt: 'yuv420p', bitDepth: 8, fps: 24, bitrate: 0,
  channels: 0, channelLayout: '', sampleRate: 0, language: '', title: '', isDefault: false, isForced: false, attachedPic: false, colorTransfer: '', rotation: 0, ...o
});
const probe = (streams: StreamInfo[]): ProbeInfo => ({ container: 'matroska', formatName: 'matroska,webm', durationSec: 100, bitrate: 0, size: 0, streams, chapters: [] });
const base = { file: '/m/a.mkv', startSec: 0, audioIndex: 0, burnSubtitle: -1, maxHeight: 0, encoder: 'libx264', quality: 'balanced' as const, hasZscale: true };

describe('buildStreamArgs', () => {
  it('remuxes video with stream copy and picks the requested audio track', () => {
    const p = probe([s({ index: 0 }), s({ index: 1, type: 'audio', codec: 'aac', channels: 2 }), s({ index: 2, type: 'audio', codec: 'aac', channels: 2 })]);
    const r = buildStreamArgs({ ...base, mode: 'remux', probe: p, audioIndex: 1, startSec: 12.5 });
    expect(r.args.join(' ')).toContain('-ss 12.500 -i /m/a.mkv');
    expect(r.args).toEqual(expect.arrayContaining(['-map', '0:0', '-map', '0:2', '-c:v', 'copy', '-c:a', 'copy']));
    expect(r.args.at(-1)).toBe('pipe:1');
    expect(r.args.join(' ')).toContain('frag_keyframe+empty_moov');
    expect(r).toMatchObject({ videoOut: 'h264', audioOut: 'aac', encoder: 'copy' });
  });

  it('tags HEVC copies as hvc1 and converts AC3 audio to stereo AAC', () => {
    const p = probe([s({ codec: 'hevc' }), s({ index: 1, type: 'audio', codec: 'ac3', channels: 6 })]);
    const r = buildStreamArgs({ ...base, mode: 'remux', probe: p });
    expect(r.args.join(' ')).toContain('-tag:v hvc1');
    expect(r.args.join(' ')).toContain('-c:a aac -b:a 256k -ac 2');
    expect(r.audioOut).toBe('aac');
  });

  it('transcodes with x264, a ~2 s GOP, and never changes frame rate', () => {
    const p = probe([s({ fps: 300 }), s({ index: 1, type: 'audio', codec: 'dts', channels: 6 })]);
    const r = buildStreamArgs({ ...base, mode: 'transcode', probe: p });
    expect(r.args.join(' ')).toContain('-c:v libx264 -preset veryfast -crf 22');
    expect(r.args.join(' ')).toContain('-g 600');
    expect(r.args).not.toContain('-r');
    expect(r.args.join(' ')).toContain('format=yuv420p');
  });

  it('scales down, tone-maps HDR and burns subtitles', () => {
    const p = probe([s({ colorTransfer: 'smpte2084', height: 2160, width: 3840, bitDepth: 10 }), s({ index: 1, type: 'audio' }), s({ index: 2, type: 'subtitle', codec: 'hdmv_pgs_subtitle' })]);
    const r = buildStreamArgs({ ...base, mode: 'transcode', probe: p, maxHeight: 1080, burnSubtitle: 2 });
    const joined = r.args.join(' ');
    expect(joined).toContain('-filter_complex [0:0][0:2]overlay=format=auto,zscale=t=linear:npl=100');
    expect(joined).toContain('scale=-2:1080');
    expect(r.args).toEqual(expect.arrayContaining(['-map', '[v]']));
  });

  it('uses hardware encoders with their own options', () => {
    const p = probe([s({}), s({ index: 1, type: 'audio', codec: 'aac', channels: 2 })]);
    expect(buildStreamArgs({ ...base, mode: 'transcode', probe: p, encoder: 'h264_nvenc' }).args.join(' ')).toContain('-c:v h264_nvenc -preset p4');
    const va = buildStreamArgs({ ...base, mode: 'transcode', probe: p, encoder: 'h264_vaapi' }).args.join(' ');
    expect(va).toContain('-vaapi_device /dev/dri/renderD128');
    expect(va).toContain('format=nv12,hwupload');
  });

  it('handles video without audio', () => {
    const r = buildStreamArgs({ ...base, mode: 'remux', probe: probe([s({})]) });
    expect(r.audioOut).toBe('none');
    expect(r.args).not.toContain('-c:a');
  });
});

describe('audio and thumbnail args', () => {
  it('produces streamable FLAC and downsamples DSD', () => {
    const p = probe([s({ index: 0, type: 'audio', codec: 'dsd_lsbf', sampleRate: 2822400 })]);
    const r = buildAudioArgs({ file: '/m/a.dsf', startSec: 30, probe: p, audioIndex: 0 });
    expect(r.args.join(' ')).toContain('-ss 30.000 -i /m/a.dsf -vn');
    expect(r.args.join(' ')).toContain('aresample=88200');
    expect(r.args.at(-1)).toBe('pipe:1');
  });
  it('seeks before the input for thumbnails', () => {
    const a = buildThumbArgs('/m/a.mkv', 61.234, 240);
    expect(a.indexOf('-ss')).toBeLessThan(a.indexOf('-i'));
    expect(a).toEqual(expect.arrayContaining(['-skip_frame', 'nokey', 'scale=240:-2']));
  });
});
