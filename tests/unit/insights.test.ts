import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildHeatGrid, heatLevel } from '@shared/heatmap';
import { computeStreaks, MAX_SESSION_SEC, MIN_SESSION_SEC } from '@shared/insights';
import { renderYearInReviewHtml } from '@shared/year-in-review';
import { Db } from '../../src/main/db/database';
import { InsightsRepo } from '../../src/main/stats/insights';

const T0 = Date.UTC(2025, 0, 1);
const DAY = 86_400_000;
const at = (month: number, day: number, hour = 12) => Date.UTC(2025, month - 1, day, hour);

let db: Db;
let nextId = 1;
beforeEach(() => {
  db = new Db(':memory:');
  nextId = 1;
  db.run("INSERT INTO roots (id, path, name) VALUES (1, '/lib', 'lib')");
});
afterEach(() => db.close());

interface M { kind?: string; title: string; series?: string; season?: number; episode?: number; genre?: string; artist?: string; albumArtist?: string; album?: string; year?: number }
function media(m: M): number {
  const id = nextId++;
  db.run(
    `INSERT INTO media (id, root_id, path, dir, file_name, ext, kind, title, sort_title, added_at, scanned_at, series, season, episode, genre, artist, album_artist, album, year, art_src)
     VALUES (?, 1, ?, '/lib', ?, 'x', ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, `/lib/${id}`, `${id}`, m.kind ?? 'video', m.title, m.title, m.series ?? null, m.season ?? null, m.episode ?? null, m.genre ?? null, m.artist ?? null, m.albumArtist ?? null, m.album ?? null, m.year ?? null, `art${id}`]
  );
  return id;
}
function play(mediaId: number, startedAt: number, watched: number, kind = 'video') {
  db.run('INSERT INTO history (media_id, kind, started_at, watched_sec, media_sec) VALUES (?, ?, ?, ?, ?)', [mediaId, kind, startedAt, watched, 3600]);
}
const repo = (today = '2025-03-10') => new InsightsRepo(db, '+0 minutes', () => today);
const ALL: [number, number] = [0, T0 + 400 * DAY];

describe('computeStreaks', () => {
  it('finds current and longest streaks', () => {
    const s = computeStreaks(['2025-03-01', '2025-03-02', '2025-03-03', '2025-03-08', '2025-03-09', '2025-03-10'], '2025-03-10');
    expect(s).toMatchObject({ current: 3, longest: 3, activeDays: 6 });
    expect(s.longestStart).toBe('2025-03-01');
  });
  it('keeps a streak alive until the end of the next day', () => {
    expect(computeStreaks(['2025-03-08', '2025-03-09'], '2025-03-10').current).toBe(2);
    expect(computeStreaks(['2025-03-08', '2025-03-09'], '2025-03-11').current).toBe(0);
  });
  it('handles month and leap-year boundaries and duplicates', () => {
    expect(computeStreaks(['2024-02-28', '2024-02-29', '2024-03-01', '2024-03-01'], '2024-03-01')).toMatchObject({ current: 3, longest: 3, activeDays: 3 });
  });
  it('is empty-safe', () => {
    expect(computeStreaks([], '2025-01-01')).toEqual({ current: 0, longest: 0, longestStart: null, longestEnd: null, activeDays: 0 });
  });
});

describe('InsightsRepo', () => {
  it('ignores sessions under the minimum and corrupt over-long records', () => {
    const a = media({ title: 'A', genre: 'Drama' });
    play(a, at(3, 1), MIN_SESSION_SEC - 1);
    play(a, at(3, 2), MIN_SESSION_SEC);
    play(a, at(3, 3), MAX_SESSION_SEC + 1);
    play(a, at(3, 4), 600);
    const r = repo().compute({ from: 0, to: T0 + 400 * DAY });
    expect(r.heatmap).toEqual([{ day: '2025-03-02', sec: MIN_SESSION_SEC }, { day: '2025-03-04', sec: 600 }]);
    expect(r.genres[0]).toMatchObject({ name: 'Drama', sec: 605 });
  });

  it('ranks shows by time with distinct episodes, and leaves out movies', () => {
    const e1 = media({ title: 'E1', series: 'Cowboy Bebop', season: 1, episode: 1 });
    const e2 = media({ title: 'E2', series: 'Cowboy Bebop', season: 1, episode: 2 });
    const f = media({ title: 'F', series: 'Firefly', season: 1, episode: 1 });
    const mv = media({ title: 'Heat' });
    play(e1, at(3, 1), 1000); play(e1, at(3, 2), 500); play(e2, at(3, 3), 1000); play(f, at(3, 4), 4000); play(mv, at(3, 5), 9000);
    const shows = repo().compute({}).shows;
    expect(shows.map((s) => s.title)).toEqual(['Firefly', 'Cowboy Bebop']);
    expect(shows[1]).toMatchObject({ sec: 2500, episodes: 2, sessions: 3 });
    expect(shows[1]!.artMediaId).not.toBeNull();
  });

  it('splits multi-genre titles, merges case differences and separates video from music', () => {
    const v = media({ title: 'V', genre: 'Action; Sci-Fi' });
    const w = media({ title: 'W', genre: 'sci-fi' });
    const s = media({ kind: 'audio', title: 'S', genre: 'Rock', artist: 'X' });
    play(v, at(3, 1), 100); play(w, at(3, 2), 50); play(s, at(3, 3), 30, 'audio');
    const g = repo().compute({}).genres;
    expect(g.find((x) => x.name === 'Action')).toMatchObject({ sec: 100, videoSec: 100 });
    expect(g.find((x) => x.name.toLowerCase() === 'sci-fi')).toMatchObject({ sec: 150, videoSec: 150, audioSec: 0 });
    expect(g.find((x) => x.name === 'Rock')).toMatchObject({ sec: 30, audioSec: 30 });
  });

  it('aggregates artists and albums, using the album artist for compilations', () => {
    const t1 = media({ kind: 'audio', title: 't1', artist: 'Feat A', albumArtist: 'Various', album: 'Mix' });
    const t2 = media({ kind: 'audio', title: 't2', artist: 'Feat B', albumArtist: 'Various', album: 'Mix' });
    const t3 = media({ kind: 'audio', title: 't3', artist: 'Solo', album: 'Alone' });
    const t4 = media({ kind: 'audio', title: 't4', artist: 'Nobody' });
    play(t1, at(3, 1), 200, 'audio'); play(t1, at(3, 2), 200, 'audio'); play(t2, at(3, 2), 100, 'audio'); play(t3, at(3, 3), 250, 'audio'); play(t4, at(3, 3), 10, 'audio');
    const r = repo().compute({});
    expect(r.artists.slice(0, 2)).toMatchObject([{ name: 'Various', sec: 500, plays: 3, tracks: 2 }, { name: 'Solo', sec: 250, plays: 1, tracks: 1 }]);
    expect(r.albums.map((a) => [a.album, a.artist, a.sec, a.tracks])).toEqual([['Mix', 'Various', 500, 2], ['Alone', 'Solo', 250, 1]]);
  });

  it('respects the requested window for rankings, shows the last year in the calendar and computes streaks over all history', () => {
    const a = media({ title: 'A', series: 'Show' });
    for (const d of [1, 2, 3, 4]) play(a, at(3, d), 100);
    play(a, at(1, 5), 100);
    const r = repo('2025-03-04').compute({ from: at(3, 3, 0), to: at(3, 31) });
    expect(r.shows[0]!.sec).toBe(200);
    expect(r.heatmap.map((h) => h.day)).toEqual(['2025-01-05', '2025-03-01', '2025-03-02', '2025-03-03', '2025-03-04']);
    expect(r.streak).toMatchObject({ current: 4, longest: 4, activeDays: 5 });
  });

  it('attributes a session to the day it started and honours the time zone offset', () => {
    const a = media({ title: 'A' });
    play(a, Date.UTC(2025, 2, 1, 23, 50), 1200); // crosses midnight UTC
    const utc = new InsightsRepo(db, '+0 minutes').heatmap(ALL);
    expect(utc).toEqual([{ day: '2025-03-01', sec: 1200 }]);
    const plus = new InsightsRepo(db, '+120 minutes').heatmap(ALL);
    expect(plus).toEqual([{ day: '2025-03-02', sec: 1200 }]);
  });

  it('builds a year in review limited to that year', () => {
    const e = media({ title: 'E1', series: 'Show', genre: 'Drama' });
    const mv = media({ title: 'Heat', year: 1995 });
    const t = media({ kind: 'audio', title: 'Song', artist: 'Band', album: 'LP' });
    play(e, Date.UTC(2024, 11, 31, 22), 9999);
    play(e, Date.UTC(2025, 0, 1, 20), 3600);
    play(e, Date.UTC(2025, 0, 2, 20), 1800);
    play(mv, Date.UTC(2025, 5, 15, 21), 7200);
    play(t, Date.UTC(2025, 5, 15, 8), 180, 'audio'); play(t, Date.UTC(2025, 5, 16, 8), 180, 'audio');
    play(e, Date.UTC(2026, 0, 1, 1), 9999);
    const y = repo().yearInReview(2025, [Date.UTC(2025, 0, 1), Date.UTC(2026, 0, 1) - 1]);
    expect(y).toMatchObject({ year: 2025, videoSec: 12600, audioSec: 360, readingSec: 0, totalSec: 12960, sessions: 5, titles: 3, activeDays: 4, longestStreak: 2 });
    expect(y.busiestDay).toEqual({ day: '2025-06-15', sec: 7380 });
    expect(y.months[0]).toBe(5400);
    expect(y.months[5]).toBe(7560);
    expect(y.months.reduce((a, b) => a + b, 0)).toBe(y.totalSec);
    expect(y.topMovies[0]).toEqual({ title: 'Heat', sec: 7200, year: 1995 });
    expect(y.topTracks[0]).toEqual({ title: 'Song', artist: 'Band', plays: 2, sec: 360 });
    expect(y.topShows[0]).toMatchObject({ title: 'Show', sec: 5400, episodes: 1 });
    expect(y.mostActiveHour).toBe(21);
  });

  it('returns zeros for an empty year', () => {
    const y = repo().yearInReview(2020, [Date.UTC(2020, 0, 1), Date.UTC(2021, 0, 1) - 1]);
    expect(y).toMatchObject({ totalSec: 0, sessions: 0, activeDays: 0, busiestDay: null, mostActiveHour: null });
    expect(renderYearInReviewHtml(y)).toContain('Nothing was played');
  });
});

describe('heatmap grid', () => {
  it('buckets levels in quarters of the busiest day', () => {
    expect([0, 1, 25, 26, 50, 51, 75, 76, 100].map((s) => heatLevel(s, 100))).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect(heatLevel(5, 0)).toBe(0);
  });
  it('lays days out Monday-first, one column per week', () => {
    const g = buildHeatGrid([{ day: '2025-01-06', sec: 10 }], '2025-01-01', '2025-01-12'); // Wed .. Sun
    expect(g.cells[0]).toMatchObject({ day: '2025-01-01', col: 0, row: 2 });
    expect(g.cells.find((c) => c.day === '2025-01-06')).toMatchObject({ col: 1, row: 0, level: 4 });
    expect(g.weeks).toBe(2);
    expect(g.cells).toHaveLength(12);
  });
  it('covers a whole year without drifting across DST', () => {
    expect(buildHeatGrid([], '2025-01-01', '2025-12-31').cells).toHaveLength(365);
    expect(buildHeatGrid([], '2024-01-01', '2024-12-31').cells).toHaveLength(366);
  });
});

describe('year-in-review HTML', () => {
  it('escapes titles, loads nothing remote and has no scripts', () => {
    const e = media({ title: 'E', series: '<img src=x onerror=alert(1)> & "Show"' });
    play(e, at(3, 1), 3600);
    const html = renderYearInReviewHtml(repo().yearInReview(2025, [T0, T0 + 365 * DAY]));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;Show&quot;');
    expect(html).not.toMatch(/<script|https?:\/\/|<link|<img/i);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('Your 2025 in Gravity');
  });
});
