import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StatsResult } from '../../src/shared/types';
import { realErrors, startApp, type TestApp } from './support';

describe('statistics', () => {
  let t: TestApp;
  beforeAll(async () => { t = await startApp({ size: [1280, 900] }); });
  afterAll(async () => { await t.close(); });

  const record = async (title: string, kind: 'video' | 'audio', daysAgo: number, watchedSec: number, speed = 1) => {
    const item = await t.find(title, kind);
    const d = new Date(); d.setHours(20, 0, 0, 0); d.setDate(d.getDate() - daysAgo);
    await t.invoke('history:record', { mediaId: item.id, startedAt: d.getTime(), watchedSec, mediaSec: watchedSec * speed, fromSec: 0, toSec: watchedSec, speed });
  };

  it('shows a friendly empty state before anything has been played', async () => {
    await t.go({ name: 'stats' });
    await t.page.waitForSelector('.empty');
    expect(await t.page.textContent('.empty')).toContain('Nothing played');
  });

  it('adds up what you watched and listened to', async () => {
    await record('Neon Drift', 'video', 0, 3600, 1.5);
    await record('Neon Drift', 'video', 1, 1800, 1.5);
    await record('Opening', 'audio', 2, 600);
    const s = await t.invoke<StatsResult>('stats:get', {});
    expect(s.videoSec).toBe(5400);
    expect(s.audioSec).toBe(600);
    expect(s.totalSec).toBe(6000);
    expect(s.sessions).toBe(3);
    expect(s.titlesPlayed).toBe(2);
    expect(s.streakDays).toBe(3);
    expect(s.avgSpeed).toBeCloseTo(1.5, 2);
    expect(s.topVideos[0]!.item.title).toContain('Neon Drift');
    expect(s.topVideos[0]!.sec).toBe(5400);
    expect(s.mostActiveHour).toBe(20);
    expect(s.hourly[20]).toBe(6000);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const onlyToday = await t.invoke<StatsResult>('stats:get', { from: today.getTime() });
    expect(onlyToday.totalSec).toBe(3600);
  });

  it('renders the dashboard and reacts to the range picker', async () => {
    await t.go({ name: 'home' }); // the open page was showing the empty state; come back to a fresh view
    await t.go({ name: 'stats' });
    await t.page.waitForSelector('.stats-hero');
    expect(await t.page.textContent('.stats-hero__num')).toMatch(/1\s*h\s*40\s*m/);
    expect((await t.page.$$('.stats-chart .chart__bar')).length).toBeGreaterThanOrEqual(25);
    expect(await t.page.textContent('.legend')).toContain('1 h 30 m');
    await t.page.click('.seg [aria-label="Week"]');
    await t.waitFor(async () => ((await t.page.textContent('.stats-hero__num')) ?? '').replace(/\s/g, '') === '1h40m', { message: 'week total' });
    await t.page.click('.seg [aria-label="All"]');
    await t.waitFor(async () => (await t.page.textContent('.toplist'))?.includes('Neon Drift'), { message: 'top list' });
    await t.page.locator('.stats-chart .chart__bar').nth(-3).hover({ force: true }); // two days ago: the music session
    await t.page.waitForSelector('.chart__tip');
    expect(await t.page.textContent('.chart__tip')).toContain('10 m');
  });

  it('can clear history from settings', async () => {
    await t.invoke('history:clear');
    const s = await t.invoke<StatsResult>('stats:get', {});
    expect(s.sessions).toBe(0);
    expect(realErrors(t.errors)).toEqual([]);
  });
});
