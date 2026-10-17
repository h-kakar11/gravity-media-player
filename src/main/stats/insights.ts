import { computeStreaks, localDayKey, MAX_SESSION_SEC, MIN_SESSION_SEC, type AlbumStat, type ArtistStat, type GenreStat, type HeatDay, type InsightsRange, type ShowStat, type StatsInsights, type YearInReview } from '@shared/insights';
import type { Db } from '../db/database';

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Records that count: long enough to be intentional, short enough to be real. See shared/insights.ts. */
const COUNTED = `h.watched_sec >= ${MIN_SESSION_SEC} AND h.watched_sec <= ${MAX_SESSION_SEC}`;
const WINDOW = 'h.started_at >= ? AND h.started_at <= ?';
const HEATMAP_DAYS = 371;
const ART = (key: string, col: string) => `(SELECT m2.id FROM media m2 WHERE m2.${col} = ${key} AND m2.art_src IS NOT NULL LIMIT 1)`;

/**
 * Extra statistics on top of `StatsRepo`, kept in their own module. Days are bucketed with `tz`, a SQLite
 * date modifier: 'localtime' in the app, a fixed offset like '+0 minutes' in tests so they don't depend on the
 * machine's time zone.
 */
export class InsightsRepo {
  constructor(private readonly db: Db, private readonly tz: string = 'localtime', private readonly today: () => string = () => localDayKey(new Date())) {}

  private day(col = 'h.started_at') { return `date(${col} / 1000, 'unixepoch', ?)`; }

  compute(range: InsightsRange, limit = 30): StatsInsights {
    const win: [number, number] = [range.from ?? 0, range.to ?? Date.now() + 86_400_000];
    return {
      shows: this.shows(win, limit),
      genres: this.genres(win, limit),
      artists: this.artists(win, limit),
      albums: this.albums(win, limit),
      streak: this.streak(),
      // The calendar always shows the last 53 weeks ending at the range's end, whatever the range filter says.
      heatmap: this.heatmap([win[1] - HEATMAP_DAYS * 86_400_000, win[1]])
    };
  }

  /** Streaks always look at all history: a "this week" filter shouldn't shorten your streak. */
  streak() {
    const days = this.db.all<Row>(`SELECT DISTINCT ${this.day()} AS day FROM history h WHERE ${COUNTED}`, [this.tz]).map((r) => str(r.day));
    return computeStreaks(days, this.today());
  }

  heatmap(win: [number, number]): HeatDay[] {
    return this.db
      .all<Row>(`SELECT ${this.day()} AS day, SUM(h.watched_sec) AS sec FROM history h WHERE ${COUNTED} AND ${WINDOW} GROUP BY day ORDER BY day`, [this.tz, ...win])
      .map((r) => ({ day: str(r.day), sec: num(r.sec) }));
  }

  shows(win: [number, number], limit: number): ShowStat[] {
    return this.db
      .all<Row>(
        `SELECT MIN(m.series) AS title, SUM(h.watched_sec) AS sec, COUNT(DISTINCT h.media_id) AS eps, COUNT(*) AS sessions, ${ART('m.series_key', 'series_key')} AS art
         FROM history h JOIN media m ON m.id = h.media_id
         WHERE ${COUNTED} AND ${WINDOW} AND h.kind = 'video' AND m.series_key IS NOT NULL
         GROUP BY m.series_key ORDER BY sec DESC, title LIMIT ${limit}`, win)
      .map((r) => ({ title: str(r.title), sec: num(r.sec), episodes: num(r.eps), sessions: num(r.sessions), artMediaId: r.art == null ? null : num(r.art) }));
  }

  genres(win: [number, number], limit: number): GenreStat[] {
    const map = new Map<string, GenreStat>();
    const rows = this.db.all<Row>(
      `SELECT m.genre AS genre, h.kind AS kind, SUM(h.watched_sec) AS sec FROM history h JOIN media m ON m.id = h.media_id
       WHERE ${COUNTED} AND ${WINDOW} AND h.kind IN ('video', 'audio') AND m.genre IS NOT NULL AND m.genre <> '' GROUP BY m.genre, h.kind`, win);
    for (const r of rows) {
      for (const raw of str(r.genre).split(/[;/]/)) {
        const name = raw.trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const g = map.get(key) ?? { name, sec: 0, videoSec: 0, audioSec: 0 };
        const sec = num(r.sec);
        g.sec += sec;
        if (str(r.kind) === 'video') g.videoSec += sec; else g.audioSec += sec;
        map.set(key, g);
      }
    }
    return [...map.values()].sort((a, b) => b.sec - a.sec || a.name.localeCompare(b.name)).slice(0, limit);
  }

  artists(win: [number, number], limit: number): ArtistStat[] {
    return this.db
      .all<Row>(
        `SELECT MIN(COALESCE(NULLIF(m.album_artist, ''), NULLIF(m.artist, ''), 'Unknown Artist')) AS name, SUM(h.watched_sec) AS sec, COUNT(*) AS plays, COUNT(DISTINCT h.media_id) AS tracks
         FROM history h JOIN media m ON m.id = h.media_id WHERE ${COUNTED} AND ${WINDOW} AND h.kind = 'audio'
         GROUP BY m.artist_key ORDER BY sec DESC, name LIMIT ${limit}`, win)
      .map((r) => ({ name: str(r.name), sec: num(r.sec), plays: num(r.plays), tracks: num(r.tracks) }));
  }

