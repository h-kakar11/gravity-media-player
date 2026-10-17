/**
 * Hotkey registry. Every keyboard-triggerable command is declared here with its default
 * bindings, so the keymap editor, the dispatcher and the native menu share one source of truth.
 *
 * Combo format: lowercase tokens joined by "+", modifiers first in the order
 * mod, ctrl, alt, shift. `mod` means Cmd on macOS and Ctrl elsewhere. Examples:
 * "space", "mod+f", "shift+left", "]".
 */

export type HotkeyScope = 'global' | 'player' | 'music' | 'reader';

export interface ActionDef {
  id: string;
  label: string;
  group: string;
  scope: HotkeyScope;
  defaults: string[];
  /** Appears in the native menu bar (renderer dispatches the action). */
  menu?: string;
}

export const ACTIONS: ActionDef[] = [
  // Navigation
  { id: 'nav.search', label: 'Search', group: 'Navigation', scope: 'global', defaults: ['mod+f', '/'], menu: 'Go' },
  { id: 'nav.back', label: 'Back', group: 'Navigation', scope: 'global', defaults: ['mod+[', 'alt+left'], menu: 'Go' },
  { id: 'nav.forward', label: 'Forward', group: 'Navigation', scope: 'global', defaults: ['mod+]', 'alt+right'], menu: 'Go' },
  { id: 'nav.home', label: 'Home', group: 'Navigation', scope: 'global', defaults: ['mod+1'], menu: 'Go' },
  { id: 'nav.videos', label: 'Videos', group: 'Navigation', scope: 'global', defaults: ['mod+2'], menu: 'Go' },
  { id: 'nav.music', label: 'Music', group: 'Navigation', scope: 'global', defaults: ['mod+3'], menu: 'Go' },
  { id: 'nav.comics', label: 'Manga & Comics', group: 'Navigation', scope: 'global', defaults: ['mod+4'], menu: 'Go' },
  { id: 'nav.books', label: 'Books', group: 'Navigation', scope: 'global', defaults: ['mod+5'], menu: 'Go' },
  { id: 'nav.photos', label: 'Photos', group: 'Navigation', scope: 'global', defaults: ['mod+6'], menu: 'Go' },
  { id: 'nav.browse', label: 'Browse Folders', group: 'Navigation', scope: 'global', defaults: ['mod+7'], menu: 'Go' },
  { id: 'nav.favorites', label: 'Favourites', group: 'Navigation', scope: 'global', defaults: ['mod+8'], menu: 'Go' },
  { id: 'nav.history', label: 'History', group: 'Navigation', scope: 'global', defaults: ['mod+9'], menu: 'Go' },
  { id: 'nav.stats', label: 'Statistics', group: 'Navigation', scope: 'global', defaults: ['mod+0'], menu: 'Go' },
  { id: 'app.settings', label: 'Settings', group: 'App', scope: 'global', defaults: ['mod+,'] },
  { id: 'app.palette', label: 'Command Palette', group: 'App', scope: 'global', defaults: ['mod+k'] },
  { id: 'app.shortcuts', label: 'Keyboard Shortcuts', group: 'App', scope: 'global', defaults: ['?'] },
  { id: 'view.sidebar', label: 'Toggle Sidebar', group: 'View', scope: 'global', defaults: ['mod+alt+s'], menu: 'View' },
  { id: 'view.grid', label: 'as Grid', group: 'View', scope: 'global', defaults: ['mod+shift+1'], menu: 'View' },
  { id: 'view.list', label: 'as List', group: 'View', scope: 'global', defaults: ['mod+shift+2'], menu: 'View' },
  { id: 'view.columns', label: 'as Columns', group: 'View', scope: 'global', defaults: ['mod+shift+3'], menu: 'View' },
  { id: 'view.info', label: 'Show Info Panel', group: 'View', scope: 'global', defaults: ['mod+i'], menu: 'View' },
  { id: 'view.zoomIn', label: 'Larger Posters', group: 'View', scope: 'global', defaults: ['mod+='], menu: 'View' },
  { id: 'view.zoomOut', label: 'Smaller Posters', group: 'View', scope: 'global', defaults: ['mod+-'], menu: 'View' },
  { id: 'library.rescan', label: 'Rescan Library', group: 'Library', scope: 'global', defaults: ['mod+r'], menu: 'Library' },
  { id: 'library.addFolder', label: 'Add Folder…', group: 'Library', scope: 'global', defaults: ['mod+o'], menu: 'Library' },
  { id: 'window.fullscreen', label: 'Toggle Full Screen', group: 'Window', scope: 'global', defaults: ['f', 'ctrl+mod+f'], menu: 'View' },
  { id: 'window.mini', label: 'Mini Player', group: 'Window', scope: 'global', defaults: ['mod+shift+m'], menu: 'Window' },
  { id: 'window.overlay', label: 'Overlay (Always on Top)', group: 'Window', scope: 'global', defaults: ['mod+shift+o'], menu: 'Window' },

  // Playback (video + music share transport actions; the active player handles them)
  { id: 'media.playPause', label: 'Play / Pause', group: 'Playback', scope: 'player', defaults: ['space', 'k'], menu: 'Playback' },
  { id: 'media.stop', label: 'Stop', group: 'Playback', scope: 'player', defaults: ['mod+.'], menu: 'Playback' },
  { id: 'media.seekBack', label: 'Skip Back', group: 'Playback', scope: 'player', defaults: ['left', 'j'], menu: 'Playback' },
  { id: 'media.seekForward', label: 'Skip Forward', group: 'Playback', scope: 'player', defaults: ['right', 'l'], menu: 'Playback' },
  { id: 'media.seekBackLong', label: 'Skip Back (60 s)', group: 'Playback', scope: 'player', defaults: ['shift+left'] },
  { id: 'media.seekForwardLong', label: 'Skip Forward (60 s)', group: 'Playback', scope: 'player', defaults: ['shift+right'] },
  { id: 'media.next', label: 'Next', group: 'Playback', scope: 'player', defaults: ['n', 'shift+n'], menu: 'Playback' },
  { id: 'media.previous', label: 'Previous', group: 'Playback', scope: 'player', defaults: ['shift+p'], menu: 'Playback' },
  { id: 'media.volumeUp', label: 'Volume Up', group: 'Playback', scope: 'player', defaults: ['up'], menu: 'Playback' },
  { id: 'media.volumeDown', label: 'Volume Down', group: 'Playback', scope: 'player', defaults: ['down'], menu: 'Playback' },
  { id: 'media.mute', label: 'Mute', group: 'Playback', scope: 'player', defaults: ['m'], menu: 'Playback' },
  { id: 'media.speedUp', label: 'Increase Speed', group: 'Playback', scope: 'player', defaults: [']'], menu: 'Playback' },
  { id: 'media.speedDown', label: 'Decrease Speed', group: 'Playback', scope: 'player', defaults: ['['], menu: 'Playback' },
  { id: 'media.speedReset', label: 'Normal Speed', group: 'Playback', scope: 'player', defaults: ['backspace'], menu: 'Playback' },
  { id: 'media.speedFine', label: 'Open Speed Dial', group: 'Playback', scope: 'player', defaults: ['s'] },
  { id: 'media.frameForward', label: 'Next Frame', group: 'Playback', scope: 'player', defaults: ['.'] },
  { id: 'media.frameBack', label: 'Previous Frame', group: 'Playback', scope: 'player', defaults: [','] },
  { id: 'media.jumpStart', label: 'Restart', group: 'Playback', scope: 'player', defaults: ['home'] },

  // Video
  { id: 'video.subtitles', label: 'Toggle Subtitles', group: 'Video', scope: 'player', defaults: ['c'], menu: 'Playback' },
  { id: 'video.subtitleNext', label: 'Next Subtitle Track', group: 'Video', scope: 'player', defaults: ['shift+c'] },
  { id: 'video.subDelayMinus', label: 'Subtitles Earlier (−0.1 s)', group: 'Video', scope: 'player', defaults: ['z'] },
  { id: 'video.subDelayPlus', label: 'Subtitles Later (+0.1 s)', group: 'Video', scope: 'player', defaults: ['x'] },
  { id: 'video.audioNext', label: 'Next Audio Track', group: 'Video', scope: 'player', defaults: ['a'], menu: 'Playback' },
  { id: 'video.chapterNext', label: 'Next Chapter', group: 'Video', scope: 'player', defaults: ['pagedown'] },
  { id: 'video.chapterPrev', label: 'Previous Chapter', group: 'Video', scope: 'player', defaults: ['pageup'] },
  { id: 'video.skipSegment', label: 'Skip Intro / Credits', group: 'Video', scope: 'player', defaults: ['shift+k'] },
  { id: 'video.markIntroStart', label: 'Mark Intro Start', group: 'Video', scope: 'player', defaults: [] },
  { id: 'video.markIntroEnd', label: 'Mark Intro End (Remember for This Show)', group: 'Video', scope: 'player', defaults: [] },
  { id: 'video.markCredits', label: 'Mark Credits Start (Remember for This Show)', group: 'Video', scope: 'player', defaults: [] },
  { id: 'video.clearSkipMarkers', label: 'Forget Skip Markers for This Show', group: 'Video', scope: 'player', defaults: [] },
  { id: 'video.pip', label: 'Picture in Picture', group: 'Video', scope: 'player', defaults: ['mod+alt+p'], menu: 'Playback' },
  { id: 'video.stats', label: 'Playback Statistics', group: 'Video', scope: 'player', defaults: ['i'] },
  { id: 'video.aspect', label: 'Cycle Aspect (Fit / Fill / Stretch)', group: 'Video', scope: 'player', defaults: ['shift+a'] },
  { id: 'video.screenshot', label: 'Save Screenshot', group: 'Video', scope: 'player', defaults: ['shift+s'] },
  { id: 'video.close', label: 'Close Player', group: 'Video', scope: 'player', defaults: ['escape'] },
  ...Array.from({ length: 10 }, (_, n) => ({ id: `video.percent${n}`, label: `Jump to ${n * 10}%`, group: 'Video', scope: 'player' as const, defaults: [String(n)] })),

  // Music
  { id: 'music.shuffle', label: 'Shuffle', group: 'Music', scope: 'music', defaults: ['mod+shift+s'], menu: 'Playback' },
  { id: 'music.repeat', label: 'Repeat', group: 'Music', scope: 'music', defaults: ['mod+shift+r'], menu: 'Playback' },
  { id: 'music.lyrics', label: 'Lyrics', group: 'Music', scope: 'music', defaults: ['mod+shift+l'] },
  { id: 'music.queue', label: 'Queue', group: 'Music', scope: 'music', defaults: ['mod+shift+q'] },
  { id: 'music.like', label: 'Favourite Current Track', group: 'Music', scope: 'music', defaults: ['mod+shift+f'] },
  { id: 'music.nowPlaying', label: 'Open Now Playing', group: 'Music', scope: 'music', defaults: ['mod+shift+n'] },

  // Reader
  { id: 'reader.next', label: 'Next Page', group: 'Reader', scope: 'reader', defaults: ['right', 'space', 'pagedown', 'd'] },
  { id: 'reader.prev', label: 'Previous Page', group: 'Reader', scope: 'reader', defaults: ['left', 'shift+space', 'pageup', 'a'] },
  { id: 'reader.nextAlt', label: 'Next Page (alternate)', group: 'Reader', scope: 'reader', defaults: ['down'] },
  { id: 'reader.prevAlt', label: 'Previous Page (alternate)', group: 'Reader', scope: 'reader', defaults: ['up'] },
  { id: 'reader.first', label: 'First Page', group: 'Reader', scope: 'reader', defaults: ['home'] },
  { id: 'reader.last', label: 'Last Page', group: 'Reader', scope: 'reader', defaults: ['end'] },
  { id: 'reader.zoomIn', label: 'Zoom In', group: 'Reader', scope: 'reader', defaults: ['=', '+'] },
  { id: 'reader.zoomOut', label: 'Zoom Out', group: 'Reader', scope: 'reader', defaults: ['-'] },
  { id: 'reader.zoomReset', label: 'Reset Zoom', group: 'Reader', scope: 'reader', defaults: ['0'] },
  { id: 'reader.fit', label: 'Cycle Fit Mode', group: 'Reader', scope: 'reader', defaults: ['w'] },
  { id: 'reader.direction', label: 'Toggle Reading Direction', group: 'Reader', scope: 'reader', defaults: ['r'] },
  { id: 'reader.mode', label: 'Cycle Page Layout', group: 'Reader', scope: 'reader', defaults: ['v'] },
  { id: 'reader.nextChapter', label: 'Next Chapter / Volume', group: 'Reader', scope: 'reader', defaults: [']'] },
  { id: 'reader.prevChapter', label: 'Previous Chapter / Volume', group: 'Reader', scope: 'reader', defaults: ['['] },
  { id: 'reader.toc', label: 'Contents / Pages', group: 'Reader', scope: 'reader', defaults: ['t'] },
  { id: 'reader.settings', label: 'Reader Settings', group: 'Reader', scope: 'reader', defaults: ['o'] },
  { id: 'reader.close', label: 'Close Reader', group: 'Reader', scope: 'reader', defaults: ['escape'] }
];

