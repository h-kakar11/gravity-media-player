import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HealthFinding, HealthReport } from '@shared/health';
import { emptyFields, type MediaFields } from '../../src/main/library/types';
import { defaultFileChecker, HealthScanner, MAX_FINDINGS, type FileChecker } from '../../src/main/health/scan';
import { makeApp } from './helpers';

type App = ReturnType<typeof makeApp>;

let app: App;
let libDir: string;
let rootId: number;
let seq = 0;

const okChecker: FileChecker = async () => ({ ok: true, size: 1, isDir: false });
const scanner = (checkFile: FileChecker = okChecker, now?: () => number) => new HealthScanner(app.db, { checkFile, now });

interface Extra { path?: string; size?: number; durationSec?: number; width?: number; height?: number; vcodec?: string; bitrate?: number; year?: number | null; ino?: string; dev?: string; kind?: MediaFields['kind']; root?: number }

function add(vclass: 'movie' | 'episode' | null, title: string, extra: Extra = {}, fill?: (f: MediaFields) => void): number {
  const n = ++seq;
  const name = `${title}-${n}.mkv`;
  const f = emptyFields({
    rootId: extra.root ?? rootId, path: extra.path ?? join(libDir, name), dir: libDir, fileName: extra.path ? extra.path.split(/[\\/]/).pop()! : name,
    ext: 'mkv', kind: extra.kind ?? 'video', title, size: extra.size ?? 4_000_000_000, mtimeMs: 1
  });
  f.vclass = vclass;
  f.durationSec = extra.durationSec ?? 7200;
  f.width = extra.width ?? 1920;
  f.height = extra.height ?? 1080;
  f.vcodec = extra.vcodec ?? 'h264';
  f.bitrate = extra.bitrate ?? 8_000_000;
  f.year = extra.year === undefined ? null : extra.year;
  f.ino = extra.ino ?? null;
  f.dev = extra.dev ?? null;
  fill?.(f);
  return app.repo.upsertMedia(f).id;
}

const movie = (title: string, year: number | null, extra: Extra = {}) => add('movie', title, { ...extra, year });

function episode(series: string, season: number | null, ep: number, extra: Extra = {}): number {
  return add('episode', `Episode ${ep}`, extra, (f) => { f.series = series; f.season = season; f.episode = ep; });
}

const byKind = (r: HealthReport, kind: HealthFinding['kind']) => r.findings.filter((f) => f.kind === kind);

beforeEach(() => {
  app = makeApp();
  libDir = join(app.base, 'lib');
  mkdirSync(libDir, { recursive: true });
  rootId = app.repo.addRoot(libDir, 'Lib', 'auto');
});

afterEach(() => {
  app.settings.flush();
  app.db.raw.close();
  rmSync(app.base, { recursive: true, force: true });
});

