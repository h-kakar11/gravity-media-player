import { ChevronLeft, ChevronRight, PanelLeft, Search, Settings as SettingsIcon, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { isMac, platform } from '../api';
import { useDebounced } from '../lib/hooks';
import { navigate, useRouter } from '../state/router';
import { useSettings } from '../state/settings';
import { useUi } from '../state/ui';
import { IconButton } from './ui';

interface Targets { center: HTMLElement | null; right: HTMLElement | null; compact: boolean; compactTitle: string; scrolled: boolean }
export const useToolbar = create<Targets>(() => ({ center: null, right: null, compact: false, compactTitle: '', scrolled: false }));

/** Controls a view wants in the toolbar (view switcher, sort menu…). Rendered through a portal. */
export function ToolbarRight({ children }: { children: ReactNode }) {
  const el = useToolbar((s) => s.right);
  return el ? createPortal(children, el) : null;
}

export function Toolbar() {
  const canBack = useRouter((s) => s.index > 0);
  const canForward = useRouter((s) => s.index < s.stack.length - 1);
  const compact = useToolbar((s) => s.compact);
  const title = useToolbar((s) => s.compactTitle);
  const scrolled = useToolbar((s) => s.scrolled);
  const collapsed = useSettings((s) => s.settings.appearance.sidebarCollapsed);
  const update = useSettings((s) => s.update);

  return (
    <header className={`toolbar drag ${scrolled ? 'is-scrolled' : ''} ${collapsed && isMac ? 'toolbar--traffic' : ''}`}>
      <div className="toolbar__left no-drag">
        {collapsed && <IconButton icon={PanelLeft} label="Show Sidebar" onClick={() => update({ appearance: { sidebarCollapsed: false } })} />}
        {collapsed && <IconButton icon={SettingsIcon} label="Settings" onClick={() => navigate({ name: 'settings' })} />}
        <IconButton icon={ChevronLeft} label="Back" disabled={!canBack} onClick={() => useRouter.getState().back()} size={18} />
        <IconButton icon={ChevronRight} label="Forward" disabled={!canForward} onClick={() => useRouter.getState().forward()} size={18} />
        {collapsed && <SearchField className="no-drag" />}
      </div>
      <div className={`toolbar__title ${compact ? 'is-visible' : ''}`} aria-hidden={!compact}>{title}</div>
      <div className="toolbar__spacer" />
      <div className="toolbar__right no-drag" ref={(el) => { if (el !== useToolbar.getState().right) useToolbar.setState({ right: el }); }} />
    </header>
  );
}

/** One instance at a time: in the sidebar, or in the toolbar while the sidebar is hidden. */
export function SearchField({ className = '' }: { className?: string }) {
  const route = useRouter((s) => s.route);
  const tick = useUi((s) => s.searchFocusTick);
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const debounced = useDebounced(text, 200);
  const origin = useRef<number | null>(null);

  useEffect(() => { if (tick > 0) { ref.current?.focus(); ref.current?.select(); } }, [tick]);
  // Leaving the search route clears the field.
  useEffect(() => { if (route.name !== 'search') setText(''); else if (route.q !== text && document.activeElement !== ref.current) setText(route.q); }, [route]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const q = debounced.trim();
    if (!q) return;
    const r = useRouter.getState();
    if (r.route.name !== 'search') origin.current = r.index;
    navigate({ name: 'search', q }, { replace: r.route.name === 'search' });
  }, [debounced]);

  return (
    <label className={`search ${text ? 'has-text' : ''} ${className}`}>
      <Search size={14} strokeWidth={2} aria-hidden="true" />
      <input
        ref={ref} type="search" value={text} placeholder="Search" aria-label="Search library" spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setText(''); (e.target as HTMLInputElement).blur(); if (useRouter.getState().route.name === 'search') useRouter.getState().back(); }
        }}
      />
      {text && <button type="button" className="search__clear" aria-label="Clear search" onClick={() => { setText(''); ref.current?.focus(); }}><X size={12} strokeWidth={2.4} /></button>}
    </label>
  );
}

export const titleBarSafeRight = platform !== 'darwin';
