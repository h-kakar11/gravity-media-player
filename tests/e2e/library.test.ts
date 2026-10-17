import { copyFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LibraryRoot, MediaItem, QueryResult, SearchResults } from '../../src/shared/types';
import { realErrors, startApp, type TestApp } from './support';

describe('library', () => {
  let t: TestApp;
  beforeAll(async () => { t = await startApp(); });
  afterAll(async () => { await t.close(); });

  it('indexes every kind of media in the sample library', async () => {
    const count = async (kind: string) => (await t.invoke<QueryResult<MediaItem>>('library:query', { kind })).total;
    expect(await count('video')).toBe(10);
    expect(await count('audio')).toBe(6);
    expect(await count('image')).toBe(4);
    expect(await count('comic')).toBe(4);
    expect(await count('book')).toBe(1);
  });

  it('understands names, series and sidecar metadata', async () => {
    const episodes = (await t.items('video')).filter((m) => m.series === 'Signal Lost');
    expect(episodes.map((e) => [e.season, e.episode])).toEqual(expect.arrayContaining([[1, 1], [1, 2], [1, 3]]));
    const orbit = await t.find('Orbit Study');
    expect(orbit.year).toBe(2021);
    expect(orbit.plot).toBeTruthy(); // from the .nfo
    const opening = await t.find('Opening', 'audio');
    expect(opening.album).toBe('Night Signals');
    expect(opening.artist).toBe('Aurora Quartet');
  });

  it('finds items by title, artist and book name', async () => {
    const r = await t.invoke<SearchResults>('library:search', 'orbit');
    const titles = r.media.map((m) => m.title);
    expect(titles).toEqual(expect.arrayContaining(['Orbit Study', 'The Quiet Orbit']));
    expect((await t.invoke<SearchResults>('library:search', 'aurora')).artists.length).toBeGreaterThan(0);
  });

  it('shows new files without a restart, and keeps ratings across a rename', async () => {
    const dir = join(t.mediaDir, 'Music', 'Lumen', 'Singles');
    const added = join(dir, 'Lumen - Fresh.opus');
    copyFileSync(join(dir, 'Lumen - Glow.opus'), added);
    const fresh = await t.waitFor(async () => (await t.items('audio')).find((m) => m.path === added), { message: 'new file to appear', timeout: 30_000 });

    await t.invoke('state:update', fresh.id, { favorite: true, rating: 4 });
    const renamed = join(dir, 'Lumen - Fresh (renamed).opus');
    renameSync(added, renamed);
    const moved = await t.waitFor(async () => (await t.items('audio')).find((m) => m.path === renamed), { message: 'renamed file to be noticed', timeout: 30_000 });
    expect(moved.id).toBe(fresh.id); // same row: state follows the file
    expect(moved.rating).toBe(4);
    expect(moved.favorite).toBe(true);

    rmSync(renamed);
    await t.waitFor(async () => !(await t.items('audio')).some((m) => m.id === fresh.id), { message: 'deleted file to disappear', timeout: 30_000 });
  });

  it('keeps the library when a drive goes offline', async () => {
    const before = (await t.items()).length;
    const away = `${t.mediaDir}-away`;
    renameSync(t.mediaDir, away);
    try {
      await t.invoke('roots:rescan', null);
      await t.page.waitForTimeout(1500);
      const [root] = await t.invoke<LibraryRoot[]>('roots:list');
      expect(root!.online).toBe(false);
      expect((await t.items()).length).toBe(before);
    } finally {
      renameSync(away, t.mediaDir);
    }
    await t.invoke('roots:rescan', null);
    await t.waitFor(async () => (await t.invoke<LibraryRoot[]>('roots:list'))[0]!.online, { message: 'root to come back online' });
    expect((await t.items()).length).toBe(before);
  });

  it('never throws renderer errors while doing all that', () => {
    expect(realErrors(t.errors)).toEqual([]);
  });
});
