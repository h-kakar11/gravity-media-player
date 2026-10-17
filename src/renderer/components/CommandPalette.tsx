import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { ACTIONS, comboLabel, effectiveKeymap } from '@shared/hotkeys';
import { rankEntries } from '@shared/palette';
import type { SearchResults } from '@shared/types';
import { invoke, isMac } from '../api';
import { openMedia } from '../lib/actions';
import { useDebounced } from '../lib/hooks';
import { activeScopes, dispatchAction, registerHandler } from '../lib/hotkeys';
import { SIDEBAR } from '../lib/sidebar';
import { navigate } from '../state/router';
import { useSettings } from '../state/settings';
import '../styles/palette.css';

interface PaletteState { open: boolean; toggle: () => void; close: () => void }
export const usePalette = create<PaletteState>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false })
}));

interface Command {
  id: string;
  label: string;
  group: string;
  keywords?: string;
  shortcut?: string;
  run: () => void;
}

const SIDEBAR_NAV = new Set(Object.keys(SIDEBAR).map((id) => `nav.${id}`));
/** Actions that make no sense as a palette entry (digits, repeated seek keys, the palette itself). */
const SKIP = (id: string) => id === 'app.palette' || id.startsWith('video.percent') || id.endsWith('Long') || SIDEBAR_NAV.has(id) || id === 'video.close' || id === 'reader.close';

function buildCommands(): Command[] {
  const map = effectiveKeymap(useSettings.getState().settings.hotkeys);
  const shortcut = (id: string) => (map[id]?.[0] ? comboLabel(map[id]![0]!, isMac) : undefined);
  const out: Command[] = Object.values(SIDEBAR).map((s) => ({
    id: `go.${s.id}`, label: `Go to ${s.label}`, group: 'Go', keywords: s.label, shortcut: shortcut(`nav.${s.id}`), run: () => navigate(s.route)
  }));
  const scopes = activeScopes();
  for (const a of ACTIONS) {
    if (SKIP(a.id) || !scopes.includes(a.scope)) continue;
    out.push({ id: a.id, label: a.label, group: a.group, shortcut: shortcut(a.id), run: () => { dispatchAction(a.id); } });
  }
  return out;
}

export function CommandPalette() {
  const open = usePalette((s) => s.open);
  useEffect(() => registerHandler('app.palette', () => { usePalette.getState().toggle(); }), []);
  return open ? <PaletteDialog /> : null;
}

function PaletteDialog() {
  const close = usePalette((s) => s.close);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<SearchResults | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const commands = useMemo(buildCommands, []);
  const debounced = useDebounced(text.trim(), 160);

  // Hand focus back to wherever it was when the palette closes, so typing and hotkeys keep working.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => { prev?.focus?.(); };
  }, []);

  useEffect(() => {
    if (debounced.length < 2) { setResults(null); return; }
    let stale = false;
    invoke('library:search', debounced).then((r) => { if (!stale) setResults(r); }, () => { if (!stale) setResults(null); });
    return () => { stale = true; };
  }, [debounced]);

  const rows = useMemo<Command[]>(() => {
    const q = text.trim();
    const found = rankEntries(commands, q, q ? 8 : 40);
    const lib: Command[] = [];
    if (q.length >= 2) {
      if (results && debounced === q) {
        for (const s of results.series.slice(0, 3)) lib.push({ id: `s.${s.type}.${s.key}`, label: s.title, group: s.type === 'show' ? 'Show' : 'Series', run: () => navigate(s.type === 'show' ? { name: 'show', key: s.key } : { name: 'series', key: s.key }) });
        for (const a of results.albums.slice(0, 3)) lib.push({ id: `a.${a.key}`, label: a.album, group: `Album · ${a.artist}`, run: () => navigate({ name: 'album', key: a.key }) });
        for (const a of results.artists.slice(0, 2)) lib.push({ id: `r.${a.key}`, label: a.name, group: 'Artist', run: () => navigate({ name: 'artist', key: a.key }) });
        for (const m of results.media.slice(0, 5)) lib.push({ id: `m.${m.id}`, label: m.title, group: m.kind === 'audio' ? 'Song' : m.kind === 'video' ? 'Video' : m.kind[0]!.toUpperCase() + m.kind.slice(1), run: () => openMedia(m, results.media.filter((x) => x.kind === m.kind)) });
      }
      lib.push({ id: 'search.all', label: `Search library for “${q}”`, group: 'Search', run: () => navigate({ name: 'search', q }) });
    }
    return [...found, ...lib];
  }, [commands, text, results, debounced]);

  useEffect(() => { setActive(0); }, [text]);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active, rows]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    close();
    // Let focus return first so actions that read the focused element behave as if typed.
    setTimeout(c.run, 0);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (rows.length ? (a + 1) % rows.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (rows.length ? (a - 1 + rows.length) % rows.length : 0)); }
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); run(rows[active]); }
  };

  return createPortal(
    <div className="palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="palette" role="dialog" aria-label="Command palette" onKeyDown={onKey}>
        <label className="palette__field">
          <Search size={16} strokeWidth={2} aria-hidden />
          <input
            ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} autoComplete="off"
            placeholder="Type a command, or search your library…" role="combobox" aria-expanded aria-controls="palette-list" aria-activedescendant={rows[active] ? `palette-${rows[active]!.id}` : undefined}
          />
        </label>
        <div className="palette__list" id="palette-list" role="listbox" ref={listRef}>
          {rows.length === 0 && <div className="palette__empty secondary">No matching commands</div>}
          {rows.map((c, i) => (
            <button
              key={c.id} id={`palette-${c.id}`} type="button" role="option" aria-selected={i === active} tabIndex={-1}
              className={`palette__row ${i === active ? 'is-active' : ''}`}
              onMouseMove={() => { if (i !== active) setActive(i); }} onClick={() => run(c)}
            >
              <span className="palette__label truncate">{c.label}</span>
              <span className="palette__group truncate">{c.group}</span>
              {c.shortcut && <kbd className="kbd">{c.shortcut}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