export const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

export type Keymap = Record<string, string[]>;

export function effectiveKeymap(overrides: Keymap): Keymap {
  const out: Keymap = {};
  for (const a of ACTIONS) out[a.id] = overrides[a.id] ?? a.defaults;
  return out;
}

const MOD_ORDER = ['mod', 'ctrl', 'alt', 'shift'];

const KEY_ALIASES: Record<string, string> = {
  ' ': 'space', spacebar: 'space', arrowleft: 'left', arrowright: 'right', arrowup: 'up', arrowdown: 'down',
  esc: 'escape', del: 'delete', return: 'enter'
};

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Normalise a keyboard event into the combo format. Returns null for bare modifier presses. */
export function eventToCombo(e: KeyLike, isMac: boolean): string | null {
  const lower = e.key.toLowerCase();
  const key = KEY_ALIASES[lower] ?? lower;
  if (['control', 'shift', 'alt', 'meta', 'os', 'altgraph', 'dead', 'unidentified'].includes(key)) return null;
  const mods: string[] = [];
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod) mods.push('mod');
  // On macOS the physical Ctrl key remains distinct from Cmd; elsewhere Meta/Win is ignored.
  if (isMac && e.ctrlKey) mods.push('ctrl');
  if (e.altKey) mods.push('alt');
  // Symbols already encode shift ("?" is shift+/): don't double count.
  const isSymbol = key.length === 1 && !/[a-z0-9]/.test(key);
  if (e.shiftKey && !isSymbol) mods.push('shift');
  return [...sortMods(mods), key].join('+');
}