describe('duplicate movies and lower-quality copies', () => {
  it('groups copies by title and year, picks the best and explains the rest', async () => {
    const hd = movie('Blade Runner', 1982, { height: 1080, vcodec: 'hevc', bitrate: 12_000_000, size: 9_000_000_000 });
    const sd = movie('blade runner', 1982, { width: 1280, height: 720, vcodec: 'h264', bitrate: 3_000_000, size: 2_000_000_000 });
    movie('Heat', 1995);

    const r = await scanner().scan();
    const dups = byKind(r, 'duplicate-movie');
    expect(dups).toHaveLength(1);
    const g = dups[0]!;
    expect(g.title).toBe('Blade Runner (1982)');
    expect(g.files.map((f) => f.id)).toEqual([hd, sd]);
    expect(g.files[0]).toMatchObject({ best: true, lower: false, reasons: [] });
    expect(g.files[1]).toMatchObject({ best: false, lower: true });
    expect(g.files[1]!.reasons).toEqual(['Lower resolution (720p vs 1080p)', 'Older codec (H.264 vs HEVC)', 'Lower bitrate (3.0 Mbps vs 12.0 Mbps)']);
    expect(g.reclaimableBytes).toBe(2_000_000_000);
    expect(g.explanation).toMatch(/2 files look like the same movie/);
    expect(g.explanation).toMatch(/1 copy is lower quality/);
    expect(r.summary).toMatchObject({ duplicateGroups: 1, lowerQualityCopies: 1, reclaimableBytes: 2_000_000_000 });
  });

  it('treats identical copies as duplicates but not as lower quality', async () => {
    movie('Alien', 1979, { size: 5_000_000_000 });
    movie('Alien', 1979, { size: 5_000_000_000 });
    const r = await scanner().scan();
    const g = byKind(r, 'duplicate-movie')[0]!;
    expect(g.files.filter((f) => f.lower)).toHaveLength(0);
    expect(g.files[1]!.reasons).toEqual(['Same size and quality as the best copy']);
    expect(r.summary.duplicateGroups).toBe(1);
    expect(r.summary.lowerQualityCopies).toBe(0);
    expect(r.summary.reclaimableBytes).toBe(5_000_000_000);
  });

  it('does not merge different films that share a title', async () => {
    movie('Dune', 1984);
    movie('Dune', 2021);
    expect((await scanner().scan()).findings).toEqual([]);
  });

  it('lets a year-less file join the only year present, but stays out of ambiguous titles', async () => {
    movie('Solaris', 1972);
    const unknown = movie('Solaris', null);
    let r = await scanner().scan();
    expect(byKind(r, 'duplicate-movie')[0]!.files.map((f) => f.id)).toContain(unknown);

    movie('Solaris', 2002);
    r = await scanner().scan();
    // 1972 and 2002 each have one file; the year-less one could be either, so nothing is flagged.
    expect(byKind(r, 'duplicate-movie')).toHaveLength(0);
  });

  it('warns when two year-less files are matched by title alone', async () => {
    movie('Home Movie', null);
    movie('Home Movie', null);
    const g = byKind(await scanner().scan(), 'duplicate-movie')[0]!;
    expect(g.explanation).toMatch(/none of them has a year/);
  });

  it('does not treat multi-part releases as duplicates', async () => {
    movie('Epic', 2001, { path: join(libDir, 'Epic (2001) cd1.avi') });
    movie('Epic', 2001, { path: join(libDir, 'Epic (2001) cd2.avi') });
    expect((await scanner().scan()).findings).toEqual([]);
  });

  it('ignores hard links to one file, and does not count them as reclaimable', async () => {
    movie('Linked', 2010, { ino: '77', dev: '1', path: join(libDir, 'a', 'Linked.mkv') });
    movie('Linked', 2010, { ino: '77', dev: '1', path: join(libDir, 'b', 'Linked.mkv') });
    expect((await scanner().scan()).findings).toEqual([]);

    movie('Linked', 2010, { ino: '88', dev: '1', size: 1_000_000_000, path: join(libDir, 'c', 'Linked.mkv'), bitrate: 1_000_000 });
    const g = byKind(await scanner().scan(), 'duplicate-movie')[0]!;
    expect(g.files).toHaveLength(3);
    expect(g.reclaimableBytes).toBe(1_000_000_000 + 0); // the second hard link is the same bytes as the best copy
  });

  it('leaves out files that are no longer on disk', async () => {
    movie('Ghost', 2000);
    const gone = movie('Ghost', 2000);
    app.repo.markMissing([gone]);
    expect(byKind(await scanner().scan(), 'duplicate-movie')).toHaveLength(0);
  });

  it('ignores clips, music and files with no usable title', async () => {
    add(null, 'Holiday', {});
    add(null, 'Holiday', {});
    add('movie', '...', { year: 2000 });
    add('movie', '...', { year: 2000 });
    add(null, 'Song', { kind: 'audio' });
    add(null, 'Song', { kind: 'audio' });
    expect(byKind(await scanner().scan(), 'duplicate-movie')).toHaveLength(0);
  });
});

