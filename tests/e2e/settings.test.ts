import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Settings } from '../../src/shared/settings';
import { realErrors, startApp, type TestApp } from './support';

describe('settings', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp({ library: false });
    // An empty library greets the user with the first-run welcome, which would cover the panes under test.
    await t.invoke('settings:set', { welcome: { done: true } });
    await t.waitFor(async () => !(await t.page.$('[aria-labelledby="firstrun-title"]')), { message: 'welcome to close' });
  });
  afterAll(async () => { await t.close(); });

  const attr = (name: string) => t.page.evaluate((n: string) => document.documentElement.getAttribute(n), name);
  const settings = () => t.invoke<Settings>('settings:get');

  it('switches theme and accent live and persists them', async () => {
    await t.go({ name: 'settings', pane: 'appearance' });
    await t.page.click('[role=radio][aria-checked]:has-text("Midnight")');
    await t.waitFor(async () => (await attr('data-theme')) === 'midnight', { message: 'midnight theme' });
    await t.page.click('[aria-label="Accent colour"] [aria-label="Pink"]');
    const accent = await t.page.evaluate(() => document.documentElement.style.getPropertyValue('--accent-l'));
    expect(accent).toBe('#d3245b');
    const s = await settings();
    expect(s.appearance.theme).toBe('midnight');
    expect(s.appearance.accent).toBe('pink');
  });

  it('scales text and honours reduce-motion', async () => {
    await t.invoke('settings:set', { appearance: { textScale: 1.3, reduceMotion: 'on' } });
    await t.waitFor(async () => (await attr('data-reduce-motion')) === 'true');
    expect(await t.page.evaluate(() => document.documentElement.style.getPropertyValue('--text-scale'))).toBe('1.3');
  });

  it('rebinds a shortcut and the new key works', async () => {
    await t.go({ name: 'settings', pane: 'keyboard' });
    await t.page.click('[aria-label="Add a shortcut for Statistics"]');
    await t.page.keyboard.press('Control+Shift+9');
    await t.waitFor(async () => ((await settings()).hotkeys['nav.stats'] ?? []).includes('mod+shift+9'), { message: 'shortcut to be stored' });
    await t.go({ name: 'home' });
    await t.page.keyboard.press('Control+Shift+9');
    await t.waitFor(async () => (await t.page.evaluate(() => window.__route().name)) === 'stats', { message: 'rebound shortcut to navigate' });
  });

  it('flags conflicting shortcuts', async () => {
    await t.invoke('settings:set', { hotkeys: { 'nav.history': ['mod+1'] } });
    await t.go({ name: 'settings', pane: 'keyboard' });
    await t.page.waitForSelector('.kb-clash');
    await t.invoke('settings:set', { hotkeys: { 'nav.history': ['mod+9'] } });
  });

  it('reorders the player controls', async () => {
    await t.go({ name: 'settings', pane: 'controls' });
    const first = t.page.locator('.sgroup', { hasText: 'Video player' }).locator('.srow--compact').first();
    await expect(first.textContent()).resolves.toContain('Skip back');
    await first.locator('[aria-label="Move Skip back later"]').click();
    await t.waitFor(async () => (await settings()).controls.video[1] === 'skipBack', { message: 'order to change' });
  });

  it('exports sane defaults after reset', async () => {
    await t.invoke('settings:reset');
    const s = await settings();
    expect(s.appearance.theme).toBe('system');
    expect(s.hotkeys).toEqual({});
    expect(realErrors(t.errors)).toEqual([]);
  });
});
