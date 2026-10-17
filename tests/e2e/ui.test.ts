import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { realErrors, startApp, type TestApp } from './support';

describe('interface', () => {
  let t: TestApp;
  beforeAll(async () => { t = await startApp(); });
  afterAll(async () => { await t.close(); });

  const route = () => t.page.evaluate(() => window.__route().name as string);
  const heading = async () => (await t.page.textContent('h1'))?.trim();

  it('renders every section without errors', async () => {
    // Home with a populated library opens on a hero, so it is checked by route rather than by title.
    const routes: [{ name: string; path?: string | null }, string][] = [
      [{ name: 'home' }, ''],
      [{ name: 'videos' }, 'Videos'],
      [{ name: 'music' }, 'Music'],
      [{ name: 'comics' }, 'Manga & Comics'],
      [{ name: 'books' }, 'Books'],
      [{ name: 'photos' }, 'Photos'],
      [{ name: 'browse', path: null }, 'Browse'],
      [{ name: 'favorites' }, 'Favourites'],
      [{ name: 'history' }, 'History'],
      [{ name: 'stats' }, 'Statistics'],
      [{ name: 'settings' }, 'Settings']
    ];
    for (const [route_, title] of routes) {
      await t.go(route_);
      await t.waitFor(async () => (await route()) === route_.name && ((await heading()) ?? '').startsWith(title) && !!(await t.page.$('.page')), { message: `“${route_.name}” to render` });
    }
    expect(realErrors(t.errors)).toEqual([]);
  });

  it('navigates from the sidebar and with keyboard shortcuts', async () => {
    await t.page.click('.side-item:has-text("Music")');
    await t.waitFor(async () => (await route()) === 'music');
    await t.page.keyboard.press('Control+2');
    await t.waitFor(async () => (await route()) === 'videos', { message: 'Ctrl+2 to open Videos' });
    await t.page.keyboard.press('Control+1');
    await t.waitFor(async () => (await route()) === 'home', { message: 'Ctrl+1 to open Home' });
    await t.page.keyboard.press('Control+,');
    await t.waitFor(async () => (await route()) === 'settings', { message: 'Ctrl+, to open Settings' });
  });

  it('searches the whole library from the toolbar', async () => {
    await t.page.fill('input[aria-label="Search library"]', 'signal');
    await t.waitFor(async () => (await t.page.textContent('body'))?.includes('Signal Lost'), { message: 'search results' });
    await t.page.fill('input[aria-label="Search library"]', '');
    await t.page.evaluate(() => document.activeElement?.blur());
  });

  it('switches between grid, list and column views', async () => {
    for (const route of [{ name: 'videos' }, { name: 'music', tab: 'songs' }, { name: 'browse', path: null }] as const) {
      await t.go(route);
      for (const mode of ['List', 'Columns', 'Grid']) {
        const btn = t.page.locator(`[aria-label="View mode"] [aria-label="View ${mode}"], [aria-label="View mode"] [title="View ${mode}"]`).first();
        if (!(await btn.count())) continue; // not every section offers every layout
        await btn.click();
        await t.page.waitForTimeout(350);
        expect(await t.page.$('.page'), `${route.name} as ${mode}`).not.toBeNull();
      }
    }
  });

  it('opens the keyboard shortcut sheet with ?', async () => {
    await t.go({ name: 'home' });
    await t.page.evaluate(() => document.activeElement?.blur());
    await t.page.keyboard.press('?');
    await t.page.waitForSelector('[aria-label="Keyboard shortcuts"]');
    await t.page.keyboard.press('Escape');
    await t.page.waitForSelector('[aria-label="Keyboard shortcuts"]', { state: 'detached' });
  });

  it('can favourite an item and find it under Favourites', async () => {
    const neon = await t.find('Neon Drift');
    await t.invoke('state:update', neon.id, { favorite: true });
    await t.go({ name: 'favorites' });
    await t.waitFor(async () => (await t.page.textContent('body'))?.includes('Neon Drift'), { message: 'favourite to be listed' });
  });
});
