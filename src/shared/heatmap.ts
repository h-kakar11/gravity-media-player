import type { HeatDay } from './insights';

export interface HeatCell { day: string; sec: number; level: 0 | 1 | 2 | 3 | 4; col: number; row: number }

/** 0 for no activity, otherwise 1–4 in quarters of the busiest day. */
export function heatLevel(sec: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (!(sec > 0) || !(max > 0)) return 0;
  return Math.min(4, Math.max(1, Math.ceil((sec / max) * 4))) as 1 | 2 | 3 | 4;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Calendar grid like GitHub's: one column per week (Monday first), seven rows. Days run from `fromDay` to `toDay`
 * inclusive ("YYYY-MM-DD"); the first column is padded so weekdays line up. Pure UTC arithmetic on the day
 * strings, so it can't drift across DST changes.
 */
export function buildHeatGrid(days: HeatDay[], fromDay: string, toDay: string): { cells: HeatCell[]; weeks: number; max: number } {
  const bySec = new Map(days.map((d) => [d.day, d.sec]));
  const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y!, m! - 1, d!); };
  const start = parse(fromDay), end = parse(toDay);
  const max = Math.max(0, ...days.filter((d) => d.day >= fromDay && d.day <= toDay).map((d) => d.sec));
  const cells: HeatCell[] = [];
  const offset = (new Date(start).getUTCDay() + 6) % 7; // Monday = 0
  let i = 0;
  for (let t = start; t <= end; t += 86_400_000, i++) {
    const dt = new Date(t);
    const day = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
    const sec = bySec.get(day) ?? 0;
    cells.push({ day, sec, level: heatLevel(sec, max), col: Math.floor((i + offset) / 7), row: (i + offset) % 7 });
  }
  return { cells, weeks: cells.length ? cells[cells.length - 1]!.col + 1 : 0, max };
}
