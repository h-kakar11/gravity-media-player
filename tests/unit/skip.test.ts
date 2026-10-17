import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings } from '../../src/shared/settings';
import { detectFromChapters, resolveSegments, sanitizeMarkers, segmentAt, showKey, withCredits, withIntro } from '../../src/shared/skip';
import type { ChapterInfo } from '../../src/shared/types';

const ch = (title: string, startSec: number, endSec: number): ChapterInfo => ({ title, startSec, endSec });
const DURATION = 1440;

describe('showKey', () => {
  it('normalises the series name for episodes only', () => {
    expect(showKey({ vclass: 'episode', series: '  Cowboy   Bebop ' })).toBe('cowboy bebop');
    expect(showKey({ vclass: 'movie', series: 'Cowboy Bebop' })).toBeNull();
    expect(showKey({ vclass: 'episode', series: null })).toBeNull();
    expect(showKey(null)).toBeNull();
  });
});

describe('detectFromChapters', () => {
  it('finds an opening and credits by title and position', () => {
    const segs = detectFromChapters([ch('Prologue', 0, 90), ch('Opening', 90, 180), ch('Part A', 180, 1200), ch('Ending', 1200, 1330), ch('Preview', 1330, 1440)], DURATION);
    expect(segs).toEqual([
      { kind: 'intro', start: 90, end: 180, source: 'chapter' },
      { kind: 'credits', start: 1200, end: DURATION, source: 'chapter' }
    ]);
  });
  it('ignores look-alike titles in the wrong place or of the wrong size', () => {
    expect(detectFromChapters([ch('Intro', 0, 1000), ch('Rest', 1000, 1440)], DURATION)).toEqual([]);
    expect(detectFromChapters([ch('Introduction to the story', 0, 60)], DURATION)).toEqual([{ kind: 'intro', start: 0, end: 60, source: 'chapter' }]);
    expect(detectFromChapters([ch('Ending', 100, 200), ch('More', 200, 1440)], DURATION)).toEqual([]);
    expect(detectFromChapters([ch('Opening', 10, 12)], DURATION)).toEqual([]);
  });
  it('does nothing without a duration', () => {
    expect(detectFromChapters([ch('Opening', 0, 60)], 0)).toEqual([]);
  });
});

describe('resolveSegments', () => {
  it('uses saved markers when the file has no matching chapters', () => {
    const segs = resolveSegments([], DURATION, { intro: { start: 60, end: 150 }, credits: { fromEnd: 120 } });
    expect(segs).toEqual([
      { kind: 'intro', start: 60, end: 150, source: 'saved' },
      { kind: 'credits', start: DURATION - 120, end: DURATION, source: 'saved' }
    ]);
  });
  it('prefers a chapter over the saved marker of the same kind', () => {
    const segs = resolveSegments([ch('Opening', 30, 120)], DURATION, { intro: { start: 60, end: 150 } });
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ source: 'chapter', start: 30 });
  });
  it('drops saved markers that do not fit this episode', () => {
    expect(resolveSegments([], 100, { intro: { start: 60, end: 150 } })).toEqual([]);
    expect(resolveSegments([], 100, { credits: { fromEnd: 90 } })).toEqual([]);
  });
});

describe('segmentAt', () => {
  const segs = resolveSegments([], DURATION, { intro: { start: 60, end: 150 } });
  it('offers the skip only inside the segment, not in its last seconds', () => {
    expect(segmentAt(segs, 30)).toBeNull();
    expect(segmentAt(segs, 59.9)?.kind).toBe('intro');
    expect(segmentAt(segs, 100)?.kind).toBe('intro');
    expect(segmentAt(segs, 148.5)).toBeNull();
    expect(segmentAt(segs, 200)).toBeNull();
  });
});

describe('marking', () => {
  it('saves a sane intro and keeps the credits already saved', () => {
    const r = withIntro({ credits: { fromEnd: 90 } }, 62.04, 151.96);
    expect(r).toEqual({ ok: true, markers: { credits: { fromEnd: 90 }, intro: { start: 62, end: 152 } } });
  });
  it('rejects an intro that ends before it starts, or is too short or too long', () => {
    expect(withIntro(undefined, 100, 90).ok).toBe(false);
    expect(withIntro(undefined, 100, 102).ok).toBe(false);
    expect(withIntro(undefined, 0, 600).ok).toBe(false);
  });
  it('stores credits as a distance from the end and rejects silly ones', () => {
    expect(withCredits(undefined, 1320, DURATION)).toEqual({ ok: true, markers: { credits: { fromEnd: 120 } } });
    expect(withCredits(undefined, 1438, DURATION).ok).toBe(false);
    expect(withCredits(undefined, 100, DURATION).ok).toBe(false);
  });
});

describe('persistence', () => {
  it('sanitizeMarkers drops malformed data', () => {
    expect(sanitizeMarkers({ intro: { start: 10, end: 5 }, credits: { fromEnd: -1 } })).toEqual({});
    expect(sanitizeMarkers({ intro: { start: 10, end: 90 } })).toEqual({ intro: { start: 10, end: 90 } });
    expect(sanitizeMarkers('nope')).toBeNull();
  });
  it('settings keep markers for several shows and replace one show at a time', () => {
    let s = mergeSettings(structuredClone(DEFAULT_SETTINGS), { skip: { markers: { a: { intro: { start: 1, end: 60 } } } } });
    s = mergeSettings(s, { skip: { markers: { b: { credits: { fromEnd: 100 } }, a: {} } } });
    expect(s.skip.markers).toEqual({ a: {}, b: { credits: { fromEnd: 100 } } });
    s = mergeSettings(s, { skip: { markers: { c: 'junk' } } });
    expect(Object.keys(s.skip.markers)).toEqual(['a', 'b']);
  });
  it('is off by default', () => {
    expect(DEFAULT_SETTINGS.skip).toEqual({ autoIntro: false, autoCredits: false, markers: {} });
  });
});