  albums(win: [number, number], limit: number): AlbumStat[] {
    return this.db
      .all<Row>(
        `SELECT MIN(m.album) AS album, MIN(COALESCE(NULLIF(m.album_artist, ''), NULLIF(m.artist, ''), 'Unknown Artist')) AS artist,
                SUM(h.watched_sec) AS sec, COUNT(*) AS plays, COUNT(DISTINCT h.media_id) AS tracks, ${ART('m.album_key', 'album_key')} AS art
         FROM history h JOIN media m ON m.id = h.media_id
         WHERE ${COUNTED} AND ${WINDOW} AND h.kind = 'audio' AND m.album IS NOT NULL AND m.album <> ''
         GROUP BY m.album_key ORDER BY sec DESC, album LIMIT ${limit}`, win)
      .map((r) => ({ album: str(r.album), artist: str(r.artist), sec: num(r.sec), plays: num(r.plays), tracks: num(r.tracks), artMediaId: r.art == null ? null : num(r.art) }));
  }

  /** A calendar year, in the same day bucketing as everything else. `bounds` is for tests. */
  yearInReview(year: number, bounds?: [number, number]): YearInReview {
    const win: [number, number] = bounds ?? [new Date(year, 0, 1).getTime(), new Date(year + 1, 0, 1).getTime() - 1];
    const total = this.db.get<Row>(`SELECT COUNT(*) AS n, COUNT(DISTINCT h.media_id) AS titles FROM history h WHERE ${COUNTED} AND ${WINDOW}`, win);
    const byKind = this.db.all<Row>(`SELECT h.kind AS kind, SUM(h.watched_sec) AS sec FROM history h WHERE ${COUNTED} AND ${WINDOW} GROUP BY h.kind`, win);
    const kindSec = (...ks: string[]) => byKind.filter((r) => ks.includes(str(r.kind))).reduce((a, r) => a + num(r.sec), 0);
    const heatmap = this.heatmap(win);
    const months = new Array<number>(12).fill(0);
    for (const d of heatmap) {
      const m = Number(d.day.slice(5, 7)) - 1;
      if (m >= 0 && m < 12) months[m]! += d.sec;
    }
    const busiest = heatmap.reduce<HeatDay | null>((a, d) => (!a || d.sec > a.sec ? d : a), null);
    const hourly = new Array<number>(24).fill(0);
    for (const r of this.db.all<Row>(`SELECT CAST(strftime('%H', h.started_at / 1000, 'unixepoch', ?) AS INTEGER) AS k, SUM(h.watched_sec) AS sec FROM history h WHERE ${COUNTED} AND ${WINDOW} GROUP BY k`, [this.tz, ...win])) hourly[num(r.k)] = num(r.sec);
    const weekday = new Array<number>(7).fill(0);
    for (const r of this.db.all<Row>(`SELECT CAST(strftime('%w', h.started_at / 1000, 'unixepoch', ?) AS INTEGER) AS k, SUM(h.watched_sec) AS sec FROM history h WHERE ${COUNTED} AND ${WINDOW} GROUP BY k`, [this.tz, ...win])) weekday[num(r.k)] = num(r.sec);
    const peak = (a: number[]) => { const m = Math.max(...a); return m > 0 ? a.indexOf(m) : null; };

    const movies = this.db
      .all<Row>(
        `SELECT m.title AS title, m.year AS year, SUM(h.watched_sec) AS sec FROM history h JOIN media m ON m.id = h.media_id
         WHERE ${COUNTED} AND ${WINDOW} AND h.kind = 'video' AND m.series_key IS NULL GROUP BY h.media_id ORDER BY sec DESC, title LIMIT 5`, win)
      .map((r) => ({ title: str(r.title), sec: num(r.sec), year: r.year == null ? null : num(r.year) }));
    const tracks = this.db
      .all<Row>(
        `SELECT m.title AS title, COALESCE(NULLIF(m.artist, ''), NULLIF(m.album_artist, ''), 'Unknown Artist') AS artist, COUNT(*) AS plays, SUM(h.watched_sec) AS sec
         FROM history h JOIN media m ON m.id = h.media_id WHERE ${COUNTED} AND ${WINDOW} AND h.kind = 'audio'
         GROUP BY h.media_id ORDER BY plays DESC, sec DESC, title LIMIT 5`, win)
      .map((r) => ({ title: str(r.title), artist: str(r.artist), plays: num(r.plays), sec: num(r.sec) }));

    const streak = computeStreaks(heatmap.map((d) => d.day), '0000-00-00');
    return {
      year,
      totalSec: kindSec('video', 'audio', 'comic', 'book', 'image'),
      videoSec: kindSec('video'), audioSec: kindSec('audio'), readingSec: kindSec('comic', 'book', 'image'),
      sessions: num(total?.n), titles: num(total?.titles), activeDays: heatmap.length, longestStreak: streak.longest,
      busiestDay: busiest, months, mostActiveHour: peak(hourly), mostActiveWeekday: peak(weekday),
      topShows: this.shows(win, 5), topMovies: movies, topArtists: this.artists(win, 5), topTracks: tracks, topAlbums: this.albums(win, 5), topGenres: this.genres(win, 5),
      heatmap
    };
  }
}
