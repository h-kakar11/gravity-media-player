#!/usr/bin/env node
// Regenerates the screenshots in docs/screenshots from the generated sample library:
//   xvfb-run -a node scripts/readme-shots.mjs [sampleDir]      (npm run sample-media first)
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { addLibrary, go, invoke, launchApp } from './e2e-harness.mjs';

const out = resolve('docs/screenshots');
const tmp = resolve('.e2e/shots');
mkdirSync(out, { recursive: true });
mkdirSync(tmp, { recursive: true });
const sample = resolve(process.argv[2] ?? '.e2e/media-src');

const { app, page } = await launchApp({ size: [1440, 900] });
await page.emulateMedia({ colorScheme: 'dark' });
await invoke(page, 'settings:set', { appearance: { theme: 'dark', accent: 'blue' }, audio: { visualizer: true } });
await addLibrary(page, sample);

const save = async (name) => {
  const png = await page.screenshot();
  await sharp(png).jpeg({ quality: 84, mozjpeg: true }).toFile(`${out}/${name}.jpg`);
  console.log('wrote', name);
};
const items = async (kind) => (await invoke(page, 'library:query', { kind, limit: 200 })).items;
const videos = await items('video');
const audio = await items('audio');
const comics = await items('comic');
const books = await items('book');
const find = (list, t) => list.find((m) => m.title.includes(t));

// Synthetic history so Statistics has something to show.
let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
for (let d = 0; d < 60; d++) {
  if (d > 3 && rnd() < 0.22) continue;
  for (let s = 0, n = 1 + Math.floor(rnd() * 3); s < n; s++) {
    const day = new Date(Date.now() - d * 86_400_000);
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), rnd() < 0.7 ? 19 + Math.floor(rnd() * 4) : 9 + Math.floor(rnd() * 8), Math.floor(rnd() * 60)).getTime();
    const r = rnd();
    const pool = r < 0.55 ? videos : r < 0.85 ? audio : [...comics, ...books];
    const item = pool[Math.floor(rnd() * pool.length)];
    const watched = Math.round(item.kind === 'video' ? 900 + rnd() * 5400 : 300 + rnd() * 1800);
    await invoke(page, 'history:record', { mediaId: item.id, startedAt: start, watchedSec: watched, mediaSec: watched, fromSec: 0, toSec: watched, speed: item.kind === 'video' ? [1, 1, 1.25, 1.5][Math.floor(rnd() * 4)] : 1 });
  }
}

// Home
await go(page, { name: 'home' });
await page.waitForTimeout(2500);
await save('home');

// Player with the speed dial
await page.evaluate((i) => window.__playVideo(i, 3), find(videos, 'Neon'));
await page.waitForTimeout(3500);
await page.mouse.move(700, 500);
await page.keyboard.press('s');
await page.waitForTimeout(900);
await save('player');
await page.evaluate(() => window.__videoApi().close());
await page.waitForTimeout(500);

// Music: Now Playing with lyrics, then the equaliser
const album = audio.filter((a) => a.album === 'Night Signals').sort((a, b) => (a.trackNo ?? 0) - (b.trackNo ?? 0));
await page.evaluate((a) => window.__music().playItems(a, 0), album);
await page.waitForTimeout(1500);
await page.evaluate(() => { window.__music().openNowPlaying('lyrics'); });
await page.evaluate(() => window.__music().seek(6));
await page.waitForTimeout(1800);
await save('music');
await invoke(page, 'settings:set', { audio: { eq: { enabled: true, preset: 'Rock', preamp: -3, gains: [4.5, 3.5, 2, -1, -2, -0.5, 2, 3.5, 4.5, 5], limiter: true } } });
await page.evaluate(() => window.__music().setTab('eq'));
await page.waitForTimeout(1200);
await save('equalizer');
await page.evaluate(() => { window.__music().closeNowPlaying(); window.__music().stop(); });
await invoke(page, 'settings:set', { audio: { eq: { enabled: false, preset: 'Flat', preamp: 0, gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], limiter: true } } });

// Manga, two pages, right to left
await invoke(page, 'settings:set', { reader: { mode: 'double', direction: 'rtl', background: 'dark' } });
await page.evaluate((c) => window.__reader().open(c, [c]), find(comics, 'Planet Walker v01'));
await page.waitForSelector('.comic-page');
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(1500);
await page.mouse.move(700, 450);
await page.waitForTimeout(400);
await save('manga');
await page.evaluate(() => window.__reader().close());
await invoke(page, 'settings:set', { reader: { mode: 'single', direction: 'ltr' } });

// EPUB
await page.evaluate((b) => window.__reader().open(b, [b]), books[0]);
await page.waitForSelector('.epub-frame');
await page.waitForTimeout(2500);
await page.mouse.move(700, 450);
await page.waitForTimeout(400);
await save('epub');
await page.evaluate(() => window.__reader().close());

// Statistics and settings
await go(page, { name: 'stats' });
await page.waitForTimeout(1500);
await save('stats');
await go(page, { name: 'settings', pane: 'appearance' });
await page.waitForTimeout(800);
await save('settings');

await app.close();
rmSync(tmp, { recursive: true, force: true });