function sortMods(mods: string[]): string[] {
  return [...new Set(mods)].sort((a, b) => MOD_ORDER.indexOf(a) - MOD_ORDER.indexOf(b));
}

/** Canonicalise a user- or default-supplied combo ("Shift+Mod+F" → "mod+shift+f"). */
export function normalizeCombo(combo: string): string {
  const parts = combo === '+' ? ['+'] : combo.toLowerCase().split(/\+(?=.)/);
  const key = parts.pop() ?? '';
  const mods = parts.map((m) => (m === 'cmd' || m === 'command' || m === 'meta' || m === 'cmdorctrl' ? 'mod' : m === 'control' ? 'ctrl' : m === 'option' ? 'alt' : m));
  return [...sortMods(mods), KEY_ALIASES[key] ?? key].join('+');
}

const MAC_SYMBOLS: Record<string, string> = { mod: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' };
const KEY_LABELS: Record<string, string> = {
  left: '←', right: '→', up: '↑', down: '↓', space: 'Space', escape: 'Esc', enter: '↩', backspace: '⌫',
  delete: '⌦', pageup: 'Page Up', pagedown: 'Page Down', home: 'Home', end: 'End', tab: '⇥'
};

export function comboLabel(combo: string, isMac: boolean): string {
  const parts = combo === '+' ? ['+'] : combo.split(/\+(?=.)/);
  const key = parts.pop() ?? '';
  const keyLabel = KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key.replace(/^f(\d+)$/, 'F$1'));
  if (isMac) return [...parts.map((m) => MAC_SYMBOLS[m] ?? m), keyLabel].join('');
  return [...parts.map((m) => (m === 'mod' ? 'Ctrl' : m[0]!.toUpperCase() + m.slice(1))), keyLabel].join('+');
}