describe('duplicate episodes', () => {
  it('groups by show, season and episode regardless of case', async () => {
    episode('The Wire', 1, 3, { height: 1080 });
    episode('the wire', 1, 3, { width: 1280, height: 720 });
    episode('The Wire', 1, 4);
    episode('The Wire', 2, 3);
    const dups = byKind(await scanner().scan(), 'duplicate-episode');
    expect(dups).toHaveLength(1);
    expect(dups[0]!.title).toBe('The Wire · S01E03');
    expect(dups[0]!.files.map((f) => f.quality)).toEqual(['1080p · H.264 · 8.0 Mbps', '720p · H.264 · 8.0 Mbps']);
    expect(dups[0]!.files[1]!.reasons).toEqual(['Lower resolution (720p vs 1080p)']);
  });

  it('treats a missing season as season 1', async () => {
    episode('Loose', null, 1);
    episode('Loose', 1, 1);
    expect(byKind(await scanner().scan(), 'duplicate-episode')).toHaveLength(1);
  });

  it('orders groups by space that could be reclaimed', async () => {
    movie('Small', 2000, { size: 100 }); movie('Small', 2000, { size: 100 });
    movie('Large', 2001, { size: 9_000_000_000 }); movie('Large', 2001, { size: 9_000_000_000 });
    expect(byKind(await scanner().scan(), 'duplicate-movie').map((g) => g.title)).toEqual(['Large (2001)', 'Small (2000)']);
  });
});

describe('missing episodes', () => {
  it('finds gaps in the numbering when there is no online list', async () => {
    for (const n of [1, 2, 4, 5, 8]) episode('Gappy', 1, n);
    const r = await scanner().scan();
    const f = byKind(r, 'missing-episodes')[0]!;
    expect(f.source).toBe('gaps');
    expect(f.missing!.map((m) => m.episode)).toEqual([3, 6, 7]);
    expect(f.title).toBe('Gappy — 3 missing episodes');
    expect(f.explanation).toMatch(/S01E03, S01E06, S01E07/);
    expect(f.files.length).toBeGreaterThan(0); // something to reveal
    expect(r.summary.missingEpisodes).toBe(3);
  });

  it('does not guess at episodes before the first or after the last one you have', async () => {
    for (const n of [3, 4, 5]) episode('Partial', 1, n);
    expect(byKind(await scanner().scan(), 'missing-episodes')).toHaveLength(0);
  });

  it('ignores specials and implausibly large jumps', async () => {
    episode('Odd', 0, 1); episode('Odd', 0, 9);
    episode('Odd', 1, 1); episode('Odd', 1, 500);
    expect(byKind(await scanner().scan(), 'missing-episodes')).toHaveLength(0);
  });

  it('does not count episodes whose files are gone', async () => {
    episode('Vanishing', 1, 1);
    const two = episode('Vanishing', 1, 2);
    episode('Vanishing', 1, 3);
    app.repo.markMissing([two]);
    const f = byKind(await scanner().scan(), 'missing-episodes')[0]!;
    expect(f.missing!.map((m) => m.episode)).toEqual([2]);
  });

  describe('with synced online episode lists', () => {
    // The table belongs to the episode-metadata feature; the scanner must work with or without it, so
    // create it only when this branch's schema does not already have it (it does once 01 is merged).
    beforeEach(() => {
      app.db.raw.exec(`CREATE TABLE IF NOT EXISTS meta_episode (
        series_key TEXT NOT NULL, season INTEGER NOT NULL, episode INTEGER NOT NULL, provider TEXT NOT NULL, ext_id TEXT NOT NULL,
        title TEXT, plot TEXT, air_date TEXT, fetched_at INTEGER NOT NULL, PRIMARY KEY (series_key, season, episode)) WITHOUT ROWID`);
    });
    const syncEp = (key: string, season: number, ep: number, title: string | null, airDate: string | null) =>
      app.db.run('INSERT INTO meta_episode (series_key, season, episode, provider, ext_id, title, air_date, fetched_at) VALUES (?,?,?,?,?,?,?,?)', [key, season, ep, 'tmdb', '1', title, airDate, 1]);

    it('uses the official list, including trailing episodes, and names them', async () => {
      episode('Show', 1, 1); episode('Show', 1, 2);
      for (let n = 1; n <= 4; n++) syncEp('show', 1, n, `Title ${n}`, '2020-01-01');
      const f = byKind(await scanner().scan(), 'missing-episodes')[0]!;
      expect(f.source).toBe('metadata');
      expect(f.severity).toBe('warning');
      expect(f.missing).toEqual([{ season: 1, episode: 3, title: 'Title 3' }, { season: 1, episode: 4, title: 'Title 4' }]);
      expect(f.explanation).toMatch(/online/);
    });

    it('ignores episodes that have not aired yet', async () => {
      const now = () => Date.parse('2024-06-15T12:00:00Z');
      episode('Show', 1, 1);
      syncEp('show', 1, 1, 'One', '2024-01-01');
      syncEp('show', 1, 2, 'Two', '2024-06-15');
      syncEp('show', 1, 3, 'Three', '2024-06-16');
      syncEp('show', 1, 4, 'Four', null);
      const f = byKind(await scanner(okChecker, now).scan(), 'missing-episodes')[0]!;
      expect(f.missing!.map((m) => m.episode)).toEqual([2, 4]);
    });

    it('falls back to numbering gaps for seasons the online list does not cover', async () => {
      episode('Show', 1, 1); episode('Show', 1, 2);
      episode('Show', 2, 1); episode('Show', 2, 3);
      syncEp('show', 1, 1, null, null); syncEp('show', 1, 2, null, null);
      const f = byKind(await scanner().scan(), 'missing-episodes')[0]!;
      expect(f.missing).toEqual([{ season: 2, episode: 2, title: null }]);
      expect(f.source).toBe('gaps');
    });

    it('reports nothing when the library already has everything', async () => {
      episode('Show', 1, 1); episode('Show', 1, 2);
      syncEp('show', 1, 1, null, null); syncEp('show', 1, 2, null, null);
      expect(byKind(await scanner().scan(), 'missing-episodes')).toHaveLength(0);
    });

    it('survives a table with an unexpected shape', async () => {
      app.db.raw.exec('DROP TABLE meta_episode; CREATE TABLE meta_episode (series_key TEXT)');
      for (const n of [1, 3]) episode('Shape', 1, n);
      const f = byKind(await scanner().scan(), 'missing-episodes')[0]!;
      expect(f.source).toBe('gaps');
      expect(f.missing!.map((m) => m.episode)).toEqual([2]);
    });
  });
});

