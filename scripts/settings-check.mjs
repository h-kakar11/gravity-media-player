// Ad-hoc settings verification: node scripts/settings-check.mjs <outDir> [light|dark]
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { addLibrary, go, launchApp } from './e2e-harness.mjs';

const out = resolve(process.argv[2] ?? 'shots');
const scheme = process.argv[3] ?? 'dark';
mkdirSync(out, { recursive: true });
const { app, page, errors } = await launchApp({ size: [1440, 960] });
await page.emulateMedia({ colorScheme: scheme });
await addLibrary(page, resolve('sample-media'));
for (const pane of ['library', 'appearance', 'playback', 'audio', 'reading', 'controls', 'keyboard', 'performance', 'about']) {
  await go(page, { name: 'settings', pane });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/s-${scheme}-${pane}.png`, fullPage: false });
  // Capture the full pane height too, for long panes
  const h = await page.evaluate(() => document.querySelector('.content, main, .app__content')?.scrollHeight ?? 0);
  console.log(pane, 'content height', h);
}
console.log(errors.length ? `Renderer errors:\n${errors.join('\n')}` : 'No renderer errors');
await app.close();
