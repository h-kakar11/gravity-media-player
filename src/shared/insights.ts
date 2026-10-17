import type { StatsRange } from './types';

/**
 * Counting rules shared by every insight (see docs/features/08-stats-year-in-review.md):
 * - A history record counts only if it was watched for at least MIN_SESSION_SEC. Accidental starts and
 *   skipped-through tracks would otherwise inflate play counts, streaks and "days active".
 * - A record longer than MAX_SESSION_SEC is treated as corrupt (a clock jump or a crash that never closed the
 *   record) and ignored, so one bad row cannot dominate a year.
 * - A session belongs to the local calendar day it *started* on. A session that crosses midnight is not split.
 * - A streak is a run of consecutive local days with at least one counted session. It is still "current" if
 *   the latest active day is today or yesterday, so it doesn't read 0 before you've watched anything today.
 * - Time is attributed in full to every genre listed on a title ("Action; Sci-Fi" credits both).
 */
export const MIN_SESSION_SEC = 5;
export const MAX_SESSION_SEC = 86_400;

export interface ShowStat { title: string; sec: number; episodes: number; sessions: number; artMediaId: number | null }
export interface GenreStat { name: string; sec: number; videoSec: number; audioSec: number }
export interface ArtistStat { name: string; sec: number; plays: number; tracks: number }
export interface AlbumStat { album: string; artist: string; sec: number; plays: number; tracks: number; artMediaId: number | null }
export interface StreakInfo {
  current: number;
  longest: number;
  longestStart: string | null;
  longestEnd: string | null;
  activeDays: number;
}
export interface HeatDay { day: string; sec: number }

export interface StatsInsights {
  shows: ShowStat[];
  genres: GenreStat[];
  artists: ArtistStat[];
  albums: AlbumStat[];
  streak: StreakInfo;
  /** Seconds per local day inside the requested range (days with no activity are omitted). */
  heatmap: HeatDay[];
}

export interface YearInReview {
  year: number;
  totalSec: number;
  videoSec: number;
  audioSec: number;
  readingSec: number;
  sessions: number;
  titles: number;
  activeDays: number;
  longestStreak: number;
  busiestDay: HeatDay | null;
  /** Seconds per month, January first. */
  months: number[];
  mostActiveHour: number | null;
  /** 0 = Sunday. */
  mostActiveWeekday: number | null;
  topShows: ShowStat[];
  topMovies: { title: string; sec: number; year: number | null }[];
  topArtists: ArtistStat[];
  topTracks: { title: string; artist: string; plays: number; sec: number }[];
  topAlbums: AlbumStat[];
  topGenres: GenreStat[];
  heatmap: HeatDay[];
}

export type InsightsRange = StatsRange;

const dayNumber = (day: string): number => {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86_400_000;
};

/**
 * Streaks from a set of active days ("YYYY-MM-DD", local). `today` is the caller's local date so this stays
 * pure and testable.
 */
export function computeStreaks(days: Iterable<string>, today: string): StreakInfo {
  const sorted = [...new Set(days)].sort();
  if (sorted.length === 0) return { current: 0, longest: 0, longestStart: null, longestEnd: null, activeDays: 0 };
  let longest = 0, longestStart = sorted[0]!, longestEnd = sorted[0]!;
  let runStart = sorted[0]!, run = 1;
  for (let i = 1; i <= sorted.length; i++) {
    const prev = sorted[i - 1]!, cur = sorted[i];
    if (cur !== undefined && dayNumber(cur) - dayNumber(prev) === 1) { run++; continue; }
    if (run > longest) { longest = run; longestStart = runStart; longestEnd = prev; }
    if (cur !== undefined) { runStart = cur; run = 1; }
  }
  const last = sorted[sorted.length - 1]!;
  const gap = dayNumber(today) - dayNumber(last);
  let current = 0;
  if (gap === 0 || gap === 1) {
    current = 1;
    for (let i = sorted.length - 1; i > 0 && dayNumber(sorted[i]!) - dayNumber(sorted[i - 1]!) === 1; i--) current++;
  }
  return { current, longest, longestStart, longestEnd, activeDays: sorted.length };
}

/** Local "YYYY-MM-DD" for a Date. */
export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
