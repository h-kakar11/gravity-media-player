/** Turns the sparse per-day totals from the stats query into evenly spaced chart buckets. */

export interface DayStat { day: string; video: number; audio: number; reading: number }
export type Granularity = 'day' | 'week' | 'month';

export interface Bucket {
  key: string;
  /** First local day covered by the bucket. */
  start: Date;
  /** Last local day covered by the bucket (inclusive). */
  end: Date;
  video: number;
  audio: number;
  reading: number;
  total: number;
}

const MS_DAY = 86_400_000;

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseDay = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y!, m! - 1, d!); };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
/** Monday-based week start. */
const weekStart = (d: Date) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));
const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

export function pickGranularity(spanDays: number): Granularity {
  return spanDays <= 62 ? 'day' : spanDays <= 400 ? 'week' : 'month';
}

/** Local days spanned by [from, to], inclusive. */
export function spanDays(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / MS_DAY) + 1;
}

export function bucketDaily(daily: DayStat[], from: Date, to: Date, g: Granularity = pickGranularity(spanDays(from, to))): Bucket[] {
  const startOf = g === 'day' ? (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()) : g === 'week' ? weekStart : monthStart;
  const next = (d: Date) => (g === 'day' ? addDays(d, 1) : g === 'week' ? addDays(d, 7) : new Date(d.getFullYear(), d.getMonth() + 1, 1));
  const buckets = new Map<string, Bucket>();
  const order: Bucket[] = [];
  const first = startOf(from);
  const last = startOf(to);
  for (let cur = first; cur <= last; cur = next(cur)) {
    const b: Bucket = { key: dayKey(cur), start: cur, end: addDays(next(cur), -1), video: 0, audio: 0, reading: 0, total: 0 };
    buckets.set(b.key, b);
    order.push(b);
  }
  for (const d of daily) {
    const b = buckets.get(dayKey(startOf(parseDay(d.day))));
    if (!b) continue;
    b.video += d.video; b.audio += d.audio; b.reading += d.reading;
    b.total += d.video + d.audio + d.reading;
  }
  return order;
}

/** Axis ticks (in seconds) that land on friendly minute / hour values, plus the unit to label them with. */
export function niceTicks(maxSec: number, maxTicks = 4): { ticks: number[]; unit: 'min' | 'h'; top: number } {
  const unit: 'min' | 'h' = maxSec >= 5400 ? 'h' : 'min';
  const base = unit === 'h' ? 3600 : 60;
  const maxU = Math.max(1, maxSec / base);
  const candidates = [1, 2, 5, 10, 15, 20, 30, 50, 100, 200, 500, 1000];
  const step = candidates.find((c) => Math.ceil(maxU / c) <= maxTicks) ?? 1000;
  const n = Math.max(1, Math.ceil(maxU / step));
  return { ticks: Array.from({ length: n + 1 }, (_, i) => i * step * base), unit, top: n * step * base };
}

/** "2 h 05 m", "35 m", "45 s". */
export function formatSpan(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0 m';
  if (sec < 60) return `${Math.round(sec)} s`;
  const total = Math.round(sec / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} m`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')} m`;
}
