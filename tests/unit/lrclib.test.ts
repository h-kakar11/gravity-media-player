import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings';
import { Db } from '../../src/main/db/database';
import type { LibraryRepo } from '../../src/main/db/repo';
import { LrclibService, pickBest } from '../../src/main/lyrics/lrclib';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const LRC = '[00:01.00]Hello\n[00:05.50]World\n';
const SYNCED = { id: 1, trackName: 'Song', artistName: 'Artist', albumName: 'Album', duration: 200, instrumental: false, plainLyrics: 'Hello\nWorld', syncedLyrics: LRC };

let dir: string;
let db: Db;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'lrclib-')); db = new Db(':memory:'); });
afterEach(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });

function make(opts: { enabled?: boolean; fetchFn: (url: string, init?: RequestInit) => Promise<Response>; row?: Record<string, unknown> | null }) {
  const settings: Settings = structuredClone(DEFAULT_SETTINGS);
  settings.lyrics.lrclib = opts.enabled ?? true;
  const row = opts.row === undefined ? { id: 1, kind: 'audio', title: 'Song', artist: 'Artist', album: 'Album', duration: 199.6, path: join(dir, 'song.flac') } : opts.row;
  const repo = { getRow: () => row ?? undefined } as unknown as LibraryRepo;
  return new LrclibService(db, repo, { get: () => settings }, opts.fetchFn);
}

describe('LRCLIB lyrics', () => {
  it('is off by default', () => {
    expect(DEFAULT_SETTINGS.lyrics).toEqual({ lrclib: false, autoSave: false });
  });

  it('does nothing and makes no request while disabled', async () => {
    const fetchFn = vi.fn(async () => json(SYNCED));
    expect(await make({ enabled: false, fetchFn }).lyrics(1)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fetches synced lyrics by exact match and caches the result', async () => {
    const fetchFn = vi.fn(async () => json(SYNCED));
    const svc = make({ fetchFn });
    const r = await svc.lyrics(1);
    expect(r).toMatchObject({ synced: true, source: 'lrclib' });
    expect(r!.lines.map((l) => l.text)).toEqual(['Hello', 'World']);
    expect(r!.lines[1]!.timeSec).toBeCloseTo(5.5);
    const url = new URL((fetchFn.mock.calls[0] as unknown as [string])[0]);
    expect(url.pathname).toBe('/api/get');
    expect(url.searchParams.get('artist_name')).toBe('Artist');
    expect(url.searchParams.get('duration')).toBe('200');
    await svc.lyrics(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('falls back to search on a 404 and respects the duration tolerance', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('/api/get')) return json({ message: 'not found' }, 404);
      return json([{ ...SYNCED, id: 2, duration: 260 }, { ...SYNCED, id: 3, duration: 201, syncedLyrics: null }, { ...SYNCED, id: 4, duration: 201 }]);
    });
    const r = await make({ fetchFn }).lyrics(1);
    expect(r).toMatchObject({ synced: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('prefers synced results, then the closest duration', () => {
    const q = { title: 't', artist: 'a', album: '', durationSec: 200 };
    const best = pickBest([
      { id: 1, duration: 200, syncedLyrics: null, plainLyrics: 'x' },
      { id: 2, duration: 202, syncedLyrics: LRC },
      { id: 3, duration: 201, syncedLyrics: LRC },
      { id: 4, duration: 400, syncedLyrics: LRC }
    ], q);
    expect(best?.id).toBe(3);
    expect(pickBest([{ id: 5, duration: 400, syncedLyrics: LRC }], q)).toBeNull();
  });

  it('returns plain lyrics as unsynced and treats instrumentals as none', async () => {
    const plain = make({ fetchFn: async () => json({ ...SYNCED, syncedLyrics: null }) });
    expect(await plain.lyrics(1)).toMatchObject({ synced: false, source: 'lrclib' });
    db.run('DELETE FROM meta_cache');
    const inst = make({ fetchFn: async () => json({ ...SYNCED, instrumental: true, syncedLyrics: null, plainLyrics: null }) });
    expect(await inst.lyrics(1)).toBeNull();
  });

  it('remembers misses so the same song is not looked up again', async () => {
    const fetchFn = vi.fn(async () => json({ message: 'nope' }, 404));
    const svc = make({ fetchFn });
    expect(await svc.lyrics(1)).toBeNull();
    const calls = fetchFn.mock.calls.length;
    expect(await svc.lyrics(1)).toBeNull();
    expect(fetchFn.mock.calls.length).toBe(calls);
  });

  it('throws on network errors without recording a miss', async () => {
    let fail = true;
    const fetchFn = vi.fn(async () => { if (fail) throw new Error('offline'); return json(SYNCED); });
    const svc = make({ fetchFn });
    await expect(svc.lyrics(1)).rejects.toThrow('offline');
    fail = false;
    expect(await svc.lyrics(1)).toMatchObject({ synced: true });
  });

  it('skips songs without a title and artist, and non-audio rows', async () => {
    const fetchFn = vi.fn(async () => json(SYNCED));
    expect(await make({ fetchFn, row: { id: 1, kind: 'audio', title: 'Song', artist: '', album: '', duration: 10, path: 'x' } }).lyrics(1)).toBeNull();
    expect(await make({ fetchFn, row: { id: 1, kind: 'video', title: 'Song', artist: 'A', duration: 10, path: 'x' } }).lyrics(1)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('saves a sidecar .lrc without overwriting an existing one', async () => {
    const svc = make({ fetchFn: async () => json(SYNCED) });
    const { path } = await svc.saveSidecar(1);
    expect(path).toBe(join(dir, 'song.lrc'));
    expect(await readFile(path, 'utf8')).toBe(LRC);
    await writeFile(path, 'mine', 'utf8');
    await expect(svc.saveSidecar(1)).rejects.toThrow(/already exists/);
    expect(await readFile(path, 'utf8')).toBe('mine');
  });

  it('refuses to save when LRCLIB only has plain lyrics', async () => {
    const svc = make({ fetchFn: async () => json({ ...SYNCED, syncedLyrics: null }) });
    await expect(svc.saveSidecar(1)).rejects.toThrow(/no synced lyrics/);
  });
});
