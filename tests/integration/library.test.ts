import { copyFileSync, cpSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeApp, sampleLibrary } from './helpers';

// Work on a private copy so tests can add/rename/delete files freely.
let app: ReturnType<typeof makeApp>;
let lib: string;
let rootId: number;

beforeAll(async () => {
  const sample = sampleLibrary();
  lib = join(mkdtempSync(join(tmpdir(), 'gravity-copy-')), 'library');
  cpSync(sample, lib, { recursive: true });
  app = makeApp();
  rootId = app.repo.addRoot(lib, 'Test Library', 'auto');
  await app.indexer.scanRoot(rootId);
}, 180_000);

const q = (o: Parameters<typeof app.repo.query>[0]) => app.repo.query(o).items;

describe('initial scan', () => {
  it('finds each kind of media and ignores artwork images', () => {
    const counts = Object.fromEntries(['video', 'audio', 'image', 'comic', 'book'].map((k) => [k, q({ kind: k as never }).length]));
    expect(counts.video).toBe(10); // 7 movies/clips + 3 episodes
    expect(counts.audio).toBe(6);
    expect(counts.image).toBe(4); // photos only: cover.jpg / poster.jpg are artwork
    expect(counts.comic).toBe(4); // 2 cbz + 2 folder chapters
    expect(counts.book).toBe(1);
  });

  it('reads movie metadata from names, NFO and ffprobe', () => {
    const m = q({ text: 'Orbit' }).find((x) => x.kind === 'video')!;
    expect(m).toMatchObject({ title: 'Orbit Study', year: 2021, vclass: 'movie', audioTrackCount: 2, subtitleTrackCount: 2, vcodec: 'h264', container: 'mkv', genre: 'Science Fiction; Drama' });
    expect(m.plot).toMatch(/quiet study/);
    expect(m.durationSec).toBeGreaterThan(5);
    expect(m.hasArt).toBe(true); // poster.jpg sidecar
  });

  it('detects frame rates up to 300 fps and 10-bit video', () => {
    const hfr = q({ text: 'High Frame' })[0]!;
    expect(Math.round(hfr.fps)).toBe(300);
    const tenBit = q({ text: 'Ten Bit' })[0]!;
    expect(tenBit.bitDepth).toBe(10);
    expect(tenBit.vcodec).toBe('h264');
  });

  it('groups TV episodes into a series', () => {
    const series = app.repo.series({ type: 'show' }).items;
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ title: 'Signal Lost', episodeCount: 3, seasonCount: 1 });
    const eps = q({ series: 'signal lost', sort: 'episode' });
    expect(eps.map((e) => [e.season, e.episode, e.title])).toEqual([[1, 1, 'Pilot'], [1, 2, 'Static'], [1, 3, 'Dead Air']]);
    expect(eps[0]!.vclass).toBe('episode');
  });

  it('classifies year-less short videos as clips', () => {
    expect(q({ text: 'Holiday' })[0]!.vclass).toBe('clip');
  });

  it('reads music tags, embeds cover art and groups albums', () => {
    const albums = app.repo.albums({}).items;
    const night = albums.find((a) => a.album === 'Night Signals')!;
    expect(night).toMatchObject({ artist: 'Aurora Quartet', trackCount: 4, year: 2020 });
    expect(night.artMediaId).not.toBeNull();
    const tracks = q({ album: night.key, sort: 'track' });
    expect(tracks.map((t) => t.title)).toEqual(['Opening', 'Drift', 'Return', 'Afterglow']);
    expect(tracks.map((t) => t.acodec)).toEqual(expect.arrayContaining(['mp3', 'flac']));
    // Untagged file falls back to folder/file names.
    const wav = q({ text: 'Plain Wave' })[0]!;
    expect(wav).toMatchObject({ title: 'Plain Wave', album: 'Untagged Folder', trackNo: 5 });
    expect(app.repo.artists().items.map((a) => a.name)).toEqual(expect.arrayContaining(['Aurora Quartet', 'Lumen']));
  });

  it('indexes comics (cbz and page folders) and EPUB', () => {
    const comics = q({ kind: 'comic', sort: 'name' });
    const pw = comics.filter((c) => c.series === 'Planet Walker');
    expect(pw.map((c) => c.season)).toEqual([1, 2]);
    expect(pw[0]!.pages).toBe(6);
    const dt = comics.filter((c) => c.series === 'Dungeon Tales');
    expect(dt).toHaveLength(2);
    expect(dt[0]).toMatchObject({ container: 'folder', pages: 6 });
    const book = q({ kind: 'book' })[0]!;
    expect(book).toMatchObject({ title: 'The Quiet Orbit', artist: 'A. Writer', pages: 3, hasArt: true });
  });

  it('supports full-text search with prefixes and facets', () => {
    expect(app.repo.search('aurora').albums.map((a) => a.album)).toContain('Night Signals');
    expect(app.repo.search('sign').media.length).toBeGreaterThan(0);
    expect(app.repo.search('drif').media.map((m) => m.title)).toEqual(expect.arrayContaining(['Neon Drift', 'Drift']));
    expect(app.repo.facets('audio').genres.map((g) => g.name)).toEqual(expect.arrayContaining(['Ambient', 'Electronic']));
    expect(q({ kind: 'video', genre: 'drama' })).toHaveLength(1);
    expect(q({ kind: 'video', resolution: 'fhd' })).toHaveLength(0);
    expect(q({ kind: 'video', resolution: 'hd' }).length).toBeGreaterThan(0);
  });

  it('browses like a file explorer', () => {
    const top = app.repo.browse(null, new Set([rootId]));
    expect(top.folders).toHaveLength(1);
    const root = app.repo.browse(lib, new Set([rootId]));
    expect(root.folders.map((f) => f.name)).toEqual(['Books', 'Manga', 'Movies', 'Music', 'Photos', 'TV']);
    expect(root.crumbs.map((c) => c.name)).toEqual(['Library', 'Test Library']);
    const movies = app.repo.browse(join(lib, 'Movies'), new Set([rootId]));
    expect(movies.items.length).toBeGreaterThan(4);
    expect(movies.folders.map((f) => f.name)).toEqual(['Orbit Study (2021)']);
    expect(movies.crumbs.map((c) => c.name)).toEqual(['Library', 'Test Library', 'Movies']);
    expect(movies.parent).toBe(lib);
  });
});

