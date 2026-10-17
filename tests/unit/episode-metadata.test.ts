import { describe, expect, it, vi } from 'vitest';
import { isPlaceholderEpisodeTitle, mergeEpisodeText } from '@shared/metadata';
import { Db } from '../../src/main/db/database';
import { MetaHttp } from '../../src/main/metadata/http';
import { fetchAniListEpisodes, fetchTmdbSeason } from '../../src/main/metadata/providers';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
/** No real waiting between requests: every clock read is 10 s after the last. */
const fastClock = () => { let t = 1_700_000_000_000; return () => (t += 10_000); };
const setup = (fetchFn: (url: string, init?: RequestInit) => Promise<Response>) => {
  const db = new Db(':memory:');
  return { db, http: new MetaHttp(db, fetchFn, fastClock()) };
};

describe('fetchTmdbSeason', () => {
  const season = { episodes: [
    { episode_number: 1, name: 'Winter Is Coming', overview: 'A king arrives.', air_date: '2011-04-17' },
    { episode_number: 2, name: 'Episode 2', overview: '', air_date: null },
    { name: 'No number' }
  ] };

  it('maps episodes, drops provider placeholder titles and empty summaries, and ignores rows without a number', async () => {
    const { db, http } = setup(async () => json(season));
    const eps = await fetchTmdbSeason(http, 'k3y', '1399', 1, 'en');
    expect(eps).toEqual([
      { season: 1, episode: 1, title: 'Winter Is Coming', plot: 'A king arrives.', airDate: '2011-04-17' },
      { season: 1, episode: 2, title: null, plot: null, airDate: null }
    ]);
    db.close();
  });

  it('sends a v3 key as a query parameter and a v4 token as a header, and never caches either', async () => {
    const fetchFn = vi.fn(async () => json(season));
    const { db, http } = setup(fetchFn);
    await fetchTmdbSeason(http, 'v3secret', '1399', 1, 'de');
    const [url3] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url3).toContain('/tv/1399/season/1');
    expect(url3).toContain('language=de');
    expect(url3).toContain('api_key=v3secret');

    const token = 'eyJhbGciOiJIUzI1NiJ9.payload.sig';
    await fetchTmdbSeason(http, token, '1399', 2, 'en');
    const [url4, init4] = fetchFn.mock.calls[1] as unknown as [string, RequestInit];
    expect(url4).not.toContain(token);
    expect(url4).not.toContain('api_key');
    expect((init4.headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`);

    const cached = JSON.stringify(db.all('SELECT key, json FROM meta_cache'));
    expect(cached).not.toContain('v3secret');
    expect(cached).not.toContain(token);
    db.close();
  });

  it('serves a repeat request from the cache', async () => {
    const fetchFn = vi.fn(async () => json(season));
    const { db, http } = setup(fetchFn);
    await fetchTmdbSeason(http, 'k', '1', 1, 'en');
    await fetchTmdbSeason(http, 'k', '1', 1, 'en');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    db.close();
  });

  it('treats an unknown season (404) as "no data" rather than an error', async () => {
    const { db, http } = setup(async () => json({ status_code: 34 }, 404));
    await expect(fetchTmdbSeason(http, 'k', '1', 9, 'en')).resolves.toBeNull();
    db.close();
  });

  it('reports other failures without leaking the key', async () => {
    const { db, http } = setup(async () => json({}, 401));
    const err = await fetchTmdbSeason(http, 'topsecret', '1', 1, 'en').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/check the API key/);
    expect((err as Error).message).not.toContain('topsecret');
    db.close();
  });

  it('propagates network failures', async () => {
    const { db, http } = setup(async () => { throw new TypeError('fetch failed'); });
    await expect(fetchTmdbSeason(http, 'k', '1', 1, 'en')).rejects.toThrow(/TMDB lookup failed/);
    db.close();
  });
});

describe('fetchAniListEpisodes', () => {
  const media = (m: unknown) => json({ data: { Media: m } });

  it('reads titles from streaming episodes, in any order, and files them under season 1', async () => {
    const { db, http } = setup(async () => media({
      episodes: 4,
      streamingEpisodes: [{ title: 'Episode 3 - The Hunt' }, { title: 'Episode 1 - Departure' }, { title: 'Episode 2' }, { title: 'Ep. 4: Return' }]
    }));
    const eps = await fetchAniListEpisodes(http, '21');
    expect(eps.map((e) => [e.season, e.episode, e.title])).toEqual([[1, 1, 'Departure'], [1, 2, null], [1, 3, 'The Hunt'], [1, 4, 'Return']]);
    expect(eps.every((e) => e.plot === null)).toBe(true); // AniList has no per-episode summaries
    db.close();
  });

  it('still lists every episode up to the known count when no titles exist', async () => {
    const { db, http } = setup(async () => media({ episodes: 3, streamingEpisodes: [] }));
    expect((await fetchAniListEpisodes(http, '5')).map((e) => e.episode)).toEqual([1, 2, 3]);
    db.close();
  });

  it('copes with an airing show whose count is unknown', async () => {
    const { db, http } = setup(async () => media({ episodes: null, streamingEpisodes: [{ title: 'Episode 2 - Two' }] }));
    expect((await fetchAniListEpisodes(http, '5')).map((e) => e.episode)).toEqual([1, 2]);
    db.close();
  });

  it('returns nothing for an unknown entry (null media or 404)', async () => {
    const a = setup(async () => media(null));
    expect(await fetchAniListEpisodes(a.http, '1')).toEqual([]);
    a.db.close();
    const b = setup(async () => json({ errors: [{ message: 'Not Found.' }] }, 404));
    expect(await fetchAniListEpisodes(b.http, '1')).toEqual([]);
    b.db.close();
  });

  it('bounds the number of rows a bogus count can create', async () => {
    const { db, http } = setup(async () => media({ episodes: 10_000_000 }));
    expect((await fetchAniListEpisodes(http, '1')).length).toBe(3000);
    db.close();
  });

  it('surfaces server errors', async () => {
    const { db, http } = setup(async () => json({}, 500));
    await expect(fetchAniListEpisodes(http, '1')).rejects.toThrow(/AniList lookup failed/);
    db.close();
  });
});

describe('mergeEpisodeText', () => {
  const online = { title: 'Online Title', plot: 'Online summary.' };

  it('uses online text for the placeholder the scanner invents', () => {
    expect(mergeEpisodeText({ title: 'Episode 4', plot: null }, online)).toEqual({ title: 'Online Title', plot: 'Online summary.' });
    expect(mergeEpisodeText({ title: 'Episode', plot: '' }, online)).toEqual({ title: 'Online Title', plot: 'Online summary.' });
  });

  it('never replaces a local title or summary (nfo, tags, file name)', () => {
    expect(mergeEpisodeText({ title: 'Pilot', plot: 'From the nfo.' }, online)).toEqual({ title: 'Pilot', plot: 'From the nfo.' });
  });

  it('fills only what is missing', () => {
    expect(mergeEpisodeText({ title: 'Pilot', plot: null }, online)).toEqual({ title: 'Pilot', plot: 'Online summary.' });
    expect(mergeEpisodeText({ title: 'Episode 4', plot: 'Local plot' }, online)).toEqual({ title: 'Online Title', plot: 'Local plot' });
  });

  it('falls back to local text when there is no online data', () => {
    expect(mergeEpisodeText({ title: 'Episode 4', plot: null })).toEqual({ title: 'Episode 4', plot: null });
    expect(mergeEpisodeText({ title: 'Episode 4', plot: null }, { title: null, plot: null })).toEqual({ title: 'Episode 4', plot: null });
    expect(mergeEpisodeText({ title: 'Episode 4', plot: null }, { title: '  ', plot: '  ' })).toEqual({ title: 'Episode 4', plot: null });
  });

  it('recognises placeholders but not real titles that merely start with the word', () => {
    expect(['Episode 12', 'episode 3', 'Episode', ' Episode 7 ', ''].every(isPlaceholderEpisodeTitle)).toBe(true);
    expect(['Episode One', 'The Episode', 'Episode 3: Revenge'].some(isPlaceholderEpisodeTitle)).toBe(false);
  });
});
