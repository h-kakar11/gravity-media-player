import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MediaItem, StatsResult } from '../../src/shared/types';
import { realErrors, startApp, type TestApp } from './support';

interface Snap { phase: string; mode?: string; time: number; duration: number; speed: number; audio: number; subs: number; cues: number; err: string | null; el: { t: number; paused: boolean; rate: number; w: number; frames: number } }

describe('video playback', () => {
  let t: TestApp;
  beforeAll(async () => { t = await startApp({ size: [1280, 800] }); });
  afterAll(async () => { await t.close(); });

  const snap = () => t.page.evaluate((): Snap => {
    const s = window.__videoState();
    const v = document.querySelector('video');
    return { ...s, el: { t: v?.currentTime ?? 0, paused: v?.paused ?? true, rate: v?.playbackRate ?? 0, w: v?.videoWidth ?? 0, frames: v?.getVideoPlaybackQuality?.().totalVideoFrames ?? 0 } };
  });
  const play = async (title: string, startSec?: number, item?: MediaItem) => {
    const it = item ?? (await t.find(title, 'video'));
    await t.page.evaluate(([i, s]) => window.__playVideo(i, s), [it, startSec] as const);
    return it;
  };
  /** Wait until playback has really advanced past `after` seconds of media time. */
  const playing = (after = 1.2) => t.waitFor(async () => { const s = await snap(); return s.phase === 'ready' && !s.el.paused && s.time > after && s; }, { timeout: 40_000, message: 'video to advance' });
  const close = () => t.page.evaluate(() => window.__videoApi().close());

  it('plays an H.264 MP4 directly, without converting', async () => {
    await play('Neon Drift');
    const s = await playing();
    expect(s.mode).toBe('direct');
    expect(s.el.w).toBeGreaterThan(0);
    expect(s.err).toBeNull();
  });

  it('supports speeds from 0.1× to 5× and seeking', async () => {
    for (const rate of [0.1, 0.5, 2, 5, 1]) {
      await t.page.evaluate((r) => window.__videoApi().setSpeed(r), rate);
      await t.waitFor(async () => Math.abs((await snap()).el.rate - rate) < 0.001, { message: `element rate ${rate}` });
    }
    await t.page.evaluate(() => window.__videoApi().seek(12));
    const s = await t.waitFor(async () => { const x = await snap(); return Math.abs(x.time - 12) < 2 && x; }, { message: 'seek to 12 s' });
    expect(s.err).toBeNull();
    await t.page.evaluate(() => window.__videoApi().setSpeed(9)); // clamped
    expect((await snap()).speed).toBe(5);
    await t.page.evaluate(() => window.__videoApi().setSpeed(0.01));
    expect((await snap()).speed).toBe(0.1);
    await close();
  });

  it('keeps a 120 fps clip at its own frame rate', async () => {
    const item = await play('Smooth 120');
    expect(item.fps).toBeGreaterThanOrEqual(119);
    const s = await playing();
    expect(s.mode).toBe('direct');
    await close();
  });

  it('converts what the engine cannot play (HEVC, AVI) and still seeks accurately', async () => {
    for (const title of ['Hevc Test', 'Holiday Clip']) {
      await play(title);
      const s = await playing(0.8);
      expect(['remux', 'transcode']).toContain(s.mode);
      const dur = s.duration;
      expect(dur).toBeGreaterThan(2);
      const target = Math.floor(dur * 0.5);
      await t.page.evaluate((x) => window.__videoApi().seek(x), target);
      const after = await t.waitFor(async () => { const x = await snap(); return Math.abs(x.time - target) < 2 && !x.el.paused && x; }, { timeout: 40_000, message: `${title}: seek to ${target}` });
      expect(after.err).toBeNull();
      await close();
    }
  });

  it('switches audio tracks and loads subtitles', async () => {
    await play('Orbit Study');
    const s = await playing(0.8);
    const tracks = await t.page.evaluate(() => ({ audio: window.__videoApi().audioTracks.length, subs: window.__videoApi().subtitleTracks.map((x: { id: string; label: string }) => x.label) }));
    expect(tracks.audio).toBeGreaterThanOrEqual(2);
    expect(tracks.subs.length).toBeGreaterThanOrEqual(2);
    await t.page.evaluate(() => window.__videoApi().setAudio(1));
    await t.waitFor(async () => { const x = await snap(); return x.audio === 1 && x.phase === 'ready' && !x.el.paused && x.time > s.time - 1; }, { timeout: 40_000, message: 'second audio track playing' });
    const id = await t.page.evaluate(() => window.__videoApi().subtitleTracks[0].id);
    await t.page.evaluate((x) => window.__videoApi().setSubtitle(x), id);
    await t.waitFor(async () => (await snap()).cues > 0, { message: 'subtitle cues to load' });
    await close();
  });

  it('saves progress, records history and resumes where you left off', async () => {
    const item = await play('Neon Drift');
    await playing(2);
    await t.page.evaluate(() => window.__videoApi().seek(8));
    // Sessions under five seconds of real viewing are not counted, so watch a little longer.
    await t.waitFor(async () => (await snap()).time > 14, { timeout: 40_000, message: 'playback past 14 s' });
    await close();
    const saved = await t.waitFor(async () => { const [m] = await t.invoke<MediaItem[]>('library:get', [item.id]); return m!.positionSec > 8 && m; }, { message: 'progress to be saved' });
    expect(saved.progress).toBeGreaterThan(0);
    const stats = await t.invoke<StatsResult>('stats:get', {});
    expect(stats.sessions).toBeGreaterThanOrEqual(1);
    expect(stats.videoSec).toBeGreaterThan(5);
    await play('Neon Drift', undefined, saved);
    const resumed = await t.waitFor(async () => { const s = await snap(); return s.phase === 'ready' && s.time >= saved.positionSec - 2 && s; }, { message: 'resume at saved position' });
    expect(resumed.time).toBeLessThan(saved.durationSec);
    await close();
  });

  it('shows the player UI with working controls', async () => {
    await play('Neon Drift');
    await playing(1);
    await t.page.mouse.move(600, 500);
    await t.page.waitForSelector('.player .ctl-play');
    await t.page.click('.player .ctl-play'); // pause
    await t.waitFor(async () => (await snap()).el.paused, { message: 'pause' });
    await t.page.keyboard.press('Space');
    await t.waitFor(async () => !(await snap()).el.paused, { message: 'resume with Space' });
    const before = (await snap()).time;
    await t.page.keyboard.press('ArrowRight');
    await t.waitFor(async () => (await snap()).time > before + 5, { message: '+10 s skip' });
    await t.page.keyboard.press('Escape');
    await t.waitFor(async () => !(await t.page.$('.player')), { message: 'player to close' });
  });

  it('never throws renderer errors', () => {
    expect(realErrors(t.errors)).toEqual([]);
  });
});
