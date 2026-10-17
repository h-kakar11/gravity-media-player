import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Db } from '../../src/main/db/database';
import { LibraryRepo } from '../../src/main/db/repo';
import { SettingsStore } from '../../src/main/settings-store';
import { Ffmpeg } from '../../src/main/media/ffmpeg';
import { Indexer } from '../../src/main/library/indexer';
import { ArtService } from '../../src/main/library/art';
import type { AppPaths } from '../../src/main/paths';

let cachedSample: string | null = null;

/** Generates the quick sample library once per test run (shared across test files via env var). */
export function sampleLibrary(): string {
  if (cachedSample) return cachedSample;
  if (process.env.GRAVITY_TEST_SAMPLE) return (cachedSample = process.env.GRAVITY_TEST_SAMPLE);
  const dir = join(mkdtempSync(join(tmpdir(), 'gravity-lib-')), 'media');
  execFileSync(process.execPath, [resolve('scripts/make-sample-media.mjs'), dir, '--quick'], { stdio: 'inherit' });
  process.env.GRAVITY_TEST_SAMPLE = dir;
  return (cachedSample = dir);
}

export function makeApp() {
  const base = mkdtempSync(join(tmpdir(), 'gravity-app-'));
  const paths: AppPaths = {
    userData: base, cache: join(base, 'cache'), art: join(base, 'cache', 'art'), artSrc: join(base, 'cache', 'art-src'),
    sprites: join(base, 'cache', 'sprites'), tmp: join(base, 'cache', 'tmp'), db: ':memory:', settings: join(base, 'settings.json'), logs: join(base, 'logs')
  };
  for (const d of [paths.art, paths.artSrc, paths.sprites, paths.tmp]) mkdirSync(d, { recursive: true });
  const settings = new SettingsStore(paths.settings);
  const db = new Db(':memory:');
  const repo = new LibraryRepo(db);
  const ffmpeg = new Ffmpeg(settings);
  const indexer = new Indexer(repo, settings, ffmpeg, paths);
  const art = new ArtService(repo, ffmpeg, paths, settings);
  return { paths, settings, db, repo, ffmpeg, indexer, art, base };
}
