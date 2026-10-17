import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { realErrors, startApp, type TestApp } from './support';

describe('window modes', () => {
  let t: TestApp;
  beforeAll(async () => { t = await startApp({ size: [1280, 800] }); });
  afterAll(async () => { await t.close(); });

  const win = () => t.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]!; const b = w.getBounds(); return { ...b, onTop: w.isAlwaysOnTop(), opacity: w.getOpacity() }; });
  const mode = () => t.page.evaluate(() => document.querySelector('.compact')?.getAttribute('data-mode') ?? 'normal');

  it('floats a video in a mini window shaped like the picture, then restores the layout', async () => {
    const original = await win();
    const neon = await t.find('Neon Drift', 'video');
    await t.page.evaluate((i) => window.__playVideo(i), neon);
    await t.waitFor(async () => (await t.page.evaluate(() => window.__videoState().phase)) === 'ready', { message: 'video ready' });

    await t.invoke('window:setMode', 'mini');
    await t.waitFor(async () => (await mode()) === 'mini', { message: 'mini layout' });
    const mini = await t.waitFor(async () => { const w = await win(); return Math.abs(w.width / w.height - 16 / 9) < 0.05 && w; }, { message: '16:9 mini window' });
    expect(mini.onTop).toBe(true);
    expect(mini.width).toBeLessThan(original.width);

    await t.invoke('window:setMode', 'overlay');
    await t.waitFor(async () => (await mode()) === 'overlay', { message: 'overlay layout' });
    await t.invoke('window:overlay', { opacity: 0.5 });
    await t.waitFor(async () => (await win()).opacity === 0.5, { message: 'overlay opacity' });
    expect((await win()).onTop).toBe(true);
    await t.invoke('window:overlay', { opacity: 1 });

    await t.invoke('window:setMode', 'normal');
    const back = await t.waitFor(async () => { const w = await win(); return !w.onTop && w.width === original.width && w.height === original.height && w; }, { message: 'original window restored' });
    expect(back.opacity).toBe(1);
    // Playback carried on the whole time.
    expect(await t.page.evaluate(() => window.__videoState().phase)).toBe('ready');
  });

  it('never throws renderer errors', () => {
    expect(realErrors(t.errors)).toEqual([]);
  });
});
