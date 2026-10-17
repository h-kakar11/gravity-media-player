import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/settings';
import { Db } from '../../src/main/db/database';
import { MetaHttp } from '../../src/main/metadata/http';
import { searchAniList, searchTmdb, titleScore } from '../../src/main/metadata/providers';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('metadata', () => {
  it('is off by default and the key defaults empty', () => {
    expect(DEFAULT_SETTINGS.metadata.enabled).toBe(false);
    expect(DEFAULT_SETTINGS.metadata.tmdbKey).toBe('');
  });

  it('scores titles ignoring case and punctuation', () => {
    expect(titleScore('Attack on Titan', 'attack on titan!')).toBe(1);
    expect(titleScore('Attack on Titan', 'Naruto')).toBe(0);
    expect(titleScore('Cowboy Bebop', 'Cowboy Bebop: The Movie')).toBeGreaterThan(0.5);
  });

  it('parses AniList GraphQL results and caches repeat lookups', async () => {
    const db = new Db(':memory:');
    const fetchFn = vi.fn(async () => json({ data: { Page: { media: [{ id: 1, title: { romaji: 'Cowboy Bebop', english: 'Cowboy Bebop' }, seasonYear: 1998, description: '<i>Space</i> cowboys', genres: ['Action'], coverImage: { large: 'http://x/c.jpg' } }] } } }));
    const http = new MetaHttp(db, fetchFn, () => Date.now());
    const a = await searchAniList(http, 'Cowboy Bebop');
    expect(a[0]).toMatchObject({ provider: 'anilist', id: '1', year: 1998, plot: 'Space cowboys', score: 1 });
    await searchAniList(http, 'Cowboy Bebop');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graphql.anilist.co');
    expect(init.method).toBe('POST');
    db.close();
  });

  it('queries TMDB with the key but never stores it in the cache', async () => {
    const db = new Db(':memory:');
    const fetchFn = vi.fn(async () => json({ results: [{ id: 603, title: 'The Matrix', release_date: '1999-03-30', overview: 'Neo.', genre_ids: [28, 878], poster_path: '/p.jpg' }] }));
    const http = new MetaHttp(db, fetchFn, () => Date.now());
    const r = await searchTmdb(http, 'secretkey', 'movie', 'The Matrix', 1999, 'en');
    expect(r[0]).toMatchObject({ provider: 'tmdb', id: '603', year: 1999, genres: ['Action', 'Science Fiction'] });
    expect(r[0]!.poster).toContain('/p.jpg');
    const rows = db.all<{ key: string; json: string }>('SELECT key, json FROM meta_cache');
    expect(JSON.stringify(rows)).not.toContain('secretkey');
    db.close();
  });

  it('surfaces HTTP errors without leaking the key', async () => {
    const db = new Db(':memory:');
    const http = new MetaHttp(db, async () => json({}, 401), () => Date.now());
    await expect(searchTmdb(http, 'secretkey', 'movie', 'x', undefined, 'en')).rejects.toThrow(/check the API key/);
    await expect(searchTmdb(http, 'secretkey', 'movie', 'x', undefined, 'en')).rejects.not.toThrow(/secretkey/);
    db.close();
  });

  it('waits out HTTP 429 (Retry-After) and retries, then gives up after a few tries', async () => {
    const db = new Db(':memory:');
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };
    let calls = 0;
    const limited = vi.fn(async () => (++calls < 3 ? new Response('{}', { status: 429, headers: { 'Retry-After': '5' } }) : json({ data: { Page: { media: [] } } })));
    const http = new MetaHttp(db, limited, () => Date.now(), sleep);
    await expect(searchAniList(http, 'Bleach')).resolves.toEqual([]);
    expect(limited).toHaveBeenCalledTimes(3);
    expect(sleeps).toContain(5000);

    const always = vi.fn(async () => json({}, 429));
    const stuck = new MetaHttp(db, always, () => Date.now(), sleep);
    await expect(searchAniList(stuck, 'Naruto')).rejects.toThrow(/429/);
    expect(always).toHaveBeenCalledTimes(4);
    db.close();
  });
});
