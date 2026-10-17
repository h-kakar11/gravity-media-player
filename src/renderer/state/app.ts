import { create } from 'zustand';
import type { AppInfo, WindowState } from '@shared/types';
import { invoke, on } from '../api';

interface AppState {
  info: AppInfo | null;
  win: WindowState;
}

export const useApp = create<AppState>(() => ({
  info: null,
  win: { fullscreen: false, maximized: false, mode: 'normal', alwaysOnTop: false, focused: true }
}));

export async function initApp(): Promise<AppInfo> {
  const info = await invoke('app:info');
  useApp.setState({ info, win: await invoke('window:state') });
  on('window:state', (win) => useApp.setState({ win }));
  return info;
}
