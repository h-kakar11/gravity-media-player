import { create } from 'zustand';
import type { ReactNode } from 'react';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
  action?: { label: string; run: () => void };
}

export interface MenuEntry {
  label?: string;
  icon?: ReactNode;
  shortcut?: string;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  submenu?: MenuEntry[];
  run?: () => void;
}

export interface ContextMenuState {
  x: number;
  y: number;
  entries: MenuEntry[];
  /** Open upward from (x, y) — used by menus anchored to a bottom control bar. */
  above?: boolean;
  minWidth?: number;
}

export type Sheet =
  | { type: 'confirm'; title: string; message: string; confirmLabel: string; destructive?: boolean; resolve: (ok: boolean) => void }
  | { type: 'prompt'; title: string; message?: string; value: string; placeholder?: string; confirmLabel: string; resolve: (v: string | null) => void }
  | { type: 'playlist-picker'; mediaIds: number[] }
  | { type: 'shortcuts' }
  | { type: 'info'; mediaId: number }
  | { type: 'rating-notes'; mediaId: number };

interface UiState {
  toasts: Toast[];
  menu: ContextMenuState | null;
  sheet: Sheet | null;
  infoPanel: boolean;
  dropActive: boolean;
  searchFocusTick: number;
  toast: (kind: Toast['kind'], message: string, action?: Toast['action']) => void;
  dismissToast: (id: number) => void;
  openMenu: (x: number, y: number, entries: MenuEntry[], opts?: { above?: boolean; minWidth?: number }) => void;
  closeMenu: () => void;
  openSheet: (s: Sheet) => void;
  closeSheet: () => void;
  confirm: (o: { title: string; message: string; confirmLabel?: string; destructive?: boolean }) => Promise<boolean>;
  prompt: (o: { title: string; message?: string; value?: string; placeholder?: string; confirmLabel?: string }) => Promise<string | null>;
  toggleInfo: () => void;
  focusSearch: () => void;
}

let toastId = 1;

export const useUi = create<UiState>((set, get) => ({
  toasts: [],
  menu: null,
  sheet: null,
  infoPanel: false,
  dropActive: false,
  searchFocusTick: 0,
  toast: (kind, message, action) => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message, action }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : action ? 6000 : 3600);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  openMenu: (x, y, entries, opts) => set({ menu: { x, y, entries, ...opts } }),
  closeMenu: () => set({ menu: null }),
  openSheet: (sheet) => set({ sheet }),
  closeSheet: () => set({ sheet: null }),
  confirm: (o) =>
    new Promise((resolve) =>
      set({ sheet: { type: 'confirm', title: o.title, message: o.message, confirmLabel: o.confirmLabel ?? 'OK', destructive: o.destructive, resolve } })
    ),
  prompt: (o) =>
    new Promise((resolve) =>
      set({ sheet: { type: 'prompt', title: o.title, message: o.message, value: o.value ?? '', placeholder: o.placeholder, confirmLabel: o.confirmLabel ?? 'OK', resolve } })
    ),
  toggleInfo: () => set((s) => ({ infoPanel: !s.infoPanel })),
  focusSearch: () => set((s) => ({ searchFocusTick: s.searchFocusTick + 1 }))
}));

export const toast = (kind: Toast['kind'], message: string, action?: Toast['action']) => useUi.getState().toast(kind, message, action);