describe('problem files', () => {
  it('flags empty, unreadable, vanished and damaged files with an explanation each', async () => {
    const empty = add('movie', 'Empty', { size: 0, durationSec: 0 });
    const locked = add('movie', 'Locked', { year: 2001 });
    const vanished = add('movie', 'Vanished', { year: 2002 });
    const damaged = add('movie', 'Damaged', { year: 2003, durationSec: 0 });
    const fine = add('movie', 'Fine', { year: 2004 });
    const song = add(null, 'Song', { kind: 'audio', durationSec: 0, width: 0, height: 0 });
    const paths = new Map(app.db.all<{ id: number; path: string }>('SELECT id, path FROM media').map((r) => [r.path, r.id]));

    const checker: FileChecker = async (p) => {
      const id = paths.get(p);
      if (id === empty) return { ok: true, size: 0, isDir: false };
      if (id === locked) return { ok: false, code: 'unreadable', detail: 'EACCES' };
      if (id === vanished) return { ok: false, code: 'missing', detail: 'ENOENT' };
      return { ok: true, size: 123, isDir: false };
    };
    const r = await scanner(checker).scan();
    const kinds = new Map(r.findings.filter((f) => f.category === 'files').map((f) => [f.files[0]!.id, f]));

    expect(kinds.get(empty)).toMatchObject({ kind: 'zero-length', severity: 'error' });
    expect(kinds.get(locked)).toMatchObject({ kind: 'unreadable', severity: 'error' });
    expect(kinds.get(locked)!.explanation).toMatch(/EACCES/);
    expect(kinds.get(vanished)).toMatchObject({ kind: 'file-missing', severity: 'warning' });
    expect(kinds.get(vanished)!.files[0]!.exists).toBe(false);
    expect(kinds.get(damaged)).toMatchObject({ kind: 'no-duration', severity: 'warning' });
    expect(kinds.get(song)).toMatchObject({ kind: 'no-duration' });
    expect(kinds.has(fine)).toBe(false);
    expect(r.summary.problemFiles).toBe(5);
    expect(r.summary.filesChecked).toBe(6);
    // Errors are listed before warnings.
    const sev = r.findings.filter((f) => f.category === 'files').map((f) => f.severity);
    expect(sev).toEqual([...sev].sort((a, b) => ['error', 'warning', 'info'].indexOf(a) - ['error', 'warning', 'info'].indexOf(b)));
  });

  it('reports a file only once, under its most serious problem', async () => {
    add('movie', 'Both', { size: 0, durationSec: 0 });
    const r = await scanner(async () => ({ ok: true, size: 0, isDir: false })).scan();
    expect(r.findings.filter((f) => f.category === 'files')).toHaveLength(1);
    expect(r.findings[0]!.kind).toBe('zero-length');
  });

  it('does not call a comic folder empty', async () => {
    add(null, 'Comic', { kind: 'comic', size: 5000, durationSec: 0, width: 0, height: 0 });
    const r = await scanner(async () => ({ ok: true, size: 0, isDir: true })).scan();
    expect(r.findings).toEqual([]);
  });

  it('does not require duration for images and books', async () => {
    add(null, 'Photo', { kind: 'image', durationSec: 0 });
    add(null, 'Book', { kind: 'book', durationSec: 0 });
    expect((await scanner().scan()).findings).toEqual([]);
  });

  it('reports files the library already knows are missing', async () => {
    const id = add('movie', 'Moved', { year: 2000 });
    app.repo.markMissing([id]);
    const r = await scanner().scan();
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ kind: 'file-missing', id: `file-missing:${id}` });
  });

  describe('against real files', () => {
    it('finds an empty file, a vanished file and a healthy one, and never changes them', async () => {
      const healthy = join(libDir, 'healthy.mkv'), empty = join(libDir, 'empty.mkv'), gone = join(libDir, 'gone.mkv');
      writeFileSync(healthy, Buffer.alloc(4096, 1));
      writeFileSync(empty, '');
      const a = add('movie', 'Healthy', { path: healthy, size: 4096, year: 2001 });
      const b = add('movie', 'Empty', { path: empty, size: 4096, year: 2002 }); // the database is stale: size changed since the scan
      const c = add('movie', 'Gone', { path: gone, year: 2003 });

      const r = await new HealthScanner(app.db, { checkFile: defaultFileChecker }).scan();
      const byId = new Map(r.findings.map((f) => [f.files[0]!.id, f.kind]));
      expect(byId.get(b)).toBe('zero-length');
      expect(byId.get(c)).toBe('file-missing');
      expect(byId.has(a)).toBe(false);
      expect(r.summary.filesChecked).toBe(3);
    });

    it('treats a directory (comic folder) as present', async () => {
      const dir = join(libDir, 'Some Comic');
      mkdirSync(dir);
      const id = add(null, 'Some Comic', { kind: 'comic', path: dir, size: 10, durationSec: 0 });
      const r = await new HealthScanner(app.db, { checkFile: defaultFileChecker }).scan();
      expect(r.findings.filter((f) => f.files[0]?.id === id)).toEqual([]);
    });

    it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('reports a file without read permission as unreadable', async () => {
      const p = join(libDir, 'locked.mkv');
      writeFileSync(p, Buffer.alloc(64));
      chmodSync(p, 0o000);
      try {
        const id = add('movie', 'Locked', { path: p, size: 64, year: 2000 });
        const r = await new HealthScanner(app.db, { checkFile: defaultFileChecker }).scan();
        expect(r.findings.find((f) => f.files[0]?.id === id)).toMatchObject({ kind: 'unreadable' });
      } finally { chmodSync(p, 0o644); }
    });
  });
});

