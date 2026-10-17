// Smoke test of a packaged build (npm run pack): node scripts/packed-check.mjs [path/to/executable] [sample media dir]
// Confirms the renderer boots, ffmpeg is found and the native modules (sharp, @parcel/watcher) load from app.asar.unpacked.
import { _electron as electron } from 'playwright-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const dataDir = mkdtempSync(join(tmpdir(), 'gravity-packed-'));
const app = await electron.launch({
  executablePath: process.argv[2] ?? 'release/linux-unpacked/gravity-media-player',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  env: { ...process.env, GRAVITY_TEST: '1', GRAVITY_USER_DATA: dataDir, ...(process.env.NO_SYSTEM_FFMPEG ? { PATH: '/nonexistent' } : {}) },
  timeout: 60000
});
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.waitForSelector('.app', { timeout: 30000 });
const info = await page.evaluate(() => window.gravity.invoke('app:info'));
console.log('version', info.version, 'ffmpeg', info.ffmpeg.source, info.ffmpeg.version, 'hw', info.ffmpeg.hwaccels.join(','));
await page.evaluate(([p]) => window.gravity.invoke('roots:add', p, 'auto'), [resolve(process.argv[3] ?? '.e2e/media-src')]);
await page.waitForTimeout(6000);
const roots = await page.evaluate(() => window.gravity.invoke('roots:list'));
console.log('items', roots[0]?.itemCount);
// sharp artwork + watcher are native modules: make sure they load from app.asar.unpacked
const q = await page.evaluate(() => window.gravity.invoke('library:query', { kind: 'audio' }));
console.log('audio with art', q.items.filter((m) => m.hasArt).length, '/', q.items.length);

console.log(errors.length ? 'errors: ' + errors.join('\n') : 'no renderer errors');
await app.close();
