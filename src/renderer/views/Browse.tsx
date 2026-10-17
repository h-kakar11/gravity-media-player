import { ChevronRight, Folder, FolderOpen, FolderPlus, HardDrive } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatBytes, formatDuration } from '@shared/format';
import type { BrowseResult, FolderEntry, MediaItem, SortKey } from '@shared/types';
import { invoke } from '../api';
import { Artwork, Mosaic } from '../components/Artwork';
import { FolderCard, MediaCard } from '../components/cards';
import { DataTable, type Column } from '../components/DataTable';
import { InspectorPanel } from '../components/Inspector';
import { PageHeader } from '../components/layout';
import { DRAG_MIME } from '../components/Sidebar';
import { Button, EmptyState, Spinner } from '../components/ui';
import { ViewControls, useViewState } from '../components/ViewControls';
import { VirtualGrid } from '../components/VirtualGrid';
import { openMedia, showItemMenu } from '../lib/actions';
import { useLibraryQuery } from '../lib/hooks';
import { kindLabel, subtitleFor } from '../lib/media';
import { naturalCompare } from '@shared/natural-sort';
import { navigate } from '../state/router';
import { useLibrary } from '../state/library';
import { useSettings } from '../state/settings';
import { useUi } from '../state/ui';
import { addFolderFlow } from './Home';

type Entry = { type: 'folder'; folder: FolderEntry } | { type: 'media'; item: MediaItem };
const entryKey = (e: Entry) => (e.type === 'folder' ? `f:${e.folder.path}` : `m:${e.item.id}`);
const entryName = (e: Entry) => (e.type === 'folder' ? e.folder.name : e.item.fileName || e.item.title);

function sortEntries(list: Entry[], key: SortKey, desc: boolean): Entry[] {
  const val = (e: Entry): number | string => {
    if (e.type === 'folder') return key === 'size' || key === 'duration' ? 0 : key === 'added' ? 0 : entryName(e);
    switch (key) {
      case 'added': return e.item.addedAt;
      case 'size': return e.item.size;
      case 'duration': return e.item.durationSec;
      case 'year': return e.item.year ?? 0;
      case 'played': return e.item.lastPlayedAt ?? 0;
      default: return entryName(e);
    }
  };
  const out = [...list].sort((a, b) => {
    // Folders always lead, like a file manager.
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    const x = val(a), y = val(b);
    return typeof x === 'string' ? naturalCompare(x, y as string) : (x as number) - (y as number);
  });
  if (desc) {
    const folders = out.filter((e) => e.type === 'folder').reverse();
    return [...folders, ...out.filter((e) => e.type === 'media').reverse()];
  }
  return out;
}

