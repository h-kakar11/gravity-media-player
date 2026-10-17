import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LyricsResult, MediaItem } from '../../src/shared/types';
import { realErrors, startApp, type TestApp } from './support';

describe('music', () => {
  let t: TestApp;
  let album: MediaItem[];
  beforeAll(async () => {
    t = await startApp({ size: [1280, 800] });
    album = (await t.items('audio')).filter((m) => m.album === 'Night Signals').sort((a, b) => (a.trackNo ?? 0) - (b.trackNo ?? 0));
  });
  afterAll(async () => { await t.close(); });

  const music = () => t.page.evaluate(() => { const m = window.__music(); return { playing: m.playing, index: m.index, time: m.time, duration: m.duration, shuffle: m.shuffle, repeat: m.repeat, err: m.error, titles: m.queue.map((x: MediaItem) => x.title), current: m.queue[m.index]?.title as string | undefined, ctx: window.__audioGraph().state as string }; });
  const advancing = (min = 0.8) => t.waitFor(async () => { const m = await music(); return m.playing && m.time > min && m; }, { timeout: 30_000, message: 'audio to advance' });

  it('has the sample album in track order', () => {
    expect(album.map((a) => a.title)).toEqual(['Opening', 'Drift', 'Return', 'Afterglow']);
  });

  it('plays every sample format (MP3, FLAC, M4A, Ogg, Opus, WAV)', async () => {
    const all = await t.items('audio');
    expect(all.map((a) => a.ext).sort()).toEqual(['flac', 'm4a', 'mp3', 'ogg', 'opus', 'wav']);
    for (const item of all) {
      await t.page.evaluate((i) => window.__music().playItems([i], 0), item);
      const m = await advancing();
      expect(m.err, `${item.ext}: ${m.err}`).toBeNull();
      expect(m.ctx).toBe('running');
    }
  });

  it('moves through the queue, shuffles and repeats', async () => {
    await t.page.evaluate((items) => window.__music().playItems(items, 0), album);
    await advancing();
    await t.page.evaluate(() => window.__music().next());
    expect((await music()).current).toBe('Drift');
    await t.page.evaluate(() => window.__music().previous()); // within the first seconds: previous track
    await t.waitFor(async () => (await music()).current === 'Opening', { message: 'previous track' });

    await t.page.evaluate(() => window.__music().setShuffle(true));
    const shuffled = await music();
    expect(shuffled.current).toBe('Opening'); // the current track stays first
    expect([...shuffled.titles].sort()).toEqual(['Afterglow', 'Drift', 'Opening', 'Return']);
    await t.page.evaluate(() => window.__music().setShuffle(false));
    expect((await music()).titles).toEqual(['Opening', 'Drift', 'Return', 'Afterglow']);

    for (const [expected] of [['all'], ['one'], ['off']] as const) {
      await t.page.evaluate(() => window.__music().cycleRepeat());
      expect((await music()).repeat).toBe(expected);
    }
  });

  it('edits the queue', async () => {
    await t.page.evaluate((items) => window.__music().playItems(items, 0), album);
    await t.page.evaluate(() => window.__music().move(3, 1));
    expect((await music()).titles).toEqual(['Opening', 'Afterglow', 'Drift', 'Return']);
    await t.page.evaluate(() => window.__music().removeAt(1));
    expect((await music()).titles).toEqual(['Opening', 'Drift', 'Return']);
    const glow = await t.find('Glow', 'audio');
    await t.page.evaluate((g) => window.__music().playNext([g]), glow);
    expect((await music()).titles[1]).toBe('Glow');
  });

  it('reads synced lyrics from an .lrc file', async () => {
    const opening = album[0]!;
    const lyrics = await t.invoke<LyricsResult>('playback:lyrics', opening.id);
    expect(lyrics.synced).toBe(true);
    expect(lyrics.source).toBe('lrc');
    expect(lyrics.lines.length).toBeGreaterThan(2);
    expect(lyrics.lines[0]!.timeSec).toBeLessThan(lyrics.lines[1]!.timeSec);
  });

  it('applies the equaliser to the real audio graph', async () => {
    const resp = (hz: number) => t.page.evaluate((f) => window.__audioGraph().response(Float32Array.of(f))[0] as number, hz);
    await t.invoke('settings:set', { audio: { eq: { enabled: false } } });
    await t.waitFor(async () => Math.abs(await resp(62)) < 0.2, { message: 'flat response while disabled' });
    await t.invoke('settings:set', { audio: { eq: { enabled: true, preset: 'Custom', preamp: 0, gains: [0, 6, 0, 0, 0, 0, 0, 0, -6, 0], limiter: true } } });
    await t.waitFor(async () => (await resp(62)) > 4, { message: 'boost at 62 Hz' });
    expect(await resp(8000)).toBeLessThan(-4);
    expect(Math.abs(await resp(1000))).toBeLessThan(1);
    await t.invoke('settings:set', { audio: { eq: { enabled: false } } });
  });

  it('scrolls lyrics inside their panel without moving the Now Playing sheet', async () => {
    await t.page.evaluate((items) => window.__music().playItems(items, 0), album);
    await advancing();
    await t.page.evaluate(() => { window.__music().openNowPlaying('lyrics'); window.__music().seek(6); });
    await t.page.waitForSelector('.lyrics__line.is-active');
    await t.page.waitForTimeout(900); // let the smooth scroll finish
    const moved = await t.page.evaluate(() => { const np = document.querySelector('.np'); return { top: np.scrollTop, rect: np.getBoundingClientRect().top }; });
    expect(moved.top).toBe(0);
    expect(moved.rect).toBe(0);
    await t.page.evaluate(() => window.__music().closeNowPlaying());
  });

  it('shows the player bar and Now Playing', async () => {
    await t.page.evaluate((items) => window.__music().playItems(items, 0), album);
    await advancing();
    await t.page.waitForSelector('[aria-label="Music player"]');
    await t.page.evaluate(() => window.__music().openNowPlaying('lyrics'));
    await t.page.waitForSelector('.np');
    await t.page.evaluate(() => window.__music().closeNowPlaying());
  });

  it('never throws renderer errors', () => {
    expect(realErrors(t.errors)).toEqual([]);
  });
});
