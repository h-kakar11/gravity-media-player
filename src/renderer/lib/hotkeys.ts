import { useEffect } from 'react';
import { ACTION_BY_ID, ACTIONS, effectiveKeymap, eventToCombo, normalizeCombo, type HotkeyScope, type Keymap } from '@shared/hotkeys';
import { isMac } from '../api';
import { useMusic } from '../state/music';
import { useReader } from '../state/reader';
import { useSettings } from '../state/settings';
import { useUi } from '../state/ui';
import { useVideo } from '../state/video';

/** Handlers return `false` to say "not mine" so a lower-priority handler can take the key. */
type Handler = (e?: KeyboardEvent) => boolean | void;
const handlers = new Map<string, Set<Handler>>();

export function registerHandler(actionId: string, fn: Handler): () => void {
  let set = handlers.get(actionId);
  if (!set) handlers.set(actionId, (set = new Set()));
  set.add(fn);
  return () => { set!.delete(fn); };
}

export function registerHandlers(map: Record<string, Handler>): () => void {
  const offs = Object.entries(map).map(([id, fn]) => registerHandler(id, fn));
  return () => offs.forEach((o) => o());
}

let lastDispatch = { id: '', at: 0 };

/** While the keymap editor is recording a shortcut, the dispatcher must not act on the keystrokes. */
export const hotkeyCapture = { active: false };

/** Run an action by id (from the menu bar, a hotkey or a button). Returns whether anything handled it. */
export function dispatchAction(id: string, e?: KeyboardEvent): boolean {
  const now = performance.now();
  // The native menu and the keydown listener can both see the same keystroke on some platforms.
  if (lastDispatch.id === id && now - lastDispatch.at < 60 && !e) return true;
  const set = handlers.get(id);
  if (!set) return false;
  // Most recently registered handler wins (players register while mounted).
  for (const fn of [...set].reverse()) {
    if (fn(e) !== false) { lastDispatch = { id, at: now }; return true; }
  }
  return false;
}

export function activeScopes(): HotkeyScope[] {
  const scopes: HotkeyScope[] = [];
  if (useVideo.getState().open) scopes.push('player');
  else if (useReader.getState().item) scopes.push('reader');
  else if (useMusic.getState().queue.length > 0) scopes.push('player', 'music');
  scopes.push('global');
  return scopes;
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

/** Window-level keyboard dispatcher driven by the user's keymap. */
export function useHotkeyDispatcher(): void {
  useEffect(() => {
    let map: Keymap = effectiveKeymap(useSettings.getState().settings.hotkeys);
    let byCombo = indexKeymap(map);
    const unsub = useSettings.subscribe((s, prev) => {
      if (s.settings.hotkeys !== prev.settings.hotkeys) { map = effectiveKeymap(s.settings.hotkeys); byCombo = indexKeymap(map); }
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || hotkeyCapture.active) return;
      const combo = eventToCombo(e, isMac);
      if (!combo) return;
      const hasMod = combo.includes('mod+') || combo.includes('ctrl+') || combo.includes('alt+');
      if (isTyping(e.target) && !hasMod) return;
      if (useUi.getState().sheet && !hasMod) return;
      const ids = byCombo.get(combo);
      if (!ids) return;
      const scopes = activeScopes();
      const candidates = ids
        .map((id) => ({ id, scope: ACTION_BY_ID.get(id)!.scope }))
        .filter((a) => scopes.includes(a.scope))
        .sort((a, b) => scopes.indexOf(a.scope) - scopes.indexOf(b.scope));
      for (const c of candidates) {
        if (dispatchAction(c.id, e)) { e.preventDefault(); e.stopPropagation(); return; }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); unsub(); };
  }, []);
}

function indexKeymap(map: Keymap): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const a of ACTIONS) {
    for (const c of map[a.id] ?? []) {
      const n = normalizeCombo(c);
      out.set(n, [...(out.get(n) ?? []), a.id]);
    }
  }
  return out;
}