export function BrowseView({ path }: { path: string | null }) {
  const view = useViewState('browse', { mode: 'grid', sort: 'name' });
  const poster = useSettings((s) => s.settings.appearance.posterSize);
  const roots = useLibrary((s) => s.roots);
  const info = useUi((s) => s.infoPanel);
  const [selected, setSelected] = useState<Entry | null>(null);
  const { data, loading } = useLibraryQuery(() => invoke('library:browse', path), [path]);
  useEffect(() => setSelected(null), [path]);

  const entries = useMemo<Entry[]>(() => (data ? sortEntries([...data.folders.map((folder) => ({ type: 'folder', folder }) as Entry), ...data.items.map((item) => ({ type: 'media', item }) as Entry)], view.sort.key, view.sort.desc) : []), [data, view.sort.key, view.sort.desc]);
  const media = data?.items ?? [];

  if (!data) return <div className="page-loading"><Spinner size={22} /></div>;
  const title = path == null ? 'Browse' : data.crumbs[data.crumbs.length - 1]!.name;

  const open = (e: Entry) => (e.type === 'folder' ? navigate({ name: 'browse', path: e.folder.path }) : openMedia(e.item, media));

  const columns: Column<Entry>[] = [
    {
      id: 'name', header: 'Name', width: 'minmax(240px, 4fr)', sortKey: 'name',
      render: (e) => (
        <div className="cell-title">
          <div className="cell-title__art cell-title__art--sq">
            {e.type === 'folder' ? <Mosaic ids={e.folder.artMediaIds} title={e.folder.name} kind="folder" /> : <Artwork mediaId={e.item.id} hasArt={e.item.hasArt} title={e.item.title} kind={e.item.kind} shape="square" fit="cover" version={e.item.mtimeMs} />}
          </div>
          <div className="min0"><div className="truncate">{entryName(e)}</div>{e.type === 'media' && <div className="truncate secondary t-footnote">{e.item.title !== entryName(e) ? e.item.title : subtitleFor(e.item)}</div>}</div>
        </div>
      )
    },
    { id: 'kind', header: 'Kind', width: '110px', hideBelow: 620, render: (e) => <span className="secondary">{e.type === 'folder' ? 'Folder' : kindLabel(e.item)}</span> },
    { id: 'size', header: 'Size', width: '90px', sortKey: 'size', align: 'right', hideBelow: 740, render: (e) => <span className="secondary tabular">{e.type === 'folder' ? `${e.folder.itemCount} items` : formatBytes(e.item.size)}</span> },
    { id: 'dur', header: 'Duration', width: '90px', sortKey: 'duration', align: 'right', hideBelow: 840, render: (e) => <span className="secondary tabular">{e.type === 'media' && e.item.durationSec ? formatDuration(e.item.durationSec) : ''}</span> },
    { id: 'added', header: 'Date Added', width: '120px', sortKey: 'added', align: 'right', hideBelow: 960, render: (e) => <span className="secondary tabular">{e.type === 'media' ? new Date(e.item.addedAt).toLocaleDateString() : ''}</span> }
  ];

  const crumbs = (
    <nav className="crumbs" aria-label="Path">
      {data.crumbs.map((c, i) => (
        <span key={i} className="crumbs__seg">
          {i > 0 && <ChevronRight size={13} strokeWidth={2.2} className="tertiary" />}
          <button type="button" className={`crumbs__btn ${i === data.crumbs.length - 1 ? 'is-last' : ''}`} onClick={() => navigate({ name: 'browse', path: c.path })} aria-current={i === data.crumbs.length - 1 ? 'page' : undefined}>
            {i === 0 && <HardDrive size={13} strokeWidth={2} />}{c.name}
          </button>
        </span>
      ))}
    </nav>
  );

  return (
    <div className={`browse ${info && view.mode !== 'columns' ? 'has-inspector' : ''}`}>
      <div className="browse__main">
        <PageHeader title={title} subtitle={crumbs} />
        <ViewControls state={view} modes={['grid', 'list', 'columns']} sorts={['name', 'added', 'size', 'duration', 'year']} />
        {path == null && roots.length === 0 ? (
          <EmptyState icon={FolderPlus} title="No folders yet" message="Add a folder to browse it here exactly as it is on disk — with artwork, metadata and progress layered on top."><Button variant="primary" icon={FolderPlus} onClick={() => void addFolderFlow()}>Add Library Folder…</Button></EmptyState>
        ) : entries.length === 0 ? (
          <EmptyState icon={Folder} title="This folder is empty" message="Nothing playable or readable lives directly here." />
        ) : view.mode === 'columns' ? (
          <ColumnsBrowser data={data} onOpen={open} />
        ) : view.mode === 'grid' ? (
          <div className={loading ? 'is-refreshing' : ''}>
            <VirtualGrid
              items={entries} getKey={entryKey} minWidth={Math.max(120, poster - 28)} aspect={1} labelHeight={48}
              renderItem={(e) => e.type === 'folder' ? <FolderCard folder={e.folder} /> : <MediaCard item={e.item} queue={media} shape="square" onOpen={() => setSelected(e)} selected={selected != null && entryKey(selected) === entryKey(e)} />}
            />
          </div>
        ) : (
          <DataTable
            items={entries} columns={columns} getKey={entryKey} sort={view.sort} onSort={(k) => view.setSort(k as SortKey)}
            onActivate={open} onSelect={setSelected} selectedKey={selected ? entryKey(selected) : null}
            onContext={(ev, e) => e.type === 'media' && showItemMenu(ev, e.item, { queue: media })}
            draggableIds={(e) => (e.type === 'media' && (e.item.kind === 'audio' || e.item.kind === 'video') ? [e.item.id] : null)} dragMime={DRAG_MIME}
          />
        )}
      </div>
      {info && view.mode !== 'columns' && <InspectorPanel entry={selected} />}
    </div>
  );
}

