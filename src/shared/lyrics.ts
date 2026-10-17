import type { LyricLine } from './types';

/**
 * Parse LRC lyrics. Supports multiple timestamps per line ("[00:12.00][01:30.00]text"),
 * the [offset:+/-ms] header and enhanced word timestamps (which are stripped). Plain text
 * without timestamps yields an unsynced result.
 */
export function parseLrc(input: string): { synced: boolean; lines: LyricLine[] } {
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines: LyricLine[] = [];
  let offsetMs = 0;
  const plain: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const meta = /^\[(ti|ar|al|au|by|re|ve|length|offset):\s*(.*)]$/i.exec(line);
    if (meta) {
      if (meta[1]!.toLowerCase() === 'offset') offsetMs = Number(meta[2]) || 0;
      continue;
    }
    const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?]/g)];
    if (stamps.length === 0) { plain.push(line); continue; }
    const body = line.replace(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?]/g, '').replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, '').trim();
    for (const s of stamps) {
      const frac = s[3] ? Number(s[3].padEnd(3, '0').slice(0, 3)) / 1000 : 0;
      lines.push({ timeSec: Number(s[1]) * 60 + Number(s[2]) + frac - offsetMs / 1000, text: body });
    }
  }
  if (lines.length > 0) {
    lines.sort((a, b) => a.timeSec - b.timeSec);
    return { synced: true, lines };
  }
  return { synced: false, lines: plain.map((t) => ({ timeSec: -1, text: t })) };
}

/** Index of the line active at time `t` (-1 before the first line). Lines must be sorted. */
export function activeLyricIndex(lines: LyricLine[], t: number): number {
  let lo = 0, hi = lines.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.timeSec <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return idx;
}