/** Electron accelerator string for a combo, or null if it can't be expressed (or has no modifier). */
export function toAccelerator(combo: string): string | null {
  const parts = combo === '+' ? ['+'] : combo.split(/\+(?=.)/);
  const key = parts.pop() ?? '';
  if (parts.length === 0) return null;
  const map: Record<string, string> = { mod: 'CmdOrCtrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' };
  const keyMap: Record<string, string> = {
    left: 'Left', right: 'Right', up: 'Up', down: 'Down', space: 'Space', escape: 'Esc', enter: 'Enter',
    backspace: 'Backspace', delete: 'Delete', pageup: 'PageUp', pagedown: 'PageDown', home: 'Home', end: 'End', tab: 'Tab'
  };
  const k = keyMap[key] ?? (key.length === 1 ? key.toUpperCase() : /^f\d+$/.test(key) ? key.toUpperCase() : null);
  if (!k) return null;
  return [...parts.map((m) => map[m] ?? m), k].join('+');
}

export interface Conflict { combo: string; actions: string[] }

/** Find combos bound to more than one action whose scopes can be active at the same time. */
export function findConflicts(map: Keymap): Conflict[] {
  const byCombo = new Map<string, string[]>();
  for (const [id, combos] of Object.entries(map)) {
    for (const c of combos) {
      const n = normalizeCombo(c);
      byCombo.set(n, [...(byCombo.get(n) ?? []), id]);
    }
  }
  const out: Conflict[] = [];
  for (const [combo, ids] of byCombo) {
    if (ids.length < 2) continue;
    const scopes = ids.map((id) => ACTION_BY_ID.get(id)?.scope ?? 'global');
    // player/music/reader are mutually exclusive contexts; only global overlaps everything.
    const clash = ids.filter((_, i) => scopes.some((s, j) => j !== i && (s === scopes[i] || s === 'global' || scopes[i] === 'global')));
    if (clash.length >= 2) out.push({ combo, actions: clash });
  }
  return out;
}
