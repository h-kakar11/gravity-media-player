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
  it('keeps accepting new keys in free-form maps after they already hold entries', () => {
    let s = clone(DEFAULT_SETTINGS);
    s = mergeSettings(s, { view: { mode: { videos: 'list' }, sort: { videos: { key: 'title', desc: false } } }, hotkeys: { 'nav.stats': ['mod+shift+9'] } });
    s = mergeSettings(s, { view: { mode: { comics: 'grid' }, sort: { comics: { key: 'added', desc: true } } }, hotkeys: { 'nav.history': ['mod+h'] } });
    expect(s.view.mode).toEqual({ videos: 'list', comics: 'grid' });
    expect(Object.keys(s.view.sort)).toEqual(['videos', 'comics']);
    expect(s.hotkeys).toEqual({ 'nav.stats': ['mod+shift+9'], 'nav.history': ['mod+h'] });
  });

  it('drops malformed entries in free-form maps', () => {
    const s = mergeSettings(clone(DEFAULT_SETTINGS), { hotkeys: { a: ['x'], b: 'oops', c: [1] }, view: { mode: { a: 3 }, sort: { a: { key: 1 } } } });
    expect(s.hotkeys).toEqual({ a: ['x'] });
    expect(s.view.mode).toEqual({});
    expect(s.view.sort).toEqual({});
  });

  it('merges window geometry piecewise', () => {
    let s = mergeSettings(clone(DEFAULT_SETTINGS), { window: { bounds: { width: 800, height: 600, maximized: false } } });
    s = mergeSettings(s, { window: { bounds: { x: 10, y: 20 } } });
    expect(s.window.bounds).toEqual({ width: 800, height: 600, maximized: false, x: 10, y: 20 });
    s = mergeSettings(s, { window: { bounds: null } });
    expect(s.window.bounds).toBeNull();
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
