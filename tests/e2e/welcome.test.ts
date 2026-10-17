import { afterAll, describe, expect, it } from 'vitest';
import type { Settings } from '../../src/shared/settings';
import { realErrors, startApp, type TestApp } from './support';

const welcome = (t: TestApp) => t.page.$('[aria-labelledby="firstrun-title"]');

describe('first-run welcome', () => {
  let empty: TestApp | undefined;
  let existing: TestApp | undefined;
  afterAll(async () => { await empty?.close(); await existing?.close(); });

  it('greets an empty library, and Escape dismisses it for good', async () => {
    const t = (empty = await startApp({ library: false }));
    await t.waitFor(() => welcome(t), { message: 'welcome to appear' });
    expect(await t.page.textContent('#firstrun-title')).toBe('Welcome to Gravity');
    await t.page.keyboard.press('Escape');
    await t.waitFor(async () => !(await welcome(t)), { message: 'welcome to close' });
    expect((await t.invoke<Settings>('settings:get')).welcome.done).toBe(true);
    await t.page.reload();
    await t.page.waitForSelector('.app');
    await t.page.waitForTimeout(600);
    expect(await welcome(t)).toBeNull();
    expect(realErrors(t.errors)).toEqual([]);
  });

  it('never appears for a library that already has folders, and retires itself', async () => {
    const t = (existing = await startApp());
    await t.page.waitForTimeout(600);
    expect(await welcome(t)).toBeNull();
    await t.waitFor(async () => (await t.invoke<Settings>('settings:get')).welcome.done, { message: 'welcome to be marked done' });
  });
});