describe('partial failures and limits', () => {
  it('skips files in an offline folder and says so, instead of calling them all unreadable', async () => {
    const offline = app.repo.addRoot(join(app.base, 'does-not-exist'), 'Backup Drive', 'auto');
    movie('Away', 2000, { root: offline, path: join(app.base, 'does-not-exist', 'a.mkv') });
    movie('Away', 2000, { root: offline, path: join(app.base, 'does-not-exist', 'b.mkv') });
    const idOnline = movie('Home', 2001);
    let checked: string[] = [];
    const r = await scanner(async (p) => { checked.push(p); return { ok: true, size: 1, isDir: false }; }).scan();
    expect(r.findings).toEqual([]);
    expect(r.warnings).toEqual(['“Backup Drive” is offline, so its 2 files were not checked on disk.']);
    expect(checked).toHaveLength(1);
    expect(r.summary.filesChecked).toBe(1);
    expect(idOnline).toBeGreaterThan(0);
  });

  it('can run from the database alone', async () => {
    let calls = 0;
    const checker: FileChecker = async () => { calls++; return { ok: true, size: 1, isDir: false }; };
    movie('Same', 2000); movie('Same', 2000);
    add('movie', 'Empty', { size: 0, durationSec: 0, year: 1999 });
    const r = await scanner(checker).scan({ checkFiles: false });
    expect(calls).toBe(0);
    expect(r.summary).toMatchObject({ duplicateGroups: 1, problemFiles: 1, filesChecked: 0 });
  });

  it('caps each category and tells the user', async () => {
    app.db.tx(() => { for (let i = 0; i < MAX_FINDINGS + 5; i++) add('movie', `Empty ${i}`, { size: 0, durationSec: 0, year: 2000 }); });
    const r = await scanner().scan({ checkFiles: false });
    expect(r.truncated).toBe(true);
    expect(r.summary.problemFiles).toBe(MAX_FINDINGS);
    expect(r.warnings.some((w) => w.includes(String(MAX_FINDINGS)))).toBe(true);
  });

  it('shares one scan between simultaneous requests', async () => {
    movie('Twice', 2000);
    let calls = 0;
    const s = scanner(async () => { calls++; await new Promise((res) => setTimeout(res, 10)); return { ok: true, size: 1, isDir: false }; });
    const [x, y] = await Promise.all([s.scan(), s.scan()]);
    expect(x).toBe(y);
    expect(calls).toBe(1);
    await s.scan();
    expect(calls).toBe(2); // a later request scans again
  });

  it('copes with an empty library', async () => {
    const r = await scanner().scan();
    expect(r.findings).toEqual([]);
    expect(r.summary).toEqual({ duplicateGroups: 0, lowerQualityCopies: 0, reclaimableBytes: 0, missingEpisodes: 0, problemFiles: 0, filesChecked: 0 });
    expect(r.truncated).toBe(false);
  });

  it('turns a checker that throws into an unreadable file rather than failing the scan', async () => {
    // The default checker maps every error itself; this guards the scanner against one that does not.
    const odd = add('movie', 'Odd', { year: 2000 });
    add('movie', 'Fine', { year: 2001 });
    const paths = new Map(app.db.all<{ id: number; path: string }>('SELECT id, path FROM media').map((r) => [r.id, r.path]));
    const flaky: FileChecker = async (p) => { if (p === paths.get(odd)) throw new Error('device not ready'); return { ok: true, size: 1, isDir: false }; };
    const r = await scanner(flaky).scan();
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ kind: 'unreadable' });
    expect(r.findings[0]!.explanation).toMatch(/device not ready/);
    expect(r.summary.filesChecked).toBe(2);
  });

  it('survives a database failure and still serves the next request', async () => {
    const s = scanner();
    const real = app.db.all.bind(app.db);
    let fail = true;
    (app.db as { all: unknown }).all = (sql: string, params?: unknown[]) => { if (fail) throw new Error('database is locked'); return real(sql, params as never); };
    await expect(s.scan()).rejects.toThrow('database is locked');
    fail = false;
    await expect(s.scan()).resolves.toMatchObject({ findings: [] });
  });
});

describe('read-only guarantee', () => {
  it('leaves the database exactly as it found it', async () => {
    movie('Same', 2000); movie('Same', 2000);
    for (const n of [1, 3]) episode('Gappy', 1, n);
    add('movie', 'Empty', { size: 0, durationSec: 0, year: 1999 });
    const snapshot = () => JSON.stringify([
      app.db.all('SELECT * FROM media ORDER BY id'), app.db.all('SELECT * FROM state ORDER BY media_id'),
      app.db.all('SELECT * FROM roots ORDER BY id'), app.db.all("SELECT name, sql FROM sqlite_master ORDER BY name")
    ]);
    const before = snapshot();
    await scanner().scan();
    await scanner().scan({ checkFiles: false });
    expect(snapshot()).toBe(before);
  });

  it('finding ids are stable between scans of an unchanged library', async () => {
    movie('Same', 2000); movie('Same', 2000);
    for (const n of [1, 3]) episode('Gappy', 1, n);
    const a = (await scanner().scan()).findings.map((f) => f.id);
    const b = (await scanner().scan()).findings.map((f) => f.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });
});
