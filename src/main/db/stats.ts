import type { MediaKind, StatsRange, StatsResult } from '@shared/types';
import { Db } from './database';
import { mapMedia } from './repo';

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

const SELECT_MEDIA = `
  SELECT m.*, s.favorite AS s_fav, s.rating AS s_rating, s.play_count AS s_plays, s.last_played_at AS s_last,
         s.position AS s_pos, s.progress AS s_prog, s.completed AS s_done, s.notes AS s_notes, s.location AS s_loc
  FROM media m LEFT JOIN state s ON s.media_id = m.id`;

const localDay = (col: string) => `date(${col} / 1000, 'unixepoch', 'localtime')`;

export class StatsRepo {
  constructor(private readonly db: Db) {}

  compute(range: StatsRange): StatsResult {
    const from = range.from ?? 0;
    const to = range.to ?? Date.now() + 86_400_000;
    const win: [number, number] = [from, to];
    const W = 'h.started_at >= ? AND h.started_at <= ?';

    const byKind = this.db.all<Row>(`SELECT h.kind, SUM(h.watched_sec) AS sec, COUNT(*) AS n, MAX(h.watched_sec) AS longest FROM history h WHERE ${W} GROUP BY h.kind`, win);
    const kindSec = (...ks: string[]) => byKind.filter((r) => ks.includes(str(r.kind))).reduce((a, r) => a + num(r.sec), 0);
    const sessions = byKind.reduce((a, r) => a + num(r.n), 0);
    const longest = byKind.reduce((a, r) => Math.max(a, num(r.longest)), 0);
    const totalSec = kindSec('video', 'audio', 'comic', 'book', 'image');

    const dailyRows = this.db.all<Row>(`SELECT ${localDay('h.started_at')} AS day, h.kind, SUM(h.watched_sec) AS sec FROM history h WHERE ${W} GROUP BY day, h.kind ORDER BY day`, win);
    const dailyMap = new Map<string, { day: string; video: number; audio: number; reading: number }>();
    for (const r of dailyRows) {
      const day = str(r.day);
      const d = dailyMap.get(day) ?? { day, video: 0, audio: 0, reading: 0 };
      const k = str(r.kind);
      if (k === 'video') d.video += num(r.sec);
      else if (k === 'audio') d.audio += num(r.sec);
      else d.reading += num(r.sec);
      dailyMap.set(day, d);
    }

    const hourly = new Array<number>(24).fill(0);
    for (const r of this.db.all<Row>(`SELECT CAST(strftime('%H', h.started_at / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hr, SUM(h.watched_sec) AS sec FROM history h WHERE ${W} GROUP BY hr`, win)) {
      hourly[num(r.hr)] = num(r.sec);
    }
    const weekday = new Array<number>(7).fill(0);
    for (const r of this.db.all<Row>(`SELECT CAST(strftime('%w', h.started_at / 1000, 'unixepoch', 'localtime') AS INTEGER) AS wd, SUM(h.watched_sec) AS sec FROM history h WHERE ${W} GROUP BY wd`, win)) {
      weekday[num(r.wd)] = num(r.sec);
    }
    const peak = Math.max(...hourly);
    const mostActiveHour = peak > 0 ? hourly.indexOf(peak) : null;

    const top = (kind: MediaKind, limit: number) =>
      this.db.all<Row>(
        `SELECT h.media_id AS id, SUM(h.watched_sec) AS sec, COUNT(*) AS plays FROM history h JOIN media m ON m.id = h.media_id
         WHERE ${W} AND h.kind = ? GROUP BY h.media_id ORDER BY sec DESC LIMIT ${limit}`,
        [...win, kind]
      );
    const items = (rows: Row[]) => {
      const map = new Map<number, ReturnType<typeof mapMedia>>();
      for (const r of rows) {
        const m = this.db.get<Row>(`${SELECT_MEDIA} WHERE m.id = ?`, [num(r.id)]);
        if (m) map.set(num(r.id), mapMedia(m));
      }
      return map;
    };
    const topVideoRows = top('video', 10);
    const vmap = items(topVideoRows);
    const topVideos = topVideoRows.filter((r) => vmap.has(num(r.id))).map((r) => ({ item: vmap.get(num(r.id))!, sec: num(r.sec), plays: num(r.plays) }));
    const topTrackRows = this.db.all<Row>(
      `SELECT h.media_id AS id, SUM(h.watched_sec) AS sec, COUNT(*) AS plays FROM history h JOIN media m ON m.id = h.media_id
       WHERE ${W} AND h.kind = 'audio' GROUP BY h.media_id ORDER BY plays DESC, sec DESC LIMIT 10`, win);
    const tmap = items(topTrackRows);
    const topTracks = topTrackRows.filter((r) => tmap.has(num(r.id))).map((r) => ({ item: tmap.get(num(r.id))!, sec: num(r.sec), plays: num(r.plays) }));

    const topSeries = this.db
      .all<Row>(
        `SELECT MIN(m.series) AS title, SUM(h.watched_sec) AS sec,
                (SELECT m2.id FROM media m2 WHERE m2.series_key = m.series_key AND m2.art_src IS NOT NULL LIMIT 1) AS art
         FROM history h JOIN media m ON m.id = h.media_id
         WHERE ${W} AND h.kind = 'video' AND m.series_key IS NOT NULL GROUP BY m.series_key ORDER BY sec DESC LIMIT 8`, win)
      .map((r) => ({ title: str(r.title), sec: num(r.sec), artMediaId: r.art == null ? null : num(r.art) }));

    const topArtists = this.db
      .all<Row>(
        `SELECT MIN(COALESCE(NULLIF(m.album_artist, ''), NULLIF(m.artist, ''), 'Unknown Artist')) AS name, SUM(h.watched_sec) AS sec, COUNT(*) AS plays
         FROM history h JOIN media m ON m.id = h.media_id WHERE ${W} AND h.kind = 'audio' GROUP BY m.artist_key ORDER BY sec DESC LIMIT 8`, win)
      .map((r) => ({ name: str(r.name), sec: num(r.sec), plays: num(r.plays) }));

    const genreMap = new Map<string, number>();
    for (const r of this.db.all<Row>(`SELECT m.genre AS genre, SUM(h.watched_sec) AS sec FROM history h JOIN media m ON m.id = h.media_id WHERE ${W} AND m.genre IS NOT NULL GROUP BY m.genre`, win)) {
      for (const g of str(r.genre).split(';').map((x) => x.trim()).filter(Boolean)) genreMap.set(g, (genreMap.get(g) ?? 0) + num(r.sec));
    }
    const topGenres = [...genreMap].map(([name, sec]) => ({ name, sec })).sort((a, b) => b.sec - a.sec).slice(0, 8);

    const library = this.db
      .all<Row>("SELECT kind, COUNT(*) AS n, SUM(size) AS bytes, SUM(duration) AS dur FROM media WHERE missing = 0 GROUP BY kind")
      .map((r) => ({ kind: str(r.kind) as MediaKind, count: num(r.n), totalSize: num(r.bytes), totalDurationSec: num(r.dur) }));

    const titlesPlayed = num(this.db.get<Row>(`SELECT COUNT(DISTINCT h.media_id) AS n FROM history h WHERE ${W}`, win)?.n);
    const completedTitles = num(this.db.get<Row>('SELECT COUNT(*) AS n FROM state WHERE completed = 1 AND completed_at >= ? AND completed_at <= ?', win)?.n);
    const speedRow = this.db.get<Row>(`SELECT SUM(h.speed * h.watched_sec) / NULLIF(SUM(h.watched_sec), 0) AS s FROM history h WHERE ${W} AND h.kind = 'video'`, win);

    // Streak: consecutive days (ending today or yesterday) with any activity.
    const days = new Set(this.db.all<Row>(`SELECT DISTINCT ${localDay('started_at')} AS day FROM history WHERE watched_sec >= 10`).map((r) => str(r.day)));
    let streak = 0;
    const cursor = new Date();
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!days.has(fmt(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (days.has(fmt(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }

    return {
      totalSec, videoSec: kindSec('video'), audioSec: kindSec('audio'), readingSec: kindSec('comic', 'book', 'image'),
      sessions, titlesPlayed, completedTitles, longestSessionSec: longest, avgSessionSec: sessions ? totalSec / sessions : 0, streakDays: streak,
      daily: [...dailyMap.values()], hourly, weekday, topVideos, topSeries, topTracks, topArtists, topGenres, library, mostActiveHour,
      avgSpeed: speedRow?.s == null ? 1 : num(speedRow.s)
    };
  }
}
