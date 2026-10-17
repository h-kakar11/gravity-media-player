import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MediaItem } from '../../src/shared/types';
import { realErrors, startApp, type TestApp } from './support';

describe('readers', () => {
  let t: TestApp;
  beforeAll(async () => { t = await startApp({ size: [1280, 860] }); });
  afterAll(async () => { await t.close(); });

  const open = (item: MediaItem, ctx?: MediaItem[]) => t.page.evaluate(([i, c]) => window.__reader().open(i, c), [item, ctx ?? [item]] as const);
  const close = async () => { await t.page.evaluate(() => window.__reader().close()); await t.page.waitForSelector('.reader-host', { state: 'detached' }); };
  const bar = async () => ((await t.page.textContent('.rbar')) ?? '').replace(/\s+/g, ' ').trim();
  const saved = async (id: number) => { const [m] = await t.invoke<MediaItem[]>('library:get', [id]); return m!; };
  const press = async (key: string) => { await t.page.keyboard.press(key); await t.page.waitForTimeout(250); };

  it('reads a CBZ volume: pages, progress and resume', async () => {
    const cbz = await t.find('Planet Walker v01', 'comic');
    expect(cbz.pages).toBe(12);
    await open(cbz);
    await t.page.waitForSelector('.comic-page', { timeout: 20_000 });
    expect(await bar()).toContain('1 / 12');
    await press('ArrowRight');
    await press('ArrowRight');
    await t.waitFor(async () => (await bar()).includes('3 / 12'), { message: 'page 3' });
    await t.waitFor(async () => JSON.parse((await saved(cbz.id)).location ?? '{}').page === 2, { message: 'progress saved' });
    expect((await saved(cbz.id)).progress).toBeCloseTo(3 / 12, 2);
    await press('Home');
    await t.waitFor(async () => (await bar()).includes('1 / 12'), { message: 'Home goes to the first page' });
    await press('End');
    await t.waitFor(async () => (await bar()).includes('12 / 12'), { message: 'End goes to the last page' });
    await t.waitFor(async () => (await saved(cbz.id)).completed, { message: 'finishing the volume marks it read' });
    await close();

    // A finished volume starts over from page 1 …
    await open(await saved(cbz.id));
    await t.page.waitForSelector('.comic-page');
    await t.waitFor(async () => (await bar()).includes('1 / 12'), { message: 'finished volume restarts' });
    // … while one that is part-way through resumes where it was.
    for (let i = 0; i < 4; i++) await press('ArrowRight');
    await t.waitFor(async () => JSON.parse((await saved(cbz.id)).location ?? '{}').page === 4, { message: 'page 5 saved' });
    await close();
    await t.invoke('state:update', cbz.id, { completed: false });
    await open(await saved(cbz.id));
    await t.page.waitForSelector('.comic-page');
    await t.waitFor(async () => (await bar()).includes('5 / 12'), { message: 'resume on page 5' });
    await close();
  });

  it('flips for right-to-left manga and offers a two-page spread and a scroll mode', async () => {
    const cbz = await t.find('Planet Walker v01', 'comic');
    await t.invoke('settings:set', { reader: { mode: 'single', direction: 'ltr' } });
    await open({ ...cbz, location: null, positionSec: 0, progress: 0 });
    await t.page.waitForSelector('.comic-page');
    await press('r'); // toggle direction
    await t.waitFor(async () => !!(await t.page.$('.comic-spread.is-rtl')), { message: 'RTL layout' });
    await press('ArrowLeft'); // in RTL, left = next
    await t.waitFor(async () => (await bar()).includes('2 / 12'), { message: 'left arrow advances in RTL' });
    await t.invoke('settings:set', { reader: { mode: 'double' } });
    await t.waitFor(async () => (await t.page.$$('.comic-page')).length === 2, { message: 'two pages visible' });
    await t.invoke('settings:set', { reader: { mode: 'scroll' } });
    await t.waitFor(async () => (await t.page.$$('.comic-strip__page')).length === 12, { message: 'all pages in the strip' });
    await t.invoke('settings:set', { reader: { mode: 'single', direction: 'ltr' } });
    await close();
  });

  it('reads a folder of images as a comic', async () => {
    const chapter = (await t.items('comic')).find((c) => c.title === 'Chapter 1')!;
    expect(chapter.pages).toBe(10);
    await open(chapter);
    await t.page.waitForSelector('.comic-page');
    expect(await bar()).toContain('1 / 10');
    await close();
  });

  it('reads an EPUB: pagination, contents and progress', async () => {
    const book = await t.find('The Quiet Orbit', 'book');
    await open(book);
    const frame = t.page.frameLocator('.epub-frame');
    await frame.locator('h1').first().waitFor({ timeout: 20_000 });
    expect(await frame.locator('h1').first().textContent()).toContain('Chapter One');
    await t.waitFor(async () => /\d+ \/ \d+/.test(await bar()), { message: 'page counter' });
    const before = await bar();
    await press('ArrowRight');
    await t.waitFor(async () => (await bar()) !== before, { message: 'next page' });

    await t.page.mouse.move(640, 300);
    await t.page.click('button[aria-label="Contents"]');
    await t.page.waitForSelector('.rside .rside__item');
    expect(await t.page.$$eval('.rside .rside__item', (els: { textContent: string }[]) => els.map((e) => e.textContent))).toEqual(['Chapter One: Falling', 'Chapter Two: Orbit', 'Chapter Three: Return']);
    await t.page.click('.rside__item:has-text("Chapter Two")');
    await frame.locator('h1').first().waitFor();
    await t.waitFor(async () => ((await frame.locator('h1').first().textContent()) ?? '').includes('Chapter Two'), { message: 'chapter two to load' });
    await t.waitFor(async () => JSON.parse((await saved(book.id)).location ?? '{}').spine === 1, { message: 'spine saved', timeout: 10_000 });
    await close();

    await open(await saved(book.id)); // resume in chapter two
    await t.page.frameLocator('.epub-frame').locator('h1').first().waitFor();
    await t.waitFor(async () => ((await t.page.frameLocator('.epub-frame').locator('h1').first().textContent()) ?? '').includes('Chapter Two'), { message: 'resume in chapter two' });
    await close();
  });

  it('searches inside a book', async () => {
    const book = await t.find('The Quiet Orbit', 'book');
    const hits = await t.invoke<{ spineIndex: number; excerpt: string }[]>('reader:search', book.id, 'quietest');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.excerpt.toLowerCase()).toContain('quietest');
  });

  it('views photos and animated GIFs with a filmstrip', async () => {
    const photos = (await t.items('image')).sort((a, b) => a.title.localeCompare(b.title));
    expect(photos).toHaveLength(4);
    await open(photos[0]!, photos);
    await t.page.waitForSelector('.viewer__img');
    await t.waitFor(async () => t.page.evaluate(() => document.querySelector('.viewer__img')?.complete && document.querySelector('.viewer__img')!.naturalWidth > 0), { message: 'image to decode' });
    expect((await t.page.$$('.film__item')).length).toBe(4);
    const first = await t.page.getAttribute('.viewer__img', 'alt');
    await press('ArrowRight');
    await t.waitFor(async () => (await t.page.getAttribute('.viewer__img', 'alt')) !== first, { message: 'next photo' });
    await t.page.mouse.move(640, 300);
    await t.page.click('button[aria-label="Info"]');
    await t.page.waitForSelector('.viewer__info');
    expect(await t.page.textContent('.viewer__info')).toMatch(/\d+ × \d+/);
    await close();
  });

  it('never throws renderer errors', () => {
    expect(realErrors(t.errors)).toEqual([]);
  });
});
