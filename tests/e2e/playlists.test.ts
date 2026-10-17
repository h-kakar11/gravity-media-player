import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MediaItem, Playlist, PlaylistEntry } from '../../src/shared/types';
import { realErrors, startApp, type TestApp } from './support';

describe('playlists', () => {
  let t: TestApp;
  let tracks: MediaItem[];
  beforeAll(async () => {
    t = await startApp();
    tracks = (await t.items('audio')).filter((m) => m.album === 'Night Signals').sort((a, b) => (a.trackNo ?? 0) - (b.trackNo ?? 0));
  });
  afterAll(async () => { await t.close(); });

  const entries = (id: number) => t.invoke<PlaylistEntry[]>('playlists:items', id);
  const titles = async (id: number) => (await entries(id)).map((e) => e.item.title);

  it('creates a playlist that appears in the sidebar with its count', async () => {
    const pl = await t.invoke<Playlist>('playlists:create', 'Late night', tracks.slice(0, 3).map((x) => x.id));
    expect(pl.itemCount).toBe(3);
    await t.waitFor(async () => (await t.page.textContent('.sidebar'))?.includes('Late night'), { message: 'playlist in sidebar' });
    expect(await t.page.textContent('.side-item:has-text("Late night") .side-item__count')).toBe('3');
  });

  it('lists the items in order and plays them as a queue', async () => {
    const [pl] = await t.invoke<Playlist[]>('playlists:list');
    await t.page.click('.side-item:has-text("Late night")');
    await t.waitFor(async () => (await t.page.textContent('body'))?.includes('Opening'), { message: 'tracks listed' });
    expect(await titles(pl!.id)).toEqual(['Opening', 'Drift', 'Return']);
    await t.page.click('.btn--primary:has-text("Play")');
    await t.waitFor(async () => (await t.page.evaluate(() => window.__music().queue.length)) === 3, { message: 'queue filled' });
    expect(await t.page.evaluate(() => window.__music().queue.map((x: MediaItem) => x.title))).toEqual(['Opening', 'Drift', 'Return']);
    await t.page.evaluate(() => window.__music().stop());
  });

  it('reorders, adds duplicates, and removes entries', async () => {
    const [pl] = await t.invoke<Playlist[]>('playlists:list');
    const before = await entries(pl!.id);
    await t.invoke('playlists:reorder', pl!.id, [...before].reverse().map((e) => e.entryId));
    expect(await titles(pl!.id)).toEqual(['Return', 'Drift', 'Opening']);

    await t.invoke('playlists:add', pl!.id, [tracks[0]!.id]); // the same track twice is allowed
    expect(await titles(pl!.id)).toEqual(['Return', 'Drift', 'Opening', 'Opening']);
    const afterAdd = await entries(pl!.id);
    await t.invoke('playlists:remove', pl!.id, [afterAdd[3]!.entryId]);
    expect(await titles(pl!.id)).toEqual(['Return', 'Drift', 'Opening']);
    expect((await t.invoke<Playlist[]>('playlists:list'))[0]!.itemCount).toBe(3);
  });

  it('renames and deletes', async () => {
    const [pl] = await t.invoke<Playlist[]>('playlists:list');
    await t.invoke('playlists:update', pl!.id, { name: 'Wind down' });
    await t.waitFor(async () => (await t.page.textContent('.sidebar'))?.includes('Wind down'), { message: 'rename in sidebar' });
    await t.invoke('playlists:delete', pl!.id);
    await t.waitFor(async () => !(await t.page.textContent('.sidebar'))?.includes('Wind down'), { message: 'playlist removed from sidebar' });
    expect(await t.invoke<Playlist[]>('playlists:list')).toEqual([]);
  });

  it('never throws renderer errors', () => {
    expect(realErrors(t.errors)).toEqual([]);
  });
});
