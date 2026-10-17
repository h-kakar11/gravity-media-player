import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import type { MetaCandidate } from '@shared/metadata';
import { emptyFields } from '../../src/main/library/types';
import { MetadataService } from '../../src/main/metadata/service';
import { makeApp } from './helpers';

const DAY = 86_400_000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

type App = ReturnType<typeof makeApp>;
type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

let app: App;
let clock: number;
let calls: string[];
let handler: Handler;
let svc: MetadataService;
let rootId: number;
let seq = 0;

/** Every clock read is 10 s later than the last, so the per-host request gap never makes a test wait. */
const now = () => (clock += 10_000);

function addEpisode(series: string, season: number | null, episode: number, extra: { title?: string; plot?: string | null } = {}): number {
  const n = ++seq;
  const f = emptyFields({
    rootId, path: `/lib/${series}/s${season ?? 'x'}e${episode}-${n}.mkv`, dir: `/lib/${series}`, fileName: `s${season}e${episode}-${n}.mkv`,
    ext: 'mkv', kind: 'video', title: extra.title ?? `Episode ${episode}`, size: 1000 + n, mtimeMs: 1
  });
  f.vclass = 'episode';
  f.series = series;
  f.season = season;
  f.episode = episode;
  f.plot = extra.plot ?? null;
  return app.repo.upsertMedia(f).id;
}

function addMovie(title: string, plot: string | null = null, year: number | null = null): number {
  const n = ++seq;
  const f = emptyFields({ rootId, path: `/lib/movies/${title}-${n}.mkv`, dir: '/lib/movies', fileName: `${title}.mkv`, ext: 'mkv', kind: 'video', title, size: 2000 + n, mtimeMs: 1 });
  f.vclass = 'movie';
  f.plot = plot;
  f.year = year;
  return app.repo.upsertMedia(f).id;
}

/** No poster, so tests never reach the global `fetch` used for artwork downloads. */
const tmdbShow = (id = '1399', title = 'Game of Thrones'): MetaCandidate => ({ provider: 'tmdb', id, kind: 'series', title, year: 2011, plot: 'Nine noble families.', genres: ['Drama'], score: 1 });
const aniShow = (id = '21', title = 'One Piece'): MetaCandidate => ({ provider: 'anilist', id, kind: 'series', title, year: 1999, genres: ['Action'], score: 1 });
const SERIES = { kind: 'series', key: 'game of thrones' } as const;

const tmdbSeason = (season: number, count: number, plot = true) => json({
  episodes: Array.from({ length: count }, (_, i) => ({
    episode_number: i + 1, name: `S${season} Title ${i + 1}`, overview: plot ? `S${season} summary ${i + 1}` : '', air_date: `2011-0${season}-0${i + 1}`
  }))
});

/** TMDB answers for seasons 1 and 2 only (plus whatever `handler` is overridden to do); anything else is a network error. */
const defaultHandler: Handler = (url) => {
  const m = /\/tv\/(\d+)\/season\/(\d+)/.exec(url);
  if (m) return Number(m[2]) <= 2 ? tmdbSeason(Number(m[2]), 3) : json({ status_code: 34 }, 404);
  if (url.includes('graphql.anilist.co')) {
    return json({ data: { Media: { episodes: 3, streamingEpisodes: [{ title: 'Episode 1 - Romance Dawn' }, { title: 'Episode 2 - Enter the Great Swordsman' }] } } });
  }
  throw new TypeError('unexpected request ' + url);
};

beforeEach(() => {
  app = makeApp();
  clock = 1_700_000_000_000;
  calls = [];
  handler = defaultHandler;
  seq = 0;
  rootId = app.repo.addRoot('/lib', 'Lib', 'auto');
  app.settings.set({ metadata: { enabled: true, tmdbKey: 'k3y-secret', anilist: true, tmdb: true, language: 'en' } });
  svc = new MetadataService(app.db, app.repo, app.paths, app.settings, async (url, init) => { calls.push(url); return handler(url, init); }, now);
});

afterEach(() => {
  app.settings.flush();
  app.db.close();
  rmSync(app.base, { recursive: true, force: true });
});

