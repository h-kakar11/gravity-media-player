import { describe, expect, it } from 'vitest';
import { clampSettings, DEFAULT_SETTINGS, mergeSettings, type Settings } from '@shared/settings';

const clone = <T,>(v: T): T => structuredClone(v);

describe('settings merge', () => {
  it('keeps defaults when patch is garbage', () => {
    expect(mergeSettings(clone(DEFAULT_SETTINGS), 'nope')).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(clone(DEFAULT_SETTINGS), null)).toEqual(DEFAULT_SETTINGS);
  });
  it('merges nested values and drops unknown or mistyped keys', () => {
    const merged = mergeSettings(clone(DEFAULT_SETTINGS), {
      appearance: { accent: 'pink', textScale: 'huge', bogus: 1 },
      playback: { skipForwardSec: 30, subtitleStyle: { size: 1.4 } },
      unknown: true
    }) as Settings & { unknown?: boolean };
    expect(merged.appearance.accent).toBe('pink');
    expect(merged.appearance.textScale).toBe(1);
    expect((merged.appearance as Record<string, unknown>).bogus).toBeUndefined();
    expect(merged.playback.skipForwardSec).toBe(30);
    expect(merged.playback.subtitleStyle.size).toBe(1.4);
    expect(merged.playback.subtitleStyle.color).toBe('#ffffff');
    expect(merged.unknown).toBeUndefined();
  });
  it('accepts free-form maps and nullable bounds', () => {
    const merged = mergeSettings(clone(DEFAULT_SETTINGS), {
      hotkeys: { 'media.mute': ['x'] },
      view: { mode: { videos: 'list' } },
      window: { bounds: { x: 1, y: 2, width: 900, height: 700, maximized: false } }
    });
    expect(merged.hotkeys['media.mute']).toEqual(['x']);
    expect(merged.view.mode.videos).toBe('list');
    expect(merged.window.bounds?.width).toBe(900);
  });
  it('clamps out-of-range values', () => {
    const s = clone(DEFAULT_SETTINGS);
    s.appearance.textScale = 9;
    s.playback.defaultSpeed = 99;
    s.audio.eq.gains = [40, -40];
    s.appearance.sidebarOrder = ['stats', 'nope'];
    clampSettings(s);
    expect(s.appearance.textScale).toBe(1.6);
    expect(s.playback.defaultSpeed).toBe(5);
    expect(s.audio.eq.gains).toHaveLength(10);
    expect(s.audio.eq.gains[0]).toBe(18);
    expect(s.appearance.sidebarOrder[0]).toBe('stats');
    expect(s.appearance.sidebarOrder).not.toContain('nope');
    expect(new Set(s.appearance.sidebarOrder).size).toBe(10);
  });
});
