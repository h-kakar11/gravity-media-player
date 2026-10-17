import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings';
import { subtitleSidecarName } from '@shared/subtitle-search';
import { Db } from '../../src/main/db/database';
import type { LibraryRepo } from '../../src/main/db/repo';
import { redactSecrets, restoreSecrets } from '../../src/main/secrets';
import { movieHash } from '../../src/main/subtitles/moviehash';
import { SubtitleService } from '../../src/main/subtitles/opensubtitles';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const SRT = '1\n00:00:01,000 --> 00:00:03,000\nHello there\n\n2\n00:00:04,000 --> 00:00:06,000\nGeneral Kenobi\n';

function setup(opts: { episode?: boolean; user?: boolean; enabled?: boolean; key?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gravity-subs-'));
  const video = join(dir, 'Show - S01E02.mkv');
  writeFileSync(video, Buffer.alloc(300_000, 7));
  const row = opts.episode === false
    ? { path: video, kind: 'video', title: 'The Movie', year: 1999, series: null, season: null, episode: null }
    : { path: video, kind: 'video', title: 'Pilot', year: null, series: 'Show', season: 1, episode: 2 };
  const repo = { getRow: () => row } as unknown as LibraryRepo;
  const settings: Settings = structuredClone(DEFAULT_SETTINGS);
  settings.metadata.openSubtitles = opts.enabled ?? true;
  settings.metadata.openSubtitlesKey = opts.key ?? 'SECRETKEY';
  if (opts.user) { settings.metadata.openSubtitlesUser = 'me'; settings.metadata.openSubtitlesPass = 'hunter2'; }
  const db = new Db(':memory:');
  return { dir, video, db, repo, settings };
}

describe('movieHash', () => {
  it('is the file size for an all-zero file, and null under 128 KiB', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gravity-hash-'));
    const big = join(dir, 'big.bin');
    writeFileSync(big, Buffer.alloc(200_000));
    expect(await movieHash(big)).toBe((200_000).toString(16).padStart(16, '0'));
    const small = join(dir, 'small.bin');
    writeFileSync(small, Buffer.alloc(1000));
    expect(await movieHash(small)).toBeNull();
  });

  it('adds the 64-bit words of the first and last 64 KiB', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gravity-hash-'));
    const f = join(dir, 'x.bin');
    const b = Buffer.alloc(131_072 + 8);
    b.writeBigUInt64LE(5n, 0);
    b.writeBigUInt64LE(9n, b.length - 8);
    writeFileSync(f, b);
    expect(await movieHash(f)).toBe((BigInt(b.length) + 14n).toString(16).padStart(16, '0'));
  });
});