describe('episode metadata sync (TMDB)', () => {
  beforeEach(() => {
    for (const s of [1, 2]) for (const e of [1, 2, 3]) addEpisode('Game of Thrones', s, e);
  });

  it('stores titles, summaries and air dates for the seasons the library has', async () => {
    const res = await svc.apply(SERIES, tmdbShow());
    expect(res).toMatchObject({ rows: 6, episodeError: null, episodes: { seasons: 2, episodes: 6, failedSeasons: 0 } });
    const eps = svc.episodesFor('Game of Thrones');
    expect(eps).toHaveLength(6);
    expect(eps[0]).toEqual({ season: 1, episode: 1, title: 'S1 Title 1', plot: 'S1 summary 1', airDate: '2011-01-01' });
    expect(eps[5]).toMatchObject({ season: 2, episode: 3, title: 'S2 Title 3' });
  });

  it('asks only for seasons the library actually has', async () => {
    addEpisode('Game of Thrones', 5, 1);
    await svc.apply(SERIES, tmdbShow());
    const asked = calls.filter((u) => u.includes('/season/')).map((u) => /season\/(\d+)/.exec(u)![1]);
    expect(asked.sort()).toEqual(['1', '2', '5']);
    // season 5 was a 404 at the provider: skipped, not an error
    expect(svc.episodesFor('Game of Thrones').some((e) => e.season === 5)).toBe(false);
  });

  it('does not touch the media rows’ own title or plot', async () => {
    const id = addEpisode('Game of Thrones', 1, 9, { title: 'Winterfell', plot: 'From the nfo.' });
    await svc.apply(SERIES, tmdbShow());
    const row = app.db.get<{ title: string; plot: string | null }>('SELECT title, plot FROM media WHERE id = ?', [id])!;
    expect(row).toEqual({ title: 'Winterfell', plot: 'From the nfo.' });
    const untouched = app.db.all<{ title: string }>("SELECT title FROM media WHERE series = 'Game of Thrones' AND episode < 4 ORDER BY season, episode");
    expect(untouched.map((r) => r.title)).toEqual(['Episode 1', 'Episode 2', 'Episode 3', 'Episode 1', 'Episode 2', 'Episode 3']);
  });

  it('reads the stored episodes with no network and with lookups turned off', async () => {
    await svc.apply(SERIES, tmdbShow());
    const before = calls.length;
    app.settings.set({ metadata: { enabled: false } });
    expect(svc.episodesFor('GAME OF THRONES')).toHaveLength(6);
    expect(calls.length).toBe(before);
    await expect(svc.syncEpisodes('game of thrones')).rejects.toThrow(/turned off/);
  });

  it('answers a repeat sync from the HTTP cache', async () => {
    await svc.apply(SERIES, tmdbShow());
    const first = calls.length;
    await svc.syncEpisodes('game of thrones');
    expect(calls.length).toBe(first);
  });

  it('keeps the match and reports a readable reason when the provider is unreachable', async () => {
    handler = () => { throw new TypeError('fetch failed'); };
    const res = await svc.apply(SERIES, tmdbShow());
    expect(res.rows).toBe(6);
    expect(res.episodes).toBeNull();
    expect(res.episodeError).toMatch(/TMDB lookup failed/);
    expect(svc.matchFor(SERIES)).toMatchObject({ provider: 'tmdb', id: '1399', locked: true });
    expect(svc.episodesFor('Game of Thrones')).toEqual([]);
  });

  it('reports a bad key without echoing it, and asks only once', async () => {
    handler = () => json({ status_message: 'Invalid API key' }, 401);
    const res = await svc.apply(SERIES, tmdbShow());
    expect(res.episodeError).toMatch(/API key/);
    expect(res.episodeError).not.toContain('k3y-secret');
    expect(calls.filter((u) => u.includes('/season/'))).toHaveLength(1);
  });

  it('keeps the previous rows for a season that failed while refreshing the others', async () => {
    await svc.apply(SERIES, tmdbShow());
    clock += 30 * DAY; // everything cached is now stale
    handler = (url) => (url.includes('/season/2') ? json({}, 500) : tmdbSeason(1, 3, false));
    const sync = await svc.syncEpisodes('game of thrones');
    expect(sync).toEqual({ seasons: 1, episodes: 3, failedSeasons: 1 });
    const eps = svc.episodesFor('Game of Thrones');
    expect(eps.filter((e) => e.season === 2).map((e) => e.title)).toEqual(['S2 Title 1', 'S2 Title 2', 'S2 Title 3']);
    expect(eps.filter((e) => e.season === 1).every((e) => e.plot === null)).toBe(true); // refreshed with the new (empty) summaries
  });

  it('rejects when every season failed, leaving stored rows alone', async () => {
    await svc.apply(SERIES, tmdbShow());
    clock += 30 * DAY;
    handler = () => json({}, 500);
    await expect(svc.syncEpisodes('game of thrones')).rejects.toThrow(/TMDB lookup failed/);
    expect(svc.episodesFor('Game of Thrones')).toHaveLength(6);
  });

  it('drops the old show’s episodes when Fix Match picks a different show', async () => {
    await svc.apply(SERIES, tmdbShow());
    handler = () => { throw new TypeError('offline'); }; // the new pick's episodes cannot be fetched
    const res = await svc.apply(SERIES, tmdbShow('999', 'House of the Dragon'));
    expect(res.episodeError).toBeTruthy();
    expect(svc.matchFor(SERIES)?.id).toBe('999');
    expect(svc.episodesFor('Game of Thrones')).toEqual([]);
  });

  it('keeps the episodes when the same show is re-picked and the lookup then fails', async () => {
    await svc.apply(SERIES, tmdbShow());
    handler = () => { throw new TypeError('offline'); };
    await svc.apply(SERIES, tmdbShow());
    expect(svc.episodesFor('Game of Thrones')).toHaveLength(6);
  });

  it('clearing the match removes the episode info with it', async () => {
    await svc.apply(SERIES, tmdbShow());
    svc.clear(SERIES);
    expect(svc.matchFor(SERIES)).toBeNull();
    expect(svc.episodesFor('Game of Thrones')).toEqual([]);
  });

  it('requires a match, and a key', async () => {
    await expect(svc.syncEpisodes('nobody')).rejects.toThrow(/no match/i);
    await svc.apply(SERIES, tmdbShow());
    app.settings.set({ metadata: { tmdbKey: '' } });
    await expect(svc.syncEpisodes('game of thrones')).rejects.toThrow(/API key/i);
  });

  it('never writes the credential to the database', async () => {
    await svc.apply(SERIES, tmdbShow());
    const dump = JSON.stringify([app.db.all('SELECT * FROM meta_cache'), app.db.all('SELECT * FROM meta_episode'), app.db.all('SELECT * FROM meta_match')]);
    expect(dump).not.toContain('k3y-secret');
    // ...although it really was sent
    expect(calls.some((u) => u.includes('api_key=k3y-secret'))).toBe(true);
  });
});

