import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** All on-disk locations the app writes to. Everything lives under Electron's userData dir. */
export interface AppPaths {
  userData: string;
  cache: string;
  art: string;
  artSrc: string;
  sprites: string;
  tmp: string;
  db: string;
  settings: string;
  logs: string;
}

let cached: AppPaths | null = null;

export function appPaths(): AppPaths {
  if (cached) return cached;
  const userData = app.getPath('userData');
  const cache = join(userData, 'cache');
  cached = {
    userData,
    cache,
    art: join(cache, 'art'),
    artSrc: join(cache, 'art-src'),
    sprites: join(cache, 'sprites'),
    tmp: join(cache, 'tmp'),
    db: join(userData, 'library.db'),
    settings: join(userData, 'settings.json'),
    logs: join(userData, 'logs')
  };
  for (const dir of [cached.userData, cached.cache, cached.art, cached.artSrc, cached.sprites, cached.tmp, cached.logs]) {
    mkdirSync(dir, { recursive: true });
  }
  return cached;
}
