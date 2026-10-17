// Ad-hoc music verification: node scripts/music-check.mjs <outDir>
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { addLibrary, invoke, launchApp } from './e2e-harness.mjs';

const out = resolve(process.argv[2] ?? 'shots');
mkdirSync(out, { recursive: true });
const { app, page, errors } = await launchApp({ size: [1440, 900] });
app.process().stdout?.on('data', (d) => { const s = String(d); if (/WARN|ERROR/.test(s)) console.log('[main]', s.trim()); });
await page.emulateMedia({ colorScheme: 'dark' });
await addLibrary(page, resolve('sample-media'));
const songs = (await invoke(page, 'library:query', { kind: 'audio', sort: 'track' })).items;
console.log('songs', songs.map((s) => `${s.title}:${s.acodec}`).join(', '));
const st = () => page.evaluate(() => { const m = window.__music(); const g = window.__audioGraph(); return { playing: m.playing, idx: m.index, time: +m.time.toFixed(2), dur: +m.duration.toFixed(1), loading: m.loading, err: m.error, ctx: g.state, gt: +g.time.toFixed(2), n: m.queue.length }; });

const night = songs.filter((s) => s.album === 'Night Signals');
await page.evaluate((items) => window.__music().playItems(items, 0), night);
await page.waitForTimeout(2500);
console.log('playing mp3', JSON.stringify(await st()));
await page.screenshot({ path: `${out}/30-musicbar.png` });
await page.evaluate(() => window.__music().next()); await page.waitForTimeout(2500);
console.log('next (flac)', JSON.stringify(await st()));
await page.evaluate(() => window.__music().next()); await page.waitForTimeout(2500);
console.log('next (m4a)', JSON.stringify(await st()));
await page.evaluate(() => window.__music().seek(10)); await page.waitForTimeout(1200);
console.log('seek10', JSON.stringify(await st()));
// speed of audio-graph: enable EQ, check no error
await page.evaluate(() => window.__music().openNowPlaying('art')); await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/31-nowplaying.png` });
await page.evaluate(() => window.__music().setTab('lyrics'));
await page.evaluate(() => window.__music().playIndex(0)); await page.waitForTimeout(3500);
await page.screenshot({ path: `${out}/32-lyrics.png` });
await page.evaluate(() => window.__music().setTab('queue')); await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/33-queue.png` });
await invoke(page, 'settings:set', { audio: { eq: { enabled: true, preset: 'Rock', preamp: -3, gains: [4.5, 3.5, 2, -1, -2, -0.5, 2, 3.5, 4.5, 5], limiter: true } } });
await page.evaluate(() => window.__music().setTab('eq')); await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/34-eq.png` });
// opus + wav + ogg direct, converting path for formats Chromium lacks is covered by flac/opus here
const others = songs.filter((s) => s.album !== 'Night Signals');
for (const o of others) { await page.evaluate((i) => window.__music().playItems([i], 0), o); await page.waitForTimeout(1800); console.log(o.title, o.acodec, JSON.stringify(await st())); }
console.log(errors.length ? `Renderer errors:\n${errors.join('\n')}` : 'No renderer errors');
await app.close();
