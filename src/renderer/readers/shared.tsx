import { ChevronDown, Settings2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { MediaItem } from '@shared/types';
import { invoke, quiet } from '../api';
import { IconButton } from '../components/ui';
import { useReader } from '../state/reader';

/**
 * Tracks active reading time (for statistics) and saves progress with a debounce.
 * Time only counts while the window is visible and the reader was touched in the last 90 seconds.
 */
export function useReadingSession(item: MediaItem) {
  const startedAt = useRef(Date.now());
  const active = useRef(0);
  const lastTouch = useRef(performance.now());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ location?: string | null; progress: number; completed?: boolean } | null>(null);

  useEffect(() => {
    const iv = setInterval(() => {
      if (document.visibilityState === 'visible' && performance.now() - lastTouch.current < 90_000) active.current += 1;
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  const flushProgress = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const p = pending.current;
    pending.current = null;
    if (p) quiet(invoke('state:progress', { mediaId: item.id, location: p.location, progress: p.progress, completed: p.completed }));
  }, [item.id]);

  useEffect(() => () => {
    flushProgress();
    if (active.current >= 8) quiet(invoke('history:record', { mediaId: item.id, startedAt: startedAt.current, watchedSec: active.current, mediaSec: active.current, fromSec: 0, toSec: 0, speed: 1 }));
  }, [item.id, flushProgress]);

  const touch = useCallback(() => { lastTouch.current = performance.now(); }, []);
  const save = useCallback((location: string | null, progress: number, completed?: boolean) => {
    touch();
    pending.current = { location, progress, completed };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushProgress, 700);
  }, [flushProgress, touch]);

  return { save, touch, flushProgress };
}

/** Top bar and bottom bar that fade away while reading and return on pointer movement. */
export function useAutoHide(ms = 2600) {
  const [visible, setVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinned = useRef(false);
  const poke = useCallback(() => {
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (!pinned.current) setVisible(false); }, ms);
  }, [ms]);
  useEffect(() => { poke(); return () => { if (timer.current) clearTimeout(timer.current); }; }, [poke]);
  const pin = (on: boolean) => { pinned.current = on; if (on) setVisible(true); else poke(); };
  return { visible, poke, pin, toggle: () => setVisible((v) => !v) };
}

export function ReaderTop({ title, subtitle, visible, children, onSettings, settingsOpen }: { title: string; subtitle?: string; visible: boolean; children?: ReactNode; onSettings?: () => void; settingsOpen?: boolean }) {
  return (
    <div className={`rtop ${visible ? '' : 'is-hidden'}`}>
      <button type="button" className="glass-btn" onClick={() => useReader.getState().close()} aria-label="Close reader" title="Close (Esc)"><ChevronDown size={18} strokeWidth={2.2} /></button>
      <div className="rtop__title"><div className="truncate rtop__name">{title}</div>{subtitle && <div className="truncate rtop__sub">{subtitle}</div>}</div>
      <div className="rtop__actions">
        {children}
        {onSettings && <IconButton icon={Settings2} label="Reading settings" active={settingsOpen} onClick={onSettings} className="ctl" size={18} />}
      </div>
    </div>
  );
}

export function SettingGroup({ label, children }: { label: string; children: ReactNode }) {
  return <div className="rset__group"><div className="t-caps">{label}</div>{children}</div>;
}

export const READER_BG: Record<string, string> = { black: '#000', dark: '#17171a', sepia: '#f1e7d0', white: '#fff', system: 'var(--bg)' };
export const READER_FG: Record<string, string> = { black: '#fff', dark: '#fff', sepia: '#3b2f1e', white: '#111', system: 'var(--label)' };
