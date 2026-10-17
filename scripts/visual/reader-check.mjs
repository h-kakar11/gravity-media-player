// Ad-hoc reader verification: node scripts/visual/reader-check.mjs <outDir>
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { addLibrary, invoke, launchApp } from '../e2e-harness.mjs';

const out = resolve(process.argv[2] ?? 'shots');
mkdirSync(out, { recursive: true });
const { app, page, errors } = await launchApp({ size: [1440, 900] });
await page.emulateMedia({ colorScheme: 'dark' });
await addLibrary(page, resolve('sample-media'));

const all = async (kind) => (await invoke(page, 'library:query', { kind })).items;
const comics = await all('comic');
const books = await all('book');
const images = await all('image');
console.log('comics', comics.map((c) => c.title), 'books', books.map((c) => c.title), 'images', images.length);

const open = (item, ctx) => page.evaluate(([i, c]) => window.__reader().open(i, c), [item, ctx ?? [item]]);
const close = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(300); };

// Comic: CBZ
const cbz = comics.find((c) => c.ext === 'cbz') ?? comics[0];
await open(cbz);
await page.waitForSelector('.comic-page', { timeout: 15000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/40-comic-single.png` });
await page.keyboard.press('ArrowRight'); await page.waitForTimeout(500);
await page.keyboard.press('ArrowRight'); await page.waitForTimeout(900);
console.log('after 2x right → page label', await page.textContent('.rbar'));
await page.screenshot({ path: `${out}/41-comic-p3.png` });
await page.waitForTimeout(900);
const [st] = await invoke(page, 'library:get', [cbz.id]);
console.log('comic progress saved', JSON.stringify({ progress: st.progress, location: st.location, position: st.positionSec }));

// settings popover + double
await page.mouse.move(900, 300);
await page.click('button[aria-label="Reading settings"]');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/42-comic-settings.png` });
await page.click('.rset [role=radio]:has-text("Two pages")');
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/43-comic-double.png` });
await page.click('.rset [role=radio]:has-text("Right to left")');
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/44-comic-double-rtl.png` });
await page.click('.rset [role=radio]:has-text("Scroll")');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/45-comic-scroll.png` });
await close(); await close();
console.log('reader open after close?', await page.evaluate(() => !!window.__reader().item));
await page.evaluate(() => window.__reader().close());

// Comic: folder
const folder = comics.find((c) => c.ext === '' || c.container === 'folder' || c.title.includes('Dungeon'));
if (folder) {
  await invoke(page, 'settings:set', { reader: { mode: 'single', direction: 'ltr' } });
  await open(folder); await page.waitForSelector('.comic-page', { timeout: 15000 }); await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/46-comic-folder.png` });
  await page.evaluate(() => window.__reader().close());
}

// EPUB
const epub = books[0];
if (epub) {
  await open(epub);
  await page.waitForSelector('.epub-frame', { timeout: 15000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/47-epub.png` });
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(700);
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(700);
  console.log('epub bar', await page.textContent('.rbar'));
  await page.screenshot({ path: `${out}/48-epub-p3.png` });
  await page.mouse.move(800, 400);
  await page.click('button[aria-label="Contents"]'); await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/49-epub-toc.png` });
  await page.click('button[aria-label="Contents"]'); await page.waitForTimeout(300);
  await page.click('button[aria-label="Reading settings"]'); await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/50-epub-settings.png` });
  await page.click('.swatch--theme[aria-label=dark]'); await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/51-epub-dark.png` });
  await page.evaluate(() => window.__reader().close());
  await page.waitForTimeout(500);
  const [b] = await invoke(page, 'library:get', [epub.id]);
  console.log('epub progress', JSON.stringify({ p: b?.progress, loc: b?.location }));
}

// Images
if (images.length) {
  await open(images[0], images);
  await page.waitForSelector('.viewer__img', { timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/52-viewer.png` });
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(600);
  await page.click('button[aria-label="Info"]'); await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/53-viewer-info.png` });
  await page.evaluate(() => window.__reader().close());
}

console.log(errors.length ? `Renderer errors:\n${errors.join('\n')}` : 'No renderer errors');
await app.close();
