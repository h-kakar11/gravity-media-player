import { ChevronDown, ChevronRight, ListMusic, PanelLeftClose, Plus, Settings as SettingsIcon } from 'lucide-react';
import { useState } from 'react';
import { invoke } from '../api';
import { SIDEBAR, type SidebarId } from '../lib/sidebar';
import { navigate, sectionOf, useRouter } from '../state/router';
import { useLibrary } from '../state/library';
import { useSettings } from '../state/settings';
import { toast, useUi } from '../state/ui';
import { Icon, IconButton, Spinner } from './ui';

export const DRAG_MIME = 'application/x-gravity-media';

export function Sidebar() {
  const route = useRouter((s) => s.route);
  const active = sectionOf(route);
  const { appearance } = useSettings((s) => s.settings);
  const onSettings = route.name === 'settings';
  const update = useSettings((s) => s.update);
  const playlists = useLibrary((s) => s.playlists);
  const scan = useLibrary((s) => s.scan);
  const roots = useLibrary((s) => s.roots);
  const [open, setOpen] = useState(true);
  const [dropTarget, setDropTarget] = useState<number | null>(null);

  const visible = appearance.sidebarOrder.filter((id) => !appearance.sidebarHidden.includes(id)).map((id) => SIDEBAR[id as SidebarId]).filter(Boolean);
  const library = visible.filter((i) => i.group === 'library');
  const collections = visible.filter((i) => i.group === 'collections');
  const offline = roots.filter((r) => r.enabled && !r.online);

  const move = (id: string, dir: -1 | 1) => {
    const order = [...appearance.sidebarOrder];
    const i = order.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    update({ appearance: { sidebarOrder: order } });
  };

  const itemMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    useUi.getState().openMenu(e.clientX, e.clientY, [
      { label: 'Move Up', run: () => move(id, -1) },
      { label: 'Move Down', run: () => move(id, 1) },
      { separator: true },
      { label: 'Hide from Sidebar', run: () => update({ appearance: { sidebarHidden: [...appearance.sidebarHidden, id] } }) },
      { label: 'Customize Sidebar…', run: () => navigate({ name: 'settings', pane: 'appearance' }) }
    ]);
  };

  const newPlaylist = async () => {
    const name = await useUi.getState().prompt({ title: 'New Playlist', message: 'Give your playlist a name.', placeholder: 'My Playlist', confirmLabel: 'Create' });
    if (!name) return;
    const p = await invoke('playlists:create', name);
    await useLibrary.getState().refreshPlaylists();
    navigate({ name: 'playlist', id: p.id });
  };

  const renderItem = (def: (typeof library)[number]) => (
    <li key={def.id}>
      <button
        type="button" className={`side-item ${active === def.id ? 'is-active' : ''}`} onClick={() => navigate(def.route)}
        onContextMenu={(e) => itemMenu(e, def.id)} aria-current={active === def.id ? 'page' : undefined}
      >
        <Icon as={def.icon} size={17} className="side-item__icon" />
        <span className="truncate">{def.label}</span>
      </button>
    </li>
  );

  return (
    <aside className="sidebar" aria-label="Sidebar">
      <div className="sidebar__head drag">
        <div className="sidebar__brand no-drag" aria-hidden="true"><span className="sidebar__mark" />Gravity</div>
        <div className="no-drag sidebar__collapse"><IconButton icon={PanelLeftClose} label="Hide Sidebar" onClick={() => update({ appearance: { sidebarCollapsed: true } })} /></div>
      </div>
      <nav className="sidebar__scroll">
        <ul className="side-group">{library.map(renderItem)}</ul>
        {collections.length > 0 && (
          <>
            <div className="side-heading">Collections</div>
            <ul className="side-group">{collections.map(renderItem)}</ul>
          </>
        )}
        <div className="side-heading side-heading--row">
          <button type="button" className="side-heading__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
            <Icon as={open ? ChevronDown : ChevronRight} size={12} strokeWidth={2.4} />
            Playlists
          </button>
          <IconButton icon={Plus} label="New Playlist" onClick={() => void newPlaylist()} size={14} className="side-heading__add" />
        </div>
        {open && (
          <ul className="side-group">
            {playlists.length === 0 && <li className="side-empty secondary t-footnote">No playlists yet</li>}
            {playlists.map((p) => (
              <li key={p.id}>
                <button
                  type="button" className={`side-item ${active === `playlist:${p.id}` ? 'is-active' : ''} ${dropTarget === p.id ? 'is-drop' : ''}`}
                  onClick={() => navigate({ name: 'playlist', id: p.id })}
                  onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_MIME)) { e.preventDefault(); setDropTarget(p.id); } }}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(e) => {
                    setDropTarget(null);
                    const raw = e.dataTransfer.getData(DRAG_MIME);
                    if (!raw) return;
                    e.preventDefault();
                    const ids = JSON.parse(raw) as number[];
                    void invoke('playlists:add', p.id, ids).then(() => { toast('success', `Added to “${p.name}”`); void useLibrary.getState().refreshPlaylists(); });
                  }}
                >
                  <Icon as={ListMusic} size={17} className="side-item__icon" />
                  <span className="truncate">{p.name}</span>
                  <span className="side-item__count tabular">{p.itemCount}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <div className="sidebar__foot">
        {scan && (
          <button type="button" className="scan-chip" onClick={() => navigate({ name: 'settings', pane: 'library' })} title="Library is updating">
            <Spinner size={13} />
            <span className="truncate">Updating library · {scan.scanned.toLocaleString()}</span>
          </button>
        )}
        {!scan && offline.length > 0 && (
          <button type="button" className="scan-chip scan-chip--warn" onClick={() => navigate({ name: 'settings', pane: 'library' })}>
            <span className="dot dot--warn" />
            <span className="truncate">{offline.length === 1 ? `${offline[0]!.name} is offline` : `${offline.length} folders offline`}</span>
          </button>
        )}
        <button
          type="button" className={`side-item ${onSettings ? 'is-active' : ''}`}
          onClick={() => navigate({ name: 'settings' })} aria-current={onSettings ? 'page' : undefined}
        >
          <Icon as={SettingsIcon} size={17} className="side-item__icon" />
          <span className="truncate">Settings</span>
        </button>
      </div>
    </aside>
  );
}
