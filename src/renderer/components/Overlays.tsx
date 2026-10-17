import { Check, ChevronRight, Plus } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatBitrate, formatBytes, formatDuration, formatFps, formatResolution } from '@shared/format';
import { ACTIONS, comboLabel, effectiveKeymap } from '@shared/hotkeys';
import type { MediaItem } from '@shared/types';
import { invoke, isMac } from '../api';
import { useLibraryQuery } from '../lib/hooks';
import { useLibrary } from '../state/library';
import { useSettings } from '../state/settings';
import { toast, useUi, type MenuEntry } from '../state/ui';
import { Button, Icon, Rating } from './ui';

// ---------------------------------------------------------------------------
// Context menu

export function ContextMenuHost() {
  const menu = useUi((s) => s.menu);
  const close = useUi((s) => s.closeMenu);
  if (!menu) return null;
  return <MenuPanel key={`${menu.x},${menu.y}`} x={menu.x} y={menu.y} entries={menu.entries} onClose={close} root above={menu.above} minWidth={menu.minWidth} />;
}

function MenuPanel({ x, y, entries, onClose, root, above, minWidth }: { x: number; y: number; entries: MenuEntry[]; onClose: () => void; root?: boolean; above?: boolean; minWidth?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [active, setActive] = useState(-1);
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null);
  const actionable = entries.map((e, i) => (e.separator || e.disabled ? -1 : i)).filter((i) => i >= 0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const top = above ? y - r.height : y;
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(top, window.innerHeight - r.height - 8)) });
  }, [x, y, above]);

  useEffect(() => {
    if (!root) return;
    const down = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.menu')) onClose(); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const idx = actionable.indexOf(active);
        const next = e.key === 'ArrowDown' ? actionable[(idx + 1) % actionable.length] : actionable[(idx <= 0 ? actionable.length : idx) - 1];
        setActive(next ?? -1);
      } else if (e.key === 'Enter' && active >= 0) {
        e.preventDefault();
        const entry = entries[active]!;
        if (entry.run) { onClose(); entry.run(); }
      }
    };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => { document.removeEventListener('mousedown', down, true); document.removeEventListener('keydown', key, true); window.removeEventListener('blur', onClose); window.removeEventListener('resize', onClose); };
  }, [root, onClose, active, entries]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="menu" ref={ref} style={{ left: pos.left, top: pos.top, minWidth }} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {entries.map((e, i) =>
        e.separator ? (
          <div key={i} className="menu__sep" role="separator" />
        ) : (
          <button
            key={i} type="button" role="menuitem" disabled={e.disabled}
            className={`menu__item ${e.danger ? 'is-danger' : ''} ${active === i ? 'is-active' : ''}`}
            onMouseEnter={(ev) => {
              setActive(i);
              if (e.submenu) { const r = (ev.currentTarget as HTMLElement).getBoundingClientRect(); setSub({ index: i, x: r.right - 4, y: r.top - 6 }); } else setSub(null);
            }}
            onClick={() => { if (e.submenu) return; onClose(); e.run?.(); }}
          >
            <span className="menu__check">{e.checked && <Check size={13} strokeWidth={2.6} />}</span>
            {e.icon && <span className="menu__icon">{e.icon}</span>}
            <span className="menu__label truncate">{e.label}</span>
            {e.shortcut && <span className="menu__shortcut">{e.shortcut}</span>}
            {e.submenu && <ChevronRight size={13} strokeWidth={2.2} className="menu__chev" />}
          </button>
        )
      )}
      {sub && entries[sub.index]?.submenu && <MenuPanel x={sub.x} y={sub.y} entries={entries[sub.index]!.submenu!.map((s) => ({ ...s, run: s.run ? () => { onClose(); s.run!(); } : undefined }))} onClose={onClose} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`}>
          <span>{t.message}</span>
          {t.action && <button type="button" className="toast__action" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sheets

export function SheetHost() {
  const sheet = useUi((s) => s.sheet);
  const close = useUi((s) => s.closeSheet);
  useEffect(() => {
    if (!sheet) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (sheet.type === 'confirm') sheet.resolve(false);
        if (sheet.type === 'prompt') sheet.resolve(null);
        close();
      }
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [sheet, close]);
  if (!sheet) return null;
  const dismiss = () => {
    if (sheet.type === 'confirm') sheet.resolve(false);
    if (sheet.type === 'prompt') sheet.resolve(null);
    close();
  };
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) dismiss(); }}>
      {sheet.type === 'confirm' && <ConfirmSheet sheet={sheet} close={close} />}
      {sheet.type === 'prompt' && <PromptSheet sheet={sheet} close={close} />}
      {sheet.type === 'playlist-picker' && <PlaylistPicker ids={sheet.mediaIds} close={close} />}
      {sheet.type === 'shortcuts' && <ShortcutsSheet close={close} />}
      {sheet.type === 'info' && <InfoSheet id={sheet.mediaId} close={close} />}
    </div>
  );
}

function ConfirmSheet({ sheet, close }: { sheet: Extract<NonNullable<ReturnType<typeof useUi.getState>['sheet']>, { type: 'confirm' }>; close: () => void }) {
  return (
    <div className="sheet sheet--alert" role="alertdialog" aria-labelledby="sheet-title" aria-describedby="sheet-msg">
      <h2 id="sheet-title" className="t-headline">{sheet.title}</h2>
      <p id="sheet-msg" className="secondary t-callout">{sheet.message}</p>
      <div className="sheet__actions">
        <Button onClick={() => { sheet.resolve(false); close(); }}>Cancel</Button>
        <Button variant={sheet.destructive ? 'danger' : 'primary'} onClick={() => { sheet.resolve(true); close(); }} autoFocus={!sheet.destructive}>{sheet.confirmLabel}</Button>
      </div>
    </div>
  );
}

function PromptSheet({ sheet, close }: { sheet: Extract<NonNullable<ReturnType<typeof useUi.getState>['sheet']>, { type: 'prompt' }>; close: () => void }) {
  const [value, setValue] = useState(sheet.value);
  const submit = () => { sheet.resolve(value.trim() || null); close(); };
  return (
    <form className="sheet sheet--alert" role="dialog" aria-labelledby="sheet-title" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <h2 id="sheet-title" className="t-headline">{sheet.title}</h2>
      {sheet.message && <p className="secondary t-callout">{sheet.message}</p>}
      <input className="field" autoFocus value={value} placeholder={sheet.placeholder} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} aria-label={sheet.title} />
      <div className="sheet__actions">
        <Button onClick={() => { sheet.resolve(null); close(); }}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={!value.trim()}>{sheet.confirmLabel}</Button>
      </div>
    </form>
  );
}

function PlaylistPicker({ ids, close }: { ids: number[]; close: () => void }) {
  const playlists = useLibrary((s) => s.playlists);
  const add = async (id: number, name: string) => {
    await invoke('playlists:add', id, ids);
    await useLibrary.getState().refreshPlaylists();
    toast('success', `Added ${ids.length === 1 ? '1 item' : `${ids.length} items`} to “${name}”`);
    close();
  };
  const create = async () => {
    const name = await useUi.getState().prompt({ title: 'New Playlist', placeholder: 'My Playlist', confirmLabel: 'Create' });
    if (!name) return;
    const p = await invoke('playlists:create', name, ids);
    await useLibrary.getState().refreshPlaylists();
    toast('success', `Created “${p.name}”`);
  };
  return (
    <div className="sheet" role="dialog" aria-label="Add to playlist">
      <h2 className="t-headline">Add to Playlist</h2>
      <ul className="picker">
        <li><button type="button" className="picker__row" onClick={() => { close(); void create(); }}><span className="picker__new"><Plus size={16} strokeWidth={2.4} /></span>New Playlist…</button></li>
        {playlists.map((p) => (
          <li key={p.id}><button type="button" className="picker__row" onClick={() => void add(p.id, p.name)}><span className="picker__count tabular">{p.itemCount}</span>{p.name}</button></li>
        ))}
      </ul>
      <div className="sheet__actions"><Button onClick={close}>Cancel</Button></div>
    </div>
  );
}

function ShortcutsSheet({ close }: { close: () => void }) {
  const overrides = useSettings((s) => s.settings.hotkeys);
  const map = effectiveKeymap(overrides);
  const groups = [...new Set(ACTIONS.map((a) => a.group))];
  return (
    <div className="sheet sheet--wide" role="dialog" aria-label="Keyboard shortcuts">
      <h2 className="t-title-3">Keyboard Shortcuts</h2>
      <p className="secondary t-subhead">Change any of these in Settings → Keyboard.</p>
      <div className="shortcuts">
        {groups.map((g) => (
          <section key={g}>
            <h3 className="t-caps">{g}</h3>
            {ACTIONS.filter((a) => a.group === g).map((a) => (
              <div key={a.id} className="shortcuts__row">
                <span>{a.label}</span>
                <span className="shortcuts__keys">{(map[a.id] ?? []).slice(0, 2).map((c) => <kbd key={c} className="kbd">{comboLabel(c, isMac)}</kbd>)}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
      <div className="sheet__actions"><Button variant="primary" onClick={close}>Done</Button></div>
    </div>
  );
}

function InfoSheet({ id, close }: { id: number; close: () => void }) {
  const { data: item } = useLibraryQuery(async () => (await invoke('library:get', [id]))[0] as MediaItem | undefined, [id]);
  const [notes, setNotes] = useState<string | null>(null);
  if (!item) return null;
  const save = async (patch: { rating?: number; notes?: string }) => {
    await invoke('state:update', item.id, patch);
    useLibrary.setState((s) => ({ revision: s.revision + 1 }));
  };
  const rows: [string, string][] = [
    ['Kind', item.kind === 'video' ? (item.vclass ?? 'video') : item.kind],
    ['Path', item.path],
    ['Size', formatBytes(item.size)],
    ...(item.durationSec ? [['Duration', formatDuration(item.durationSec)] as [string, string]] : []),
    ...(item.width ? [['Dimensions', `${item.width} × ${item.height}${item.kind === 'video' ? ` (${formatResolution(item.width, item.height)})` : ''}`] as [string, string]] : []),
    ...(item.fps ? [['Frame rate', formatFps(item.fps)] as [string, string]] : []),
    ...(item.vcodec ? [['Video', `${item.vcodec.toUpperCase()}${item.bitDepth > 8 ? ` ${item.bitDepth}-bit` : ''}${item.hdr ? ' · HDR' : ''}`] as [string, string]] : []),
    ...(item.acodec ? [['Audio', `${item.acodec.toUpperCase()}${item.channels ? ` · ${item.channels} ch` : ''}${item.sampleRate ? ` · ${item.sampleRate / 1000} kHz` : ''}`] as [string, string]] : []),
    ...(item.bitrate ? [['Bitrate', formatBitrate(item.bitrate)] as [string, string]] : []),
    ...(item.album ? [['Album', item.album] as [string, string]] : []),
    ...(item.genre ? [['Genre', item.genre] as [string, string]] : []),
    ['Added', new Date(item.addedAt).toLocaleString()],
    ['Modified', new Date(item.mtimeMs).toLocaleString()],
    ['Plays', String(item.playCount)]
  ];
  return (
    <div className="sheet sheet--wide" role="dialog" aria-label="Get Info">
      <h2 className="t-title-3 truncate">{item.title}</h2>
      <dl className="info-list">
        {rows.map(([k, v]) => <div key={k} className="info-list__row"><dt>{k}</dt><dd className={k === 'Path' ? 'info-list__path' : ''}>{v}</dd></div>)}
      </dl>
      <div className="info-edit">
        <div><div className="t-caps">Rating</div><Rating value={item.rating} onChange={(v) => void save({ rating: v })} size={20} /></div>
        <label className="info-edit__notes">
          <span className="t-caps">Notes</span>
          <textarea className="field field--area" rows={3} placeholder="Add personal notes about this title…" defaultValue={item.notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes != null && void save({ notes })} />
        </label>
      </div>
      <div className="sheet__actions"><Button variant="primary" onClick={() => { if (notes != null) void save({ notes }); close(); }}>Done</Button></div>
    </div>
  );
}

export { Icon };