describe('incremental updates', () => {
  it('quick rescan does no work when nothing changed', async () => {
    const before = app.repo.mediaCount();
    const t0 = Date.now();
    await app.indexer.scanRoot(rootId);
    expect(app.repo.mediaCount()).toBe(before);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('picks up new files in changed directories', async () => {
    copyFileSync(join(lib, 'Movies', 'Neon Drift (2019).mp4'), join(lib, 'Movies', 'Copy Cat (2018).mp4'));
    await app.indexer.scanRoot(rootId);
    expect(q({ text: 'Copy Cat' })).toHaveLength(1);
    expect(q({ text: 'Copy Cat' })[0]!.year).toBe(2018);
  });

  it('keeps favourites and progress when a file is renamed or moved', async () => {
    const item = q({ text: 'Copy Cat' })[0]!;
    app.repo.updateState(item.id, { favorite: true, rating: 4, notes: 'keep me' });
    app.repo.setProgress({ mediaId: item.id, positionSec: 12, progress: 0.4 });
    renameSync(join(lib, 'Movies', 'Copy Cat (2018).mp4'), join(lib, 'Movies', 'Orbit Study (2021)', 'Renamed Cat (2018).mp4'));
    await app.indexer.scanRoot(rootId);
    const after = app.repo.get(item.id)!;
    expect(after.path).toMatch(/Renamed Cat/);
    expect(after).toMatchObject({ favorite: true, rating: 4, notes: 'keep me', positionSec: 12, missing: false });
    expect(q({ text: 'Copy Cat' })).toHaveLength(0);
    expect(q({ text: 'Renamed Cat' })).toHaveLength(1);
  });

  it('marks deleted files missing instead of forgetting them, and revives them', async () => {
    const f = join(lib, 'Photos', 'Trip', 'photo-01.jpg');
    const id = q({ text: 'photo-01' })[0]!.id;
    app.repo.updateState(id, { favorite: true });
    const keep = join(lib, '..', 'photo-01.bak');
    renameSync(f, keep);
    await app.indexer.scanDirs(rootId, [join(lib, 'Photos', 'Trip')]);
    expect(q({ text: 'photo-01' })).toHaveLength(0);
    expect(app.repo.get(id)!.missing).toBe(true);
    renameSync(keep, f);
    await app.indexer.scanDirs(rootId, [join(lib, 'Photos', 'Trip')]);
    expect(app.repo.get(id)).toMatchObject({ missing: false, favorite: true });
  });

  it('handles removed directories and offline roots without losing data', async () => {
    const before = app.repo.mediaCount();
    rmSync(join(lib, 'Manga', 'Dungeon Tales'), { recursive: true });
    await app.indexer.scanRoot(rootId);
    expect(q({ kind: 'comic' })).toHaveLength(2);
    // An unmounted drive looks like a missing root: nothing is marked missing.
    const ghost = app.repo.addRoot(join(tmpdir(), 'definitely-not-mounted'), 'Ghost', 'auto');
    await app.indexer.scanRoot(ghost);
    expect(app.indexer.online.has(ghost)).toBe(false);
    expect(app.repo.mediaCount()).toBeLessThan(before);
    writeFileSync(join(lib, 'Books', 'note.txt'), 'x'); // unsupported types are ignored
    await app.indexer.scanRoot(rootId);
  });
});

describe('artwork', () => {
  it('generates thumbnails for audio, video frames, comics, images and books', async () => {
    const pick = (text: string) => q({ text })[0]!;
    for (const item of [pick('Opening'), pick('Neon Drift'), pick('Orbit Study'), pick('photo-02'), pick('Planet Walker v01'), pick('Quiet Orbit')]) {
      const file = await app.art.get(item.id, 'thumb');
      expect(file, item.title).not.toBeNull();
      expect(file!).toMatch(/\.jpg$/);
    }
    const large = await app.art.get(pick('Opening').id, 'large');
    expect(large).not.toBeNull();
  });
});
