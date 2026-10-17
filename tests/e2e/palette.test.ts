import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { realErrors, startApp, type TestApp } from './support';

describe('command palette', () => {
  let t: TestApp;
  beforeAll(async () => { t = await startApp(); });
  afterAll(async () => { await t.close(); });

  const route = () => t.page.evaluate(() => window.__route().name as string);
  const palette = () => t.page.$('[aria-label="Command palette"]');

  it('opens with Ctrl+K, filters, runs a command and closes', async () => {
    await t.page.keyboard.press('Control+k');
    await t.waitFor(async () => !!(await palette()), { message: 'palette to open' });
    await t.page.keyboard.type('stats');
    await t.page.keyboard.press('Enter');
    await t.waitFor(async () => (await route()) === 'stats', { message: 'Statistics to open from the palette' });
    await t.waitFor(async () => !(await palette()), { message: 'palette to close' });
    expect(realErrors(t.errors)).toEqual([]);
  });

  it('closes with Escape and leaves typing in the search box untouched', async () => {
    await t.page.keyboard.press('Control+k');
    await t.waitFor(async () => !!(await palette()), { message: 'palette to open' });
    await t.page.keyboard.press('Escape');
    await t.waitFor(async () => !(await palette()), { message: 'palette to close' });
    // "k" and the other single-key shortcuts must stay plain text while a field has focus.
    await t.page.fill('input[aria-label="Search library"]', '');
    await t.page.focus('input[aria-label="Search library"]');
    await t.page.keyboard.type('kjl');
    expect(await t.page.inputValue('input[aria-label="Search library"]')).toBe('kjl');
    expect(await palette()).toBeNull();
  });

  it('toggles with a second Ctrl+K', async () => {
    await t.page.keyboard.press('Control+k');
    await t.waitFor(async () => !!(await palette()), { message: 'palette to open' });
    await t.page.keyboard.press('Control+k');
    await t.waitFor(async () => !(await palette()), { message: 'palette to toggle closed' });
  });
});
