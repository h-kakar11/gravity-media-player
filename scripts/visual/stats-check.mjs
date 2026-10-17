// Seeds synthetic history and screenshots the Statistics view: node scripts/visual/stats-check.mjs <outDir> [light|dark]
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { addLibrary, go, invoke, launchApp } from '../e2e-harness.mjs';

const out = resolve(process.argv[2] ?? 'shots');
const scheme = process.argv[3] ?? 'dark';
mkdirSync(out, { recursive: true });
const { app, page, errors } = await launchApp({ size: [1440, 1100] });
await page.emulateMedia({ colorScheme: scheme });
await addLibrary(page, resolve('sample-media'));

const all = (await invoke(page, 'library:query', {})).items;
const videos = all.filter((m) => m.kind === 'video');
const tracks = all.filter((m) => m.kind === 'audio');
const books = all.filter((m) => m.kind === 'book' || m.kind === 'comic');
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const now = Date.now();
let n = 0;
for (let d = 0; d < 75; d++) {
  if (rnd() < 0.25 && d > 3) continue; // some quiet days; keep the last few days active for a streak
  const day = new Date(now - d * 86_400_000);
  const sessions = 1 + Math.floor(rnd() * 3);
  for (let s = 0; s < sessions; s++) {
    const hour = rnd() < 0.7 ? 19 + Math.floor(rnd() * 4) : 9 + Math.floor(rnd() * 8);
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, Math.floor(rnd() * 60)).getTime();
    const r = rnd();
    const pool = r < 0.55 ? videos : r < 0.85 ? tracks : books;
    const item = pool[Math.floor(rnd() * pool.length)];
    if (!item) continue;
    const watched = item.kind === 'video' ? 900 + rnd() * 5400 : item.kind === 'audio' ? 180 + rnd() * 1800 : 300 + rnd() * 1800;
    await invoke(page, 'history:record', { mediaId: item.id, startedAt: start, watchedSec: Math.round(watched), mediaSec: Math.round(watched * (item.kind === 'video' ? 1.25 : 1)), fromSec: 0, toSec: Math.round(watched), speed: item.kind === 'video' ? [1, 1, 1.25, 1.5][Math.floor(rnd() * 4)] : 1 });
    n++;
  }
}
console.log('recorded sessions', n);
for (const range of ['30', '7', 'all']) {
  await go(page, { name: 'stats' });
  await page.waitForTimeout(700);
  if (range !== '30') await page.click(`.seg [aria-label="${{ '7': 'Week', all: 'All' }[range]}"]`);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/st-${scheme}-${range}.png`, fullPage: false });
  if (range === '30') {
    // Hover a bar to check the tooltip.
    const bar = (await page.$$('.stats-chart .chart__bar'))[20];
    await bar?.hover({ force: true }); await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/st-${scheme}-hover.png` });
    await page.evaluate(() => document.querySelector('.content, main')?.scrollTo?.(0, 99999));
    await page.mouse.wheel(0, 2000); await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/st-${scheme}-lower.png` });
  }
}
console.log(errors.length ? `Renderer errors:\n${errors.join('\n')}` : 'No renderer errors');
await app.close();
