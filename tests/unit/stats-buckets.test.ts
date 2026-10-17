import { describe, expect, it } from 'vitest';
import { bucketDaily, formatSpan, niceTicks, pickGranularity, spanDays } from '../../src/shared/stats-buckets';

const d = (s: string) => { const [y, m, day] = s.split('-').map(Number); return new Date(y!, m! - 1, day!); };

describe('stats buckets', () => {
  it('fills empty days with zeros', () => {
    const b = bucketDaily([{ day: '2025-03-03', video: 600, audio: 0, reading: 0 }], d('2025-03-01'), d('2025-03-05'), 'day');
    expect(b).toHaveLength(5);
    expect(b.map((x) => x.total)).toEqual([0, 0, 600, 0, 0]);
  });

  it('groups by Monday-based weeks and keeps totals intact', () => {
    const daily = [
      { day: '2025-03-03', video: 100, audio: 50, reading: 0 }, // Monday
      { day: '2025-03-09', video: 10, audio: 0, reading: 5 }, // Sunday, same week
      { day: '2025-03-10', video: 1, audio: 1, reading: 1 } // next Monday
    ];
    const b = bucketDaily(daily, d('2025-03-03'), d('2025-03-16'), 'week');
    expect(b).toHaveLength(2);
    expect(b[0]!.total).toBe(165);
    expect(b[1]!.total).toBe(3);
    expect(b.reduce((a, x) => a + x.total, 0)).toBe(168);
  });

  it('groups by month across a year boundary', () => {
    const b = bucketDaily([{ day: '2024-12-31', video: 5, audio: 0, reading: 0 }, { day: '2025-01-01', video: 7, audio: 0, reading: 0 }], d('2024-11-20'), d('2025-01-15'), 'month');
    expect(b.map((x) => x.key)).toEqual(['2024-11-01', '2024-12-01', '2025-01-01']);
    expect(b.map((x) => x.total)).toEqual([0, 5, 7]);
  });

  it('chooses a readable granularity', () => {
    expect(pickGranularity(7)).toBe('day');
    expect(pickGranularity(90)).toBe('week');
    expect(pickGranularity(1200)).toBe('month');
    expect(spanDays(d('2025-03-01'), d('2025-03-01'))).toBe(1);
    expect(spanDays(d('2025-03-01'), d('2025-03-31'))).toBe(31);
  });

  it('builds friendly axis ticks', () => {
    const small = niceTicks(40 * 60);
    expect(small.unit).toBe('min');
    expect(small.top).toBeGreaterThanOrEqual(40 * 60);
    expect(small.ticks.length).toBeLessThanOrEqual(5);
    const big = niceTicks(7.2 * 3600);
    expect(big.unit).toBe('h');
    expect(big.top).toBeGreaterThanOrEqual(7.2 * 3600);
    expect(big.ticks[0]).toBe(0);
    expect(niceTicks(0).top).toBeGreaterThan(0);
  });

  it('formats spans', () => {
    expect(formatSpan(0)).toBe('0 m');
    expect(formatSpan(45)).toBe('45 s');
    expect(formatSpan(35 * 60)).toBe('35 m');
    expect(formatSpan(3600 + 5 * 60)).toBe('1 h 05 m');
    expect(formatSpan(3599.7)).toBe('1 h');
  });
});
