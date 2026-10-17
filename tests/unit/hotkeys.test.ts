import { describe, expect, it } from 'vitest';
import { ACTIONS, comboLabel, effectiveKeymap, eventToCombo, findConflicts, normalizeCombo, toAccelerator } from '@shared/hotkeys';

const ev = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
  ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe('hotkeys', () => {
  it('normalises events per platform', () => {
    expect(eventToCombo(ev(' '), false)).toBe('space');
    expect(eventToCombo(ev('f', { metaKey: true }), true)).toBe('mod+f');
    expect(eventToCombo(ev('f', { ctrlKey: true }), false)).toBe('mod+f');
    expect(eventToCombo(ev('F', { shiftKey: true, ctrlKey: true }), false)).toBe('mod+shift+f');
    expect(eventToCombo(ev('ArrowLeft', { shiftKey: true }), false)).toBe('shift+left');
    expect(eventToCombo(ev('?', { shiftKey: true }), false)).toBe('?');
    expect(eventToCombo(ev('Shift', { shiftKey: true }), false)).toBeNull();
    expect(eventToCombo(ev('f', { metaKey: true, ctrlKey: true }), true)).toBe('mod+ctrl+f');
  });

  it('normalises user supplied combos', () => {
    expect(normalizeCombo('Shift+Cmd+F')).toBe('mod+shift+f');
    expect(normalizeCombo('Alt+ArrowLeft'.replace('Arrow', ''))).toBe('alt+left');
    expect(normalizeCombo('+')).toBe('+');
  });

  it('builds labels and accelerators', () => {
    expect(comboLabel('mod+shift+f', true)).toBe('⌘⇧F');
    expect(comboLabel('mod+shift+f', false)).toBe('Ctrl+Shift+F');
    expect(comboLabel('space', false)).toBe('Space');
    expect(toAccelerator('mod+shift+m')).toBe('CmdOrCtrl+Shift+M');
    expect(toAccelerator('space')).toBeNull();
    expect(toAccelerator('mod+,')).toBe('CmdOrCtrl+,');
  });

  it('ships a conflict-free default keymap', () => {
    expect(findConflicts(effectiveKeymap({}))).toEqual([]);
  });

  it('detects conflicts', () => {
    const map = effectiveKeymap({ 'media.mute': ['space'] });
    const c = findConflicts(map);
    expect(c.some((x) => x.combo === 'space' && x.actions.includes('media.mute') && x.actions.includes('media.playPause'))).toBe(true);
  });

  it('has unique action ids', () => {
    expect(new Set(ACTIONS.map((a) => a.id)).size).toBe(ACTIONS.length);
  });
});
