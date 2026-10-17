import { readFile, readdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { SUBTITLE_EXTS, extOf } from '@shared/formats';
import { languageName, normalizeLang } from '@shared/playback-plan';
import type { ProbeInfo, SubtitleTrack } from '@shared/types';
import type { SubtitleText } from '@shared/ipc';
import type { Ffmpeg } from './ffmpeg';

const TEXT_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text', 'ttml', 'subviewer', 'microdvd', 'eia_608']);
const BITMAP_CODECS = new Set(['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub', 'pgssub', 'dvdsub']);
const LANG_TOKEN = /^[a-z]{2,3}(?:-[a-z]{2,4})?$/i;
const FLAGS = new Set(['forced', 'sdh', 'cc', 'hi', 'default', 'full', 'signs']);

/** Find sidecar subtitle files next to a video: "Movie.en.srt", "Movie.forced.eng.ass", "Subs/Movie.srt". */
export async function findExternalSubtitles(videoPath: string, extraFolders: string[] = []): Promise<SubtitleTrack[]> {
  const dir = join(videoPath, '..');
  const base = basename(videoPath, extname(videoPath)).toLowerCase();
  const tracks: SubtitleTrack[] = [];
  const scan = async (folder: string) => {
    let names: string[] = [];
    try { names = await readdir(folder); } catch { return; }
    for (const name of names) {
      const ext = extOf(name);
      if (!(SUBTITLE_EXTS as readonly string[]).includes(ext)) continue;
      const stem = basename(name, extname(name));
      const lower = stem.toLowerCase();
      if (!(lower === base || lower.startsWith(base + '.') || lower.startsWith(base + ' ') || lower.startsWith(base + '_'))) continue;
      const tokens = lower.slice(base.length).split(/[._\s-]+/).filter(Boolean);
      const lang = tokens.find((t) => LANG_TOKEN.test(t) && !FLAGS.has(t)) ?? '';
      const forced = tokens.includes('forced');
      const sdh = tokens.includes('sdh') || tokens.includes('cc') || tokens.includes('hi');
      const full = join(folder, name);
      const label = [languageName(lang) || 'Subtitles', forced ? 'Forced' : '', sdh ? 'SDH' : ''].filter(Boolean).join(' · ');
      tracks.push({
        id: `ext:${full}`, label, language: lang ? normalizeLang(lang) : '', format: ext === 'vtt' ? 'vtt' : ext === 'srt' ? 'srt' : 'ass',
        source: 'external', isDefault: false, isForced: forced, ref: full
      });
    }
  };
  await scan(dir);
  for (const sub of ['Subs', 'Subtitles', 'subs', 'subtitles']) await scan(join(dir, sub));
  for (const folder of extraFolders) await scan(folder);
  return tracks;
}

export function embeddedSubtitleTracks(probe: ProbeInfo): SubtitleTrack[] {
  const subs = probe.streams.filter((s) => s.type === 'subtitle');
  return subs.map((s, n) => {
    const bitmap = BITMAP_CODECS.has(s.codec);
    const text = TEXT_CODECS.has(s.codec);
    const lang = languageName(s.language);
    return {
      id: `emb:${s.index}`,
      label: [lang || s.title || `Track ${n + 1}`, s.title && lang && s.title.toLowerCase() !== lang.toLowerCase() ? s.title : '', s.isForced ? 'Forced' : '', bitmap ? '(image)' : ''].filter(Boolean).join(' · '),
      language: s.language ? normalizeLang(s.language) : '',
      format: bitmap ? ('bitmap' as const) : s.codec === 'ass' || s.codec === 'ssa' ? ('ass' as const) : text ? ('srt' as const) : ('bitmap' as const),
      source: 'embedded' as const,
      isDefault: s.isDefault,
      isForced: s.isForced,
      ref: s.index
    };
  });
}

/** Decode legacy-encoded subtitle files: UTF-8/16 BOM → strict UTF-8 → a regional guess. */
export function decodeSubtitleBytes(buf: Buffer, languageHint = ''): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString('utf8').replace(/^﻿/, '');
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf).replace(/^﻿/, '');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf).replace(/^﻿/, '');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch { /* not UTF-8 */ }
  const lang = normalizeLang(languageHint);
  const label =
    lang === 'zh' ? 'gb18030' : lang === 'ja' ? 'shift_jis' : lang === 'ko' ? 'euc-kr' : lang === 'ru' || lang === 'uk' ? 'windows-1251' :
    lang === 'el' ? 'windows-1253' : lang === 'tr' ? 'windows-1254' : lang === 'he' ? 'windows-1255' : lang === 'ar' ? 'windows-1256' :
    lang === 'pl' || lang === 'cs' || lang === 'hu' || lang === 'ro' ? 'windows-1250' : 'windows-1252';
  try {
    return new TextDecoder(label).decode(buf);
  } catch {
    return buf.toString('latin1');
  }
}

export async function readSubtitle(ffmpeg: Ffmpeg, mediaPath: string, probe: ProbeInfo, trackId: string, extraFolders: string[] = []): Promise<SubtitleText> {
  if (trackId.startsWith('ext:')) {
    const file = trackId.slice(4);
    // Only files that were discovered next to the video can be read.
    const known = await findExternalSubtitles(mediaPath, extraFolders);
    const hit = known.find((t) => t.ref === file);
    if (!hit) throw new Error('Subtitle file not found');
    const buf = await readFile(file);
    if (buf.length > 20 * 1024 * 1024) throw new Error('Subtitle file too large');
    return { text: decodeSubtitleBytes(buf, hit.language), format: extOf(file) };
  }
  const index = Number(trackId.slice(4));
  const stream = probe.streams.find((s) => s.index === index && s.type === 'subtitle');
  if (!stream) throw new Error('Subtitle track not found');
  if (BITMAP_CODECS.has(stream.codec)) throw new Error('Image-based subtitles can only be burned into the picture');
  const asAss = stream.codec === 'ass' || stream.codec === 'ssa';
  const out = await ffmpeg.runBuffer(['-i', mediaPath, '-map', `0:${index}`, '-c:s', asAss ? 'ass' : 'srt', '-f', asAss ? 'ass' : 'srt', 'pipe:1'], 120_000);
  return { text: out.toString('utf8'), format: asAss ? 'ass' : 'srt' };
}
