// Ad-hoc playback verification: node scripts/visual/play-check.mjs <outDir>
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { addLibrary, invoke, launchApp } from '../e2e-harness.mjs';

const out = resolve(process.argv[2] ?? 'shots');
mkdirSync(out, { recursive: true });
const { app, page, errors } = await launchApp({ size: [1440, 900] });
app.process().stdout?.on('data', (d) => { const s = String(d); if (/WARN|ERROR|Session/.test(s)) console.log('[main]', s.trim()); });
await page.emulateMedia({ colorScheme: 'dark' });
await addLibrary(page, resolve('sample-media'));

const items = (await invoke(page, 'library:query', { kind: 'video' })).items;
const find = (t) => items.find((m) => m.title.includes(t));
const state = () => page.evaluate(() => { const v = document.querySelector('video'); const p = window.__videoState?.(); return { t: v?.currentTime, paused: v?.paused, rs: v?.readyState, w: v?.videoWidth, rate: v?.playbackRate, err: v?.error?.message, ...p }; });

async function play(title, wait = 3500, startSec) {
  const item = find(title);
  await page.evaluate(([it, s]) => window.__playVideo(it, s), [item, startSec]);
  await page.waitForTimeout(wait);
  const s = await state();
  console.log(title, JSON.stringify(s));
  return s;
}

await page.evaluate(() => { document.title = 'x'; });
// Helpers injected by main.tsx test hook
const ok = await page.evaluate(() => typeof window.__playVideo);
console.log('hook', ok);

await play('Neon Drift');
await page.screenshot({ path: `${out}/20-player-direct.png` });
// speed
for (const r of [0.1, 5, 1]) { await page.evaluate((v) => window.__videoApi().setSpeed(v), r); await page.waitForTimeout(700); const s = await state(); console.log('speed', r, s.rate, s.t); }
// seek
await page.evaluate(() => window.__videoApi().seek(18)); await page.waitForTimeout(1500); console.log('seek18', JSON.stringify(await state()));
await play('Hevc');
await page.screenshot({ path: `${out}/21-player-transcode.png` });
await page.evaluate(() => window.__videoApi().seek(8)); await page.waitForTimeout(3500); console.log('transcode seek8', JSON.stringify(await state()));
await play('Orbit Study');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/22-player-orbit.png` });
await page.evaluate(() => window.__videoApi().setAudio(1)); await page.waitForTimeout(3000); console.log('audio2', JSON.stringify(await state()));
await page.mouse.move(700, 500); await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/23-player-controls.png` });
await page.evaluate(() => window.__videoApi().close());
console.log(errors.length ? `Renderer errors:\n${errors.join('\n')}` : 'No renderer errors');
await app.close();