describe('episode metadata sync (AniList)', () => {
  const key = { kind: 'series', key: 'one piece' } as const;
  beforeEach(() => { for (const e of [1, 2, 3]) addEpisode('One Piece', 1, e); });

  it('stores titles under season 1, with no summaries', async () => {
    const res = await svc.apply(key, aniShow());
    expect(res.episodes).toEqual({ seasons: 1, episodes: 3, failedSeasons: 0 });
    expect(svc.episodesFor('One Piece')).toEqual([
      { season: 1, episode: 1, title: 'Romance Dawn', plot: null, airDate: null },
      { season: 1, episode: 2, title: 'Enter the Great Swordsman', plot: null, airDate: null },
      { season: 1, episode: 3, title: null, plot: null, airDate: null }
    ]);
  });

  it('respects the AniList switch', async () => {
    app.settings.set({ metadata: { anilist: false } });
    const res = await svc.apply(key, aniShow());
    expect(res.episodeError).toMatch(/AniList is turned off/);
    expect(res.rows).toBe(3);
  });
});

describe('locked matches and the Match Now backfill', () => {
  beforeEach(() => { for (const e of [1, 2, 3]) addEpisode('Game of Thrones', 1, e); });

  it('fills episode info for a show matched before the feature existed, using the stored provider id', async () => {
    // A pre-existing manual (locked) match with no episode rows.
    app.db.run(
      "INSERT INTO meta_match (kind, key, provider, ext_id, title, year, plot, genres, poster, locked, matched_at) VALUES ('series', 'game of thrones', 'tmdb', '1399', 'Game of Thrones', 2011, NULL, '[]', NULL, 1, 1)"
    );
    const res = await svc.autoMatch();
    expect(res).toEqual({ matched: 0, skipped: 0, failed: 0, episodes: 1 });
    expect(svc.episodesFor('Game of Thrones')).toHaveLength(3);
    expect(svc.matchFor(SERIES)).toMatchObject({ id: '1399', locked: true }); // no search, no replacement
    expect(calls.every((u) => u.includes('/tv/1399/season/'))).toBe(true);
  });

  it('does not refresh fresh episode info, but does once it is two weeks old', async () => {
    await svc.apply(SERIES, tmdbShow());
    calls.length = 0;
    expect(await svc.autoMatch()).toMatchObject({ episodes: 0, failed: 0 });
    expect(calls).toHaveLength(0);

    clock += 15 * DAY;
    app.db.run('DELETE FROM meta_cache'); // the 7-day HTTP cache would also have expired
    expect(await svc.autoMatch()).toMatchObject({ episodes: 1, failed: 0 });
    expect(calls.filter((u) => u.includes('/season/'))).toHaveLength(1);
  });

  it('picks up a season added to the library after the show was matched', async () => {
    await svc.apply(SERIES, tmdbShow());
    addEpisode('Game of Thrones', 2, 1);
    await svc.autoMatch();
    expect(svc.episodesFor('Game of Thrones').some((e) => e.season === 2)).toBe(true);
  });

  it('stops early when the key is rejected instead of failing every show', async () => {
    for (const e of [1, 2]) addEpisode('Another Show', 1, e);
    for (const [k, n] of [['game of thrones', '1'], ['another show', '2']] as const) {
      app.db.run("INSERT INTO meta_match (kind, key, provider, ext_id, title, locked, matched_at) VALUES ('series', ?, 'tmdb', ?, ?, 1, 1)", [k, n, k]);
    }
    handler = () => json({}, 401);
    const res = await svc.autoMatch();
    expect(res.failed).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it('does nothing for shows without a stored provider match', async () => {
    app.db.run("INSERT INTO meta_match (kind, key, provider, ext_id, title, locked, matched_at) VALUES ('series', 'game of thrones', 'musicbrainz', 'x', 'GoT', 1, 1)");
    expect(await svc.autoMatch()).toMatchObject({ episodes: 0, failed: 0 });
  });
});

describe('movie matches (regression: Fix Match on a movie)', () => {
  it('fills an empty plot and year but never overwrites local ones', async () => {
    const withNfo = addMovie('Heat', 'Plot from the .nfo.', 1995);
    const bare = addMovie('Ronin');
    const cand = (title: string): MetaCandidate => ({ provider: 'tmdb', id: '1', kind: 'movie', title, year: 2001, plot: 'Online plot.', genres: ['Crime'], score: 1 });
    const a = await svc.apply({ kind: 'movie', key: String(withNfo) }, cand('Heat'));
    const b = await svc.apply({ kind: 'movie', key: String(bare) }, cand('Ronin'));
    expect(a).toEqual({ rows: 1, episodes: null, episodeError: null });
    expect(b.episodes).toBeNull();
    expect(app.db.get<{ plot: string; year: number }>('SELECT plot, year FROM media WHERE id = ?', [withNfo])).toEqual({ plot: 'Plot from the .nfo.', year: 1995 });
    expect(app.db.get<{ plot: string; year: number }>('SELECT plot, year FROM media WHERE id = ?', [bare])).toEqual({ plot: 'Online plot.', year: 2001 });
    expect(calls).toHaveLength(0); // movies need no further lookups
  });

  it('keeps a manual pick locked against auto-match', async () => {
    const id = addMovie('Heat');
    await svc.apply({ kind: 'movie', key: String(id) }, { provider: 'tmdb', id: '949', kind: 'movie', title: 'Heat', year: 1995, genres: [], score: 1 });
    handler = () => json({ results: [{ id: 1, title: 'Something Else', release_date: '2001-01-01', overview: '', genre_ids: [] }] });
    const res = await svc.autoMatch();
    expect(res.matched).toBe(0);
    expect(svc.matchFor({ kind: 'movie', key: String(id) })?.id).toBe('949');
  });
});

describe('album matches', () => {
  it('apply reaches the album’s audio rows (regression: the filter used kind = \'music\', which matches nothing) and skips episode sync', async () => {
    const f = emptyFields({ rootId, path: '/lib/music/a.flac', dir: '/lib/music', fileName: 'a.flac', ext: 'flac', kind: 'audio', title: 'One', size: 5, mtimeMs: 1 });
    f.album = 'Kid A';
    f.artist = 'Radiohead';
    app.repo.upsertMedia(f);
    const album = app.db.get<{ album_key: string }>('SELECT album_key FROM media')!.album_key;
    expect(album).toBe('radiohead\u0001kid a');
    const res = await svc.apply({ kind: 'album', key: album }, { provider: 'musicbrainz', id: 'mbid', kind: 'album', title: 'Kid A', year: 2000, genres: [], score: 1 });
    expect(res).toEqual({ rows: 1, episodes: null, episodeError: null });
    expect(calls).toHaveLength(0);
  });
});
