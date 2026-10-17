import { describe, expect, it } from 'vitest';
import { compareQuality, describeQuality, effectiveBitrate, lowerQualityReasons, resolutionRows, type QualityInput } from '../../src/main/health/quality';
import { partMarker, titleKey } from '../../src/main/health/scan';

const q = (over: Partial<QualityInput> = {}): QualityInput => ({
  path: '/a.mkv', size: 4_000_000_000, durationSec: 7200, width: 1920, height: 1080, vcodec: 'h264', bitrate: 8_000_000, ...over
});

describe('compareQuality', () => {
  it('ranks resolution first, whatever the codec or bitrate', () => {
    const hd = q({ path: '/hd.mkv', height: 1080, vcodec: 'h264', bitrate: 2_000_000 });
    const sd = q({ path: '/sd.mkv', width: 1280, height: 720, vcodec: 'hevc', bitrate: 20_000_000 });
    expect([sd, hd].sort(compareQuality)[0]).toBe(hd);
  });

  it('then codec generation, then bitrate, then size', () => {
    const hevc = q({ path: '/hevc.mkv', vcodec: 'hevc', bitrate: 3_000_000 });
    const avc = q({ path: '/avc.mkv', vcodec: 'h264', bitrate: 9_000_000 });
    expect([avc, hevc].sort(compareQuality)[0]).toBe(hevc);

    const hi = q({ path: '/hi.mkv', bitrate: 9_000_000 });
    const lo = q({ path: '/lo.mkv', bitrate: 4_000_000 });
    expect([lo, hi].sort(compareQuality)[0]).toBe(hi);

    const big = q({ path: '/big.mkv', bitrate: 8_000_000, size: 5_000_000_000 });
    const small = q({ path: '/small.mkv', bitrate: 8_000_000, size: 4_000_000_000 });
    expect([small, big].sort(compareQuality)[0]).toBe(big);
  });

  it('is deterministic for identical files (path breaks the tie)', () => {
    const a = q({ path: '/a.mkv' }), b = q({ path: '/b.mkv' });
    expect([b, a].sort(compareQuality).map((x) => x.path)).toEqual(['/a.mkv', '/b.mkv']);
    expect([a, b].sort(compareQuality).map((x) => x.path)).toEqual(['/a.mkv', '/b.mkv']);
  });

  it('puts a file with no readable resolution or codec last', () => {
    const known = q({ path: '/known.mkv' });
    const blank = q({ path: '/blank.mkv', width: 0, height: 0, vcodec: '', bitrate: 0 });
    expect([blank, known].sort(compareQuality)[0]).toBe(known);
  });
});

describe('lowerQualityReasons', () => {
  it('names every dimension that is worse', () => {
    const best = q({ vcodec: 'hevc', bitrate: 10_000_000 });
    const copy = q({ width: 1280, height: 720, vcodec: 'h264', bitrate: 2_000_000 });
    expect(lowerQualityReasons(copy, best)).toEqual([
      'Lower resolution (720p vs 1080p)',
      'Older codec (H.264 vs HEVC)',
      'Lower bitrate (2.0 Mbps vs 10.0 Mbps)'
    ]);
  });

  it('ignores bitrate differences inside the tolerance', () => {
    expect(lowerQualityReasons(q({ bitrate: 7_500_000 }), q({ bitrate: 8_000_000 }))).toEqual([]);
  });

  it('is empty for identical quality', () => {
    expect(lowerQualityReasons(q(), q())).toEqual([]);
  });

  it('says so when the copy could not be probed', () => {
    expect(lowerQualityReasons(q({ width: 0, height: 0 }), q())).toContain('Resolution could not be read');
  });

  it('never claims a codec is older when one is unknown', () => {
    expect(lowerQualityReasons(q({ vcodec: '' }), q({ vcodec: 'hevc' }))).toEqual([]);
  });
});

describe('quality helpers', () => {
  it('estimates bitrate from size and duration only when none is reported', () => {
    expect(effectiveBitrate({ bitrate: 5_000_000, size: 1, durationSec: 1 })).toBe(5_000_000);
    expect(effectiveBitrate({ bitrate: 0, size: 1_000_000, durationSec: 8 })).toBe(1_000_000);
    expect(effectiveBitrate({ bitrate: 0, size: 1_000_000, durationSec: 0 })).toBe(0);
  });

  it('widens letterboxed sources like the rest of the app', () => {
    expect(resolutionRows(1920, 800)).toBe(1080);
    expect(resolutionRows(0, 0)).toBe(0);
  });

  it('describes whatever is known', () => {
    expect(describeQuality(q())).toBe('1080p · H.264 · 8.0 Mbps');
    expect(describeQuality(q({ width: 0, height: 0, vcodec: '', bitrate: 0, size: 0 }))).toBe('');
  });
});

describe('titleKey', () => {
  it('ignores case, accents and punctuation', () => {
    expect(titleKey('Amélie')).toBe(titleKey('AMELIE'));
    expect(titleKey("Schindler's List")).toBe(titleKey('schindler s list'));
    expect(titleKey('WALL·E')).toBe(titleKey('Wall E'));
  });

  it('keeps non-latin titles distinct', () => {
    expect(titleKey('千と千尋の神隠し')).not.toBe('');
    expect(titleKey('千と千尋の神隠し')).not.toBe(titleKey('もののけ姫'));
  });

  it('is empty for titles with nothing to compare', () => {
    expect(titleKey('...')).toBe('');
  });
});

describe('partMarker', () => {
  it('recognises multi-part releases', () => {
    expect(partMarker('Movie (2000) cd1.avi')).toBe('cd1');
    expect(partMarker('Movie.2000.CD2.avi')).toBe('cd2');
    expect(partMarker('Movie - part 2.mkv')).toBe('part2');
    expect(partMarker('Movie [Disc 3].mkv')).toBe('disc3');
    expect(partMarker('Movie pt1.mkv')).toBe('part1');
  });

  it('does not mistake ordinary words for a part', () => {
    expect(partMarker('Departed (2006).mkv')).toBeNull();
    expect(partMarker('Apartment 1 (2012).mkv')).toBeNull();
    expect(partMarker('The Discovery (2017).mkv')).toBeNull();
  });
});