describe('SubtitleService', () => {
  it('refuses to run until the user opts in and adds a key', async () => {
    const a = setup({ enabled: false });
    const off = new SubtitleService(a.db, a.repo, { get: () => a.settings }, { cache: a.dir }, vi.fn());
    await expect(off.search({ mediaId: 1, languages: ['en'] })).rejects.toThrow(/off/);
    const b = setup({ key: '' });
    const nokey = new SubtitleService(b.db, b.repo, { get: () => b.settings }, { cache: b.dir }, vi.fn());
    await expect(nokey.search({ mediaId: 1, languages: ['en'] })).rejects.toThrow(/API key/);
  });

  it('searches by hash, season and episode, sorts exact matches first and never caches the key', async () => {
    const t = setup();
    const fetchFn = vi.fn(async () => json({
      data: [
        { attributes: { language: 'en', download_count: 900, release: 'Popular', files: [{ file_id: 1 }] } },
        { attributes: { language: 'en', download_count: 5, release: 'Exact', moviehash_match: true, hearing_impaired: true, files: [{ file_id: 2 }] } },
        { attributes: { language: 'en', files: [] } }
      ]
    }));
    const svc = new SubtitleService(t.db, t.repo, { get: () => t.settings }, { cache: t.dir }, fetchFn, () => 1_000);
    const r = await svc.search({ mediaId: 1, languages: ['EN', 'bogus language!', 'fr'] });
    expect(r.hits.map((h) => h.fileId)).toEqual([2, 1]);
    expect(r.hits[0]).toMatchObject({ hashMatch: true, hearingImpaired: true });
    expect(r.hashed).toBe(true);

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const q = new URL(url).searchParams;
    expect(q.get('season_number')).toBe('1');
    expect(q.get('episode_number')).toBe('2');
    expect(q.get('type')).toBe('episode');
    expect(q.get('query')).toBe('show');
    expect(q.get('languages')).toBe('en,fr');
    expect(q.get('moviehash')).toMatch(/^[0-9a-f]{16}$/);
    expect((init.headers as Record<string, string>)['Api-Key']).toBe('SECRETKEY');
    expect(JSON.stringify(t.db.all('SELECT * FROM meta_cache'))).not.toContain('SECRETKEY');
    expect(t.db.all<{ key: string }>('SELECT key FROM meta_cache')[0]!.key.startsWith('opensubtitles:')).toBe(true);

    await svc.search({ mediaId: 1, languages: ['en', 'fr'] });
    expect(fetchFn).toHaveBeenCalledTimes(1); // second identical search is served from the cache
  });

  it('searches movies by title and year', async () => {
    const t = setup({ episode: false });
    const fetchFn = vi.fn(async () => json({ data: [] }));
    const svc = new SubtitleService(t.db, t.repo, { get: () => t.settings }, { cache: t.dir }, fetchFn);
    await svc.search({ mediaId: 1, languages: ['en'], query: '  The Matrix ' });
    const q = new URL((fetchFn.mock.calls[0] as unknown as [string])[0]).searchParams;
    expect(q.get('type')).toBe('movie');
    expect(q.get('year')).toBe('1999');
    expect(q.get('query')).toBe('the matrix');
    expect(q.has('season_number')).toBe(false);
  });

  it('turns HTTP failures into readable messages without the key', async () => {
    const t = setup();
    const svc = new SubtitleService(t.db, t.repo, { get: () => t.settings }, { cache: t.dir }, async () => json({}, 429));
    await expect(svc.search({ mediaId: 1, languages: ['en'] })).rejects.toThrow(/rate limit/i);
    const bad = new SubtitleService(t.db, t.repo, { get: () => t.settings }, { cache: t.dir }, async () => json({}, 401));
    const err = await bad.search({ mediaId: 2, languages: ['en'] }).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/rejected/);
    expect((err as Error).message).not.toContain('SECRETKEY');
  });

  it('logs in, downloads, re-encodes to UTF-8 and writes a sidecar next to the video', async () => {
    const t = setup({ user: true });
    const calls: string[] = [];
    const latin1 = Buffer.from(SRT.replace('General Kenobi', 'Café Señor'), 'latin1');
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/login')) return json({ token: 'jwt', base_url: 'api.opensubtitles.com' });
      if (url.endsWith('/download')) {
        expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
        return json({ link: 'https://dl.opensubtitles.com/file.srt', remaining: 17 });
      }
      return new Response(latin1);
    });
    const svc = new SubtitleService(t.db, t.repo, { get: () => t.settings }, { cache: t.dir }, fetchFn as never);
    const r = await svc.download(1, 42, 'es', false);
    expect(r.where).toBe('sidecar');
    expect(r.remaining).toBe(17);
    expect(r.path).toBe(join(t.dir, 'Show - S01E02.es.srt'));
    expect(r.trackId).toBe(`ext:${r.path}`);
    expect(readFileSync(r.path, 'utf8')).toContain('Café Señor');

    // Same content again reuses the file; different content gets a numbered name instead of overwriting.
    expect((await svc.download(1, 42, 'es', false)).path).toBe(r.path);
    writeFileSync(r.path, 'edited by the user');
    const second = await svc.download(1, 42, 'es', false);
    expect(second.path).toBe(join(t.dir, 'Show - S01E02.es.2.srt'));
    expect(readFileSync(r.path, 'utf8')).toBe('edited by the user');
    expect(calls.filter((c) => c.endsWith('/login')).length).toBe(1); // token reused
  });

  it('rejects non-subtitle payloads and non-https links', async () => {
    const t = setup();
    const mk = (link: string, body: string) => new SubtitleService(t.db, t.repo, { get: () => t.settings }, { cache: t.dir }, (async (url: string) =>
      url.endsWith('/download') ? json({ link }) : new Response(body)) as never);
    await expect(mk('https://dl.example/x', '<html>not a subtitle</html>').download(1, 1, 'en', false)).rejects.toThrow(/usable subtitle/);
    await expect(mk('http://dl.example/x', SRT).download(1, 1, 'en', false)).rejects.toThrow(/download link/);
    expect(readdirSync(t.dir).filter((f) => f.endsWith('.srt'))).toEqual([]);
  });

  it('asks for a login when the service wants one', async () => {
    const t = setup();
    const svc = new SubtitleService(t.db, t.repo, { get: () => t.settings }, { cache: t.dir }, async () => json({}, 401));
    await expect(svc.download(1, 1, 'en', false)).rejects.toThrow(/username and password/);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('falls back to the cache folder when the video folder is read-only', async () => {
    const t = setup();
    chmodSync(t.dir, 0o555);
    const svc = new SubtitleService(t.db, t.repo, { get: () => t.settings }, { cache: join(tmpdir(), 'gravity-cache-' + Date.now()) }, (async (url: string) =>
      url.endsWith('/download') ? json({ link: 'https://dl.example/x' }) : new Response(SRT)) as never);
    const r = await svc.download(5, 1, 'en', false);
    chmodSync(t.dir, 0o755);
    expect(r.where).toBe('cache');
    expect(r.path).toContain(join('subtitles', '5'));
    expect(existsSync(r.path)).toBe(true);
  });
});

describe('sidecar names', () => {
  it('builds language, SDH and numbered names', () => {
    expect(subtitleSidecarName('Movie', 'en', false)).toBe('Movie.en.srt');
    expect(subtitleSidecarName('Movie', 'pt-BR', true, 2)).toBe('Movie.pt-br.sdh.2.srt');
    expect(subtitleSidecarName('Movie', '../x', false)).toBe('Movie.und.srt');
  });
});

describe('credentials in settings files', () => {
  it('blanks every credential on export and keeps the local ones on import', () => {
    const local: Settings = structuredClone(DEFAULT_SETTINGS);
    Object.assign(local.metadata, { tmdbKey: 'T', openSubtitlesKey: 'K', openSubtitlesUser: 'U', openSubtitlesPass: 'P' });
    const out = redactSecrets(local);
    expect(out.metadata).toMatchObject({ tmdbKey: '', openSubtitlesKey: '', openSubtitlesUser: '', openSubtitlesPass: '' });
    expect(local.metadata.openSubtitlesPass).toBe('P'); // original untouched
    expect(JSON.stringify(out)).not.toMatch(/"(T|K|U|P)"/);

    const hostile = structuredClone(DEFAULT_SETTINGS);
    Object.assign(hostile.metadata, { tmdbKey: 'evil', openSubtitlesKey: 'evil', openSubtitlesUser: 'evil', openSubtitlesPass: 'evil' });
    const merged = restoreSecrets(hostile, local);
    expect(merged.metadata).toMatchObject({ tmdbKey: 'T', openSubtitlesKey: 'K', openSubtitlesUser: 'U', openSubtitlesPass: 'P' });
  });
});
