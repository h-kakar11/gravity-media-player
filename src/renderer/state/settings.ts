import { create } from 'zustand';
import { ACCENTS, DEFAULT_SETTINGS, mergeSettings, type Settings } from '@shared/settings';
import type { DeepPartial } from '@shared/ipc';
import { invoke, on } from '../api';

interface SettingsState {
  settings: Settings;
  ready: boolean;
  update: (patch: DeepPartial<Settings>) => void;
  reset: () => Promise<void>;
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: structuredClone(DEFAULT_SETTINGS),
  ready: false,
  update: (patch) => {
    // Optimistic: the UI reflects the change immediately; main confirms via settings:changed.
    set({ settings: mergeSettings(structuredClone(get().settings), patch) });
    void invoke('settings:set', patch).catch((err) => console.warn('settings:set failed', err));
  },
  reset: async () => {
    set({ settings: await invoke('settings:reset') });
  }
}));

export const getSettings = () => useSettings.getState().settings;

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Push settings into the document: theme, accent, text scale, motion/transparency preferences. */
export function applySettings(s: Settings, nativeMaterial: boolean): void {
  const root = document.documentElement;
  const a = s.appearance;
  root.dataset.theme = a.theme;
  root.dataset.material = nativeMaterial ? 'native' : 'css';
  root.dataset.density = a.density;
  root.style.setProperty('--text-scale', String(a.textScale));
  const accent = ACCENTS[a.accent] ?? (hexToRgb(a.accent) ? { light: a.accent, dark: a.accent } : ACCENTS.blue!);
  root.style.setProperty('--accent-l', accent.light);
  root.style.setProperty('--accent-d', accent.dark);
  const sidebar = { small: 200, medium: 236, large: 272 }[a.sidebarSize];
  root.style.setProperty('--sidebar-w', `${sidebar}px`);
  root.style.setProperty('--poster-w', `${a.posterSize}px`);
  const reduceMotion = a.reduceMotion === 'system' ? matchMedia('(prefers-reduced-motion: reduce)').matches : a.reduceMotion === 'on';
  const reduceTransparency = a.reduceTransparency === 'system' ? matchMedia('(prefers-reduced-transparency: reduce)').matches : a.reduceTransparency === 'on';
  root.dataset.reduceMotion = String(reduceMotion);
  root.dataset.reduceTransparency = String(reduceTransparency);
}

export async function initSettings(nativeMaterial: boolean): Promise<void> {
  const initial = await invoke('settings:get');
  useSettings.setState({ settings: initial, ready: true });
  applySettings(initial, nativeMaterial);
  on('settings:changed', (s) => {
    useSettings.setState({ settings: s });
    applySettings(s, nativeMaterial);
  });
  for (const q of ['(prefers-reduced-motion: reduce)', '(prefers-reduced-transparency: reduce)']) {
    matchMedia(q).addEventListener('change', () => applySettings(getSettings(), nativeMaterial));
  }
}