/** Finder-style column view: each selected folder opens a new column; files show a preview. */
function ColumnsBrowser({ data, onOpen }: { data: BrowseResult; onOpen: (e: Entry) => void }) {
  const [trail, setTrail] = useState<{ path: string | null; label: string }[]>([{ path: data.path, label: data.crumbs[data.crumbs.length - 1]!.name }]);
  const [selection, setSelection] = useState<Record<number, string>>({});
  const [preview, setPreview] = useState<MediaItem | null>(null);
  useEffect(() => { setTrail([{ path: data.path, label: data.crumbs[data.crumbs.length - 1]!.name }]); setSelection({}); setPreview(null); }, [data.path]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="columns" role="tree">
      {trail.map((t, col) => <Column key={`${col}:${t.path}`} path={t.path} selected={selection[col]} onSelectFolder={(f) => { setTrail([...trail.slice(0, col + 1), { path: f.path, label: f.name }]); setSelection({ ...selection, [col]: f.path }); setPreview(null); }} onSelectMedia={(m) => { setTrail(trail.slice(0, col + 1)); setSelection({ ...selection, [col]: `m:${m.id}` }); setPreview(m); }} onOpen={onOpen} />)}
      {preview && (
        <div className="columns__preview">
          <Artwork mediaId={preview.id} hasArt={preview.hasArt} title={preview.title} kind={preview.kind} shape={preview.kind === 'audio' ? 'square' : 'wide'} size="large" version={preview.mtimeMs} />
          <h3 className="t-headline">{preview.title}</h3>
          <p className="secondary t-subhead">{subtitleFor(preview)}</p>
          <dl className="info-list info-list--compact">
            <div className="info-list__row"><dt>Kind</dt><dd>{kindLabel(preview)}</dd></div>
            <div className="info-list__row"><dt>Size</dt><dd>{formatBytes(preview.size)}</dd></div>
            {preview.durationSec > 0 && <div className="info-list__row"><dt>Duration</dt><dd>{formatDuration(preview.durationSec)}</dd></div>}
          </dl>
          <Button variant="primary" onClick={() => onOpen({ type: 'media', item: preview })}>{preview.kind === 'video' || preview.kind === 'audio' ? 'Play' : 'Open'}</Button>
        </div>
      )}
    </div>
  );
}

function Column({ path, selected, onSelectFolder, onSelectMedia, onOpen }: { path: string | null; selected?: string; onSelectFolder: (f: FolderEntry) => void; onSelectMedia: (m: MediaItem) => void; onOpen: (e: Entry) => void }) {
  const { data } = useLibraryQuery(() => invoke('library:browse', path), [path]);
  if (!data) return <div className="columns__col"><div className="page-loading"><Spinner size={18} /></div></div>;
  return (
    <div className="columns__col" role="group">
      {data.folders.map((f) => (
        <button key={f.path} type="button" role="treeitem" aria-selected={selected === f.path} className={`columns__row ${selected === f.path ? 'is-selected' : ''}`} onClick={() => onSelectFolder(f)} onDoubleClick={() => onOpen({ type: 'folder', folder: f })}>
          <Folder size={15} strokeWidth={1.8} className="accent-text" /><span className="truncate">{f.name}</span><ChevronRight size={13} strokeWidth={2.2} className="tertiary" />
        </button>
      ))}
      {data.items.map((m) => (
        <button key={m.id} type="button" role="treeitem" aria-selected={selected === `m:${m.id}`} className={`columns__row ${selected === `m:${m.id}` ? 'is-selected' : ''}`} onClick={() => onSelectMedia(m)} onDoubleClick={() => onOpen({ type: 'media', item: m })}>
          <FolderOpen size={0} /><span className="truncate">{m.fileName || m.title}</span>
        </button>
      ))}
    </div>
  );
}
