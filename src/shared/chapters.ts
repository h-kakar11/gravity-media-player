import type { ChapterInfo, SpriteSheet } from './types';

/** Index of the chapter containing time `t`, or -1 when there are no chapters or `t` is before the first. */
export function chapterIndexAt(chapters: ChapterInfo[], t: number): number {
  let idx = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (t >= chapters[i]!.startSec) idx = i;
    else break;
  }
  return idx;
}

/**
 * The chapter whose start is within `thresholdPx` of time `t` on a track `widthPx` wide, so the
 * seek bar can snap to it. The first chapter (the start of the file) never snaps, and a bar with
 * a single chapter has nothing to snap between.
 */
export function snapToChapter(chapters: ChapterInfo[], t: number, duration: number, widthPx: number, thresholdPx = 7): number | null {
  if (chapters.length < 2 || duration <= 0 || widthPx <= 0) return null;
  const secPerPx = duration / widthPx;
  let best: number | null = null;
  let bestDist = thresholdPx * secPerPx;
  for (let i = 1; i < chapters.length; i++) {
    const d = Math.abs(chapters[i]!.startSec - t);
    if (d <= bestDist) { best = i; bestDist = d; }
  }
  return best;
}

/** Which sheet of a preview sprite holds time `t`, and where inside it the frame sits. */
export function spriteFrame(sprite: SpriteSheet, t: number): { url: string; x: number; y: number } {
  const per = sprite.cols * sprite.rows;
  const idx = Math.max(0, Math.min(sprite.count - 1, Math.floor(t / sprite.intervalSec)));
  const sheet = Math.floor(idx / per);
  const inSheet = idx % per;
  return { url: sprite.url.replace('{n}', String(sheet)), x: 0 - (inSheet % sprite.cols) * sprite.thumbWidth, y: 0 - Math.floor(inSheet / sprite.cols) * sprite.thumbHeight };
}

/** Time to take a chapter's picture from: a moment in, because the very first frame is often black. */
export function chapterThumbTime(c: ChapterInfo): number {
  const len = Math.max(0, c.endSec - c.startSec);
  return c.startSec + Math.min(4, len / 2);
}
