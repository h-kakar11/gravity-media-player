import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { parseFile } from 'music-metadata';
import { parseLrc } from '@shared/lyrics';
import type { LyricsResult } from '@shared/types';
import { decodeSubtitleBytes } from './subtitles';

/** Sidecar `.lrc` first, then lyrics embedded in the file's tags (synced if the tag carries timestamps). */
export async function loadLyrics(path: string): Promise<LyricsResult> {
  const lrc = join(dirname(path), basename(path, extname(path)) + '.lrc');
  try {
    const parsed = parseLrc(decodeSubtitleBytes(await readFile(lrc)));
    if (parsed.lines.length) return { ...parsed, source: 'lrc' };
  } catch { /* no sidecar */ }
  try {
    const md = await parseFile(path, { skipCovers: true, duration: false, skipPostHeaders: true });
    const tags = (md.common as { lyrics?: unknown[] }).lyrics ?? [];
    for (const l of tags) {
      if (typeof l === 'string' && l.trim()) {
        const parsed = parseLrc(l);
        if (parsed.lines.length) return { ...parsed, source: 'embedded' };
      } else if (l && typeof l === 'object') {
        const o = l as { text?: string; syncText?: { text: string; timestamp?: number }[] };
        if (o.syncText?.length && o.syncText.some((s) => typeof s.timestamp === 'number')) {
          return { synced: true, source: 'embedded', lines: o.syncText.map((s) => ({ timeSec: (s.timestamp ?? 0) / 1000, text: s.text.trim() })).filter((s) => s.text) };
        }
        if (o.text?.trim()) {
          const parsed = parseLrc(o.text);
          if (parsed.lines.length) return { ...parsed, source: 'embedded' };
        }
      }
    }
  } catch { /* unreadable tags */ }
  return { synced: false, lines: [], source: 'none' };
}
