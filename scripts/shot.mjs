#!/usr/bin/env node
// Capture screenshots of the built app for visual review: node scripts/shot.mjs <outDir> [light|dark] [sampleDir]
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { addLibrary, go, invoke, launchApp } from './e2e-harness.mjs';

const out = resolve(process.argv[2] ?? 'shots');
const scheme = process.argv[3] ?? 'dark';
const sample = resolve(process.argv[4] ?? 'sample-media');
mkdirSync(out, { recursive: true });

const { app, page, errors } = await launchApp({ size: [1440, 900] });
await page.emulateMedia({ colorScheme: scheme });
await invoke(page, 'settings:set', { appearance: { theme: scheme } });
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/00-welcome.png` });
await addLibrary(page, sample);
const shot = async (name, route, wait = 700) => { await go(page, route); await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };
const items = (await invoke(page, 'library:query', { kind: 'video', limit: 50 })).items;
const find = (t) => items.find((m) => m.title.includes(t));
await shot('01-home', { name: 'home' }, 1800);
await shot('02-videos', { name: 'videos' });
await shot('03-movie', { name: 'media', id: find('Orbit').id }, 1500);
await shot('04-show', { name: 'show', key: 'signal lost' }, 1200);
await shot('05-music', { name: 'music', tab: 'albums' });
const albums = (await invoke(page, 'library:albums', {})).items;
await shot('06-album', { name: 'album', key: albums.find((a) => a.album === 'Night Signals').key }, 1200);
await shot('07-songs', { name: 'music', tab: 'songs' });
await shot('08-browse', { name: 'browse', path: null });
await shot('09-browse-folder', { name: 'browse', path: `${sample}/Movies` });
await shot('10-comics', { name: 'comics' });
await shot('11-books', { name: 'books' });
await shot('12-photos', { name: 'photos' });
console.log(errors.length ? `Renderer errors:\n${errors.join('\n')}` : 'No renderer errors');
await app.close();
