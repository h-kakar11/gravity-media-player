import { copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MediaItem, SeriesSummary } from '../../src/shared/types';
import type { NewEpisodeCounts, WatchOverview } from '../../src/shared/watch';
import { realErrors, startApp, type TestApp } from './support';

describe('watchlist and Up Next', () => {
  let t: TestApp;
  let showKey: string;
  let episodes: MediaItem[];
  beforeAll(async () => {
    t = await startApp();
    const shows = (await t.invoke<{ items: SeriesSummary[] }>('library:series', { type: 'show' })).items;
    showKey = shows.find((s) => s.title === 'Signal Lost')!.key;
    episodes = (await t.invoke<{ items: MediaItem[] }>('library:query', { kind: 'video', series: showKey, sort: 'episode' })).items;
  });
  afterAll(async () => { await t.close(); });

  const overview = () => t.invoke<WatchOverview>('watch:overview');
  const route = () => t.page.evaluate(() => window.__route().name as string);
  const body = async () => (await t.page.textContent('body')) ?? '';

  it('adds Watchlist to the sidebar and starts empty', async () => {
    expect(episodes).toHaveLength(3);
    await t.page.click('.side-item:has-text("Watchlist")');
    await t.waitFor(async () => (await route()) === 'watchlist', { message: 'Watchlist route' });
    await t.waitFor(async () => (await body()).includes('Nothing saved yet'), { message: 'empty state' });
    expect(await overview()).toEqual({ upNext: [], watchlist: [] });
  });

  it('adds a movie by searching the library', async () => {
    await t.page.click('button:has-text("Add…")');
    await t.page.fill('input[aria-label="Search your library"]', 'Neon');
    await t.page.click('.watch-add__row:has-text("Neon Drift")');
    await t.waitFor(async () => (await overview()).watchlist.length === 1, { message: 'movie saved' });
    const [entry] = (await overview()).watchlist;
    expect(entry).toMatchObject({ kind: 'movie', available: true, watched: false });
    expect(entry!.movie!.title).toContain('Neon Drift');
    await t.page.click('.sheet button:has-text("Done")');
    await t.waitFor(async () => !!(await t.page.$('.watch-row:has-text("Neon Drift")')), { message: 'movie row' });
  });

  it('bookmarks a show from its page and toggles it off again', async () => {
    await t.go({ name: 'show', key: showKey });
    await t.page.click('button[aria-label="Add to Watchlist"]');
    await t.waitFor(async () => (await overview()).watchlist.some((e) => e.kind === 'show'), { message: 'show saved' });
    await t.waitFor(async () => !!(await t.page.$('button[aria-label="Remove from Watchlist"]')), { message: 'button to flip' });
    await t.page.click('button[aria-label="Remove from Watchlist"]');
    await t.waitFor(async () => (await overview()).watchlist.every((e) => e.kind !== 'show'), { message: 'show removed' });
    await t.page.click('button[aria-label="Add to Watchlist"]');
    await t.waitFor(async () => (await overview()).watchlist.some((e) => e.kind === 'show'), { message: 'show saved again' });
    // New entries go to the end of the list: the show was added after the movie.
    expect((await overview()).watchlist.map((e) => e.kind)).toEqual(['movie', 'show']);
  });

  it('suggests the next episode once one is finished, on Home and the Watchlist page', async () => {
    expect((await overview()).upNext).toEqual([]); // nothing played yet
    await t.invoke('state:progress', { mediaId: episodes[0]!.id, positionSec: episodes[0]!.durationSec, completed: true });
    await t.waitFor(async () => (await overview()).upNext.length === 1, { message: 'Up Next entry' });
    const [next] = (await overview()).upNext;
    expect(next).toMatchObject({ seriesKey: showKey, showTitle: 'Signal Lost', playedCount: 1, episodeCount: 3, newEpisodes: 0 });
    expect(next!.episode.id).toBe(episodes[1]!.id);

    await t.go({ name: 'home' });
    await t.waitFor(async () => !!(await t.page.$('section[aria-label="Up Next"] .card')), { message: 'Up Next shelf on Home' });
    expect(await t.page.textContent('section[aria-label="Up Next"]')).toContain('Signal Lost');
    expect(await t.page.$('section[aria-label="Watchlist"]')).not.toBeNull(); // the movie is still to watch

    await t.go({ name: 'watchlist' });
    await t.waitFor(async () => !!(await t.page.$('.watch-row:has-text("Signal Lost")')), { message: 'Up Next row' });
  });

  it('starts the suggested episode with the rest of the show queued', async () => {
    await t.page.click('button[aria-label="Play Signal Lost"] >> nth=0');
    await t.waitFor(() => t.page.evaluate(() => window.__videoApi().open), { message: 'player to open' });
    const state = await t.page.evaluate(() => { const v = window.__videoApi(); return { id: v.item?.id, queue: v.queue.map((m: MediaItem) => m.id) }; });
    expect(state.id).toBe(episodes[1]!.id);
    expect(state.queue).toEqual(episodes.map((e) => e.id));
    await t.page.evaluate(() => window.__videoApi().close());
  });

  it('flags an episode that arrives later as new, and dismisses the badge', async () => {
    expect(await t.invoke<NewEpisodeCounts>('watch:badges')).toEqual({});
    const dir = join(t.mediaDir, 'TV', 'Signal Lost', 'Season 1');
    const source = readdirSync(dir).find((f) => f.includes('S01E03'))!;
    copyFileSync(join(dir, source), join(dir, 'Signal Lost - S01E04 - Late Arrival.mp4'));
    await t.invoke('roots:rescan', null);
    await t.waitFor(async () => (await t.invoke<NewEpisodeCounts>('watch:badges'))[showKey] === 1, { message: 'new episode to be flagged', timeout: 40_000 });

    await t.go({ name: 'videos' });
    await t.waitFor(async () => !!(await t.page.$('.card:has-text("Signal Lost") .pill--new')), { message: 'badge on the show card' });
    expect((await t.page.textContent('.card:has-text("Signal Lost") .pill--new'))?.trim()).toBe('1 new');

    await t.go({ name: 'watchlist' });
    await t.waitFor(async () => !!(await t.page.$('.watch-row:has-text("Signal Lost") .watch-tag')), { message: 'tag on the Up Next row' });
    await t.page.click('button[aria-label="Dismiss new episodes"]');
    await t.waitFor(async () => Object.keys(await t.invoke<NewEpisodeCounts>('watch:badges')).length === 0, { message: 'badge dismissed' });
    await t.waitFor(async () => !(await t.page.$('button[aria-label="Dismiss new episodes"]')), { message: 'dismiss control to go' });
    // Dismissing does not touch what is next.
    expect((await overview()).upNext[0]!.episode.id).toBe(episodes[1]!.id);
  });

  it('hides a show from Up Next, then removes saved items', async () => {
    await t.page.click('button[aria-label="Hide from Up Next"]');
    await t.waitFor(async () => (await overview()).upNext.length === 0, { message: 'Up Next to empty' });
    await t.waitFor(async () => !(await t.page.$('section[aria-label="Up Next"]')), { message: 'Up Next section to go' });

    await t.page.click('button[aria-label^="Remove Neon"]');
    await t.waitFor(async () => (await overview()).watchlist.every((e) => e.kind !== 'movie'), { message: 'movie removed' });
    expect((await overview()).watchlist.map((e) => e.kind)).toEqual(['show']);
  });

  it('registers the Up Next and Watchlist Home shelves in the default settings', async () => {
    const shelves = await t.invoke<{ home: { shelves: { id: string }[] } }>('settings:get');
    expect(shelves.home.shelves.map((s) => s.id).slice(0, 3)).toEqual(['continueWatching', 'upNext', 'watchlist']);
  });

  it('never throws renderer errors', () => {
    expect(realErrors(t.errors)).toEqual([]);
  });
});
