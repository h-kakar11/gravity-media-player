// Ad-hoc check of window modes: node scripts/visual/modes-check.mjs <outDir>
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { addLibrary, invoke, launchApp } from '../e2e-harness.mjs';

const out = resolve(process.argv[2] ?? 'shots');
mkdirSync(out, { recursive: true });
const { app, page, errors } = await launchApp({ size: [1280, 800] });
await page.emulateMedia({ colorScheme: 'dark' });
await addLibrary(page, resolve('sample-media'));
const winInfo = () => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; const b = w.getBounds(); return { ...b, onTop: w.isAlwaysOnTop(), fs: w.isFullScreen(), resizable: w.isResizable(), opacity: w.getOpacity() }; });
const neon = (await invoke(page, 'library:query', { kind: 'video' })).items.find((m) => m.title.includes('Neon'));
console.log('normal', JSON.stringify(await winInfo()));

await page.evaluate((i) => window.__playVideo(i), neon);
await page.waitForTimeout(2500);
console.log('mini →', JSON.stringify(await invoke(page, 'window:setMode', 'mini')));
await page.waitForTimeout(900);
console.log('mini win', JSON.stringify(await winInfo()));
await page.mouse.move(200, 150); await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/60-mini.png` });
console.log('video state in mini', JSON.stringify(await page.evaluate(() => window.__videoState())));

console.log('overlay →', JSON.stringify(await invoke(page, 'window:setMode', 'overlay')));
await page.waitForTimeout(900);
console.log('overlay win', JSON.stringify(await winInfo()));
await page.mouse.move(200, 150); await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/61-overlay.png` });
await invoke(page, 'window:overlay', { opacity: 0.6 });
await page.waitForTimeout(300);
console.log('overlay opacity', JSON.stringify(await winInfo()));
await invoke(page, 'window:overlay', { opacity: 1 });

console.log('normal →', JSON.stringify(await invoke(page, 'window:setMode', 'normal')));
await page.waitForTimeout(900);
console.log('back to normal', JSON.stringify(await winInfo()));
console.log('video still playing', JSON.stringify(await page.evaluate(() => ({ s: window.__videoState(), paused: document.querySelector('video')?.paused }))));
await page.screenshot({ path: `${out}/62-back-normal.png` });
console.log(errors.length ? `Renderer errors:\n${errors.join('\n')}` : 'No renderer errors');
await app.close();
