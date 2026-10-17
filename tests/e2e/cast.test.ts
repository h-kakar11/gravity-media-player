import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Settings } from '../../src/shared/settings';
import { realErrors, startApp, type TestApp } from './support';

describe('casting', () => {
  let t: TestApp;
  beforeAll(async () => { t = await startApp({ size: [1280, 800] }); });
  afterAll(async () => { await t.close(); });

  const settings = () => t.invoke<Settings>('settings:get');
  const play = async (title: string) => {
    const it = await t.find(title, 'video');
    await t.page.evaluate(([i, s]) => window.__playVideo(i, s), [it, 0] as const);
    await t.page.waitForSelector('.player__bottom');
  };

  it('is off by default: no discovery, no devices, no button', async () => {
    expect((await settings()).cast.enabled).toBe(false);
    expect(await t.invoke<unknown[]>('cast:devices')).toEqual([]);
    await expect(t.invoke('cast:discover')).rejects.toThrow(/turned off/);
    await play('Neon Drift');
    expect(await t.page.locator('[aria-label="Cast to device"]').count()).toBe(0);
    await t.page.evaluate(() => window.__videoApi().close());
  });

  it('turns on in Settings and puts a Cast button on the player', async () => {
    await t.go({ name: 'settings', pane: 'cast' });
    await t.page.click('[role=switch][aria-label="Enable casting"]');
    await t.waitFor(async () => (await settings()).cast.enabled, { message: 'casting to be enabled' });
    expect((await settings()).controls.video).toContain('cast');
    await play('Neon Drift');
    await t.page.waitForSelector('[aria-label="Cast to device"]');
  });

  it('opens the device sheet, says it is experimental, and closes with Escape', async () => {
    await t.page.click('[aria-label="Cast to device"]');
    const sheet = t.page.locator('[role=dialog][aria-label="Cast to a device"]');
    await sheet.waitFor();
    await t.waitFor(async () => /No devices found|Looking for devices/.test(await sheet.innerText()), { message: 'empty or scanning state' });
    expect(await sheet.innerText()).toMatch(/not been verified on real TVs/);
    await t.page.keyboard.press('Escape');
    await t.waitFor(async () => (await sheet.count()) === 0, { message: 'sheet to close' });
    expect(await t.invoke('cast:status')).toMatchObject({ state: 'idle' });
  });

  it('turning casting off again hides the button', async () => {
    await t.invoke('settings:set', { cast: { enabled: false } });
    await t.waitFor(async () => (await t.page.locator('[aria-label="Cast to device"]').count()) === 0, { message: 'button to go away' });
    await t.page.evaluate(() => window.__videoApi().close());
    expect(realErrors(t.errors)).toEqual([]);
  });
});
