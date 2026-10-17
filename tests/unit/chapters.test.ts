import { describe, expect, it } from 'vitest';
import { chapterIndexAt, chapterThumbTime, snapToChapter, spriteFrame } from '../../src/shared/chapters';
import type { ChapterInfo, SpriteSheet } from '../../src/shared/types';

const ch = (...starts: number[]): ChapterInfo[] => starts.map((s, i) => ({ startSec: s, endSec: starts[i + 1] ?? 1000, title: `C${i}` }));

describe('chapterIndexAt', () => {
  it('finds the containing chapter', () => {
    const c = ch(0, 100, 200);
    expect(chapterIndexAt(c, 0)).toBe(0);
    expect(chapterIndexAt(c, 150)).toBe(1);
    expect(chapterIndexAt(c, 999)).toBe(2);
  });
  it('returns -1 with no chapters or before the first', () => {
    expect(chapterIndexAt([], 5)).toBe(-1);
    expect(chapterIndexAt(ch(30, 60), 10)).toBe(-1);
  });
});

describe('snapToChapter', () => {
  const c = ch(0, 100, 200);
  it('snaps within the pixel threshold', () => {
    // 1000 s over 1000 px: 1 px per second, threshold 7 px.
    expect(snapToChapter(c, 104, 1000, 1000)).toBe(1);
    expect(snapToChapter(c, 193, 1000, 1000)).toBe(2);
  });
  it('does not snap outside the threshold', () => {
    expect(snapToChapter(c, 120, 1000, 1000)).toBeNull();
  });
  it('threshold scales with the bar width', () => {
    expect(snapToChapter(c, 120, 1000, 100)).toBe(1);
  });
  it('never snaps to the first chapter', () => {
    expect(snapToChapter(c, 2, 1000, 1000)).toBeNull();
  });
  it('has nothing to snap to with a single chapter or no size', () => {
    expect(snapToChapter(ch(0), 0, 1000, 1000)).toBeNull();
    expect(snapToChapter(c, 100, 0, 1000)).toBeNull();
    expect(snapToChapter(c, 100, 1000, 0)).toBeNull();
  });
  it('picks the nearest of two close chapters', () => {
    expect(snapToChapter(ch(0, 100, 104), 103, 1000, 1000)).toBe(2);
  });
});

describe('spriteFrame', () => {
  const sprite: SpriteSheet = { url: 'sheet-{n}.jpg', cols: 5, rows: 2, thumbWidth: 160, thumbHeight: 90, intervalSec: 10, count: 25 };
  it('maps a time to a sheet and offset', () => {
    expect(spriteFrame(sprite, 0)).toEqual({ url: 'sheet-0.jpg', x: 0, y: 0 });
    expect(spriteFrame(sprite, 70)).toEqual({ url: 'sheet-0.jpg', x: -320, y: -90 });
    expect(spriteFrame(sprite, 100)).toEqual({ url: 'sheet-1.jpg', x: 0, y: 0 });
  });
  it('clamps past the end and before the start', () => {
    expect(spriteFrame(sprite, 99999).url).toBe('sheet-2.jpg');
    expect(spriteFrame(sprite, -5)).toEqual({ url: 'sheet-0.jpg', x: 0, y: 0 });
  });
});

describe('chapterThumbTime', () => {
  it('goes a few seconds in, but stays inside short chapters', () => {
    expect(chapterThumbTime({ startSec: 60, endSec: 600, title: '' })).toBe(64);
    expect(chapterThumbTime({ startSec: 60, endSec: 66, title: '' })).toBe(63);
  });
});
