import { Play } from 'lucide-react';
import { formatBytes, formatDuration, formatFps, formatResolution } from '@shared/format';
import type { FolderEntry, MediaItem } from '@shared/types';
import { Artwork, Mosaic } from './Artwork';
import { Button, Rating } from './ui';
import { openMedia } from '../lib/actions';
import { kindLabel, subtitleFor } from '../lib/media';
import { navigate } from '../state/router';
import { invoke } from '../api';
import { useLibrary } from '../state/library';
import { Info } from 'lucide-react';

type Entry = { type: 'folder'; folder: FolderEntry } | { type: 'media'; item: MediaItem };

/** Right-hand inspector (⌘I): metadata and quick actions for the selected item. */
export function InspectorPanel({ entry }: { entry: Entry | null }) {
  if (!entry) {
    return (
      <aside className="inspector" aria-label="Info">
        <div className="inspector__empty secondary"><Info size={22} strokeWidth={1.5} /><p>Select an item to see its details.</p></div>
      </aside>
    );
  }
  if (entry.type === 'folder') {
    const f = entry.folder;
    return (
      <aside className="inspector" aria-label="Info">
        <div className="inspector__art"><Mosaic ids={f.artMediaIds} title={f.name} kind="folder" /></div>
        <h2 className="t-title-3">{f.name}</h2>
        <p className="secondary t-subhead">{f.itemCount} items</p>
        <Button variant="primary" onClick={() => navigate({ name: 'browse', path: f.path })}>Open Folder</Button>
      </aside>
    );
  }
  const m = entry.item;
  const rows: [string, string][] = [
    ['Kind', kindLabel(m)],
    ['Size', formatBytes(m.size)],
    ...(m.durationSec ? [['Duration', formatDuration(m.durationSec)] as [string, string]] : []),
    ...(m.width ? [['Dimensions', `${m.width} × ${m.height}${m.kind === 'video' ? ` · ${formatResolution(m.width, m.height)}` : ''}`] as [string, string]] : []),
    ...(m.fps ? [['Frame rate', formatFps(m.fps)] as [string, string]] : []),
    ...(m.vcodec ? [['Video', m.vcodec.toUpperCase()] as [string, string]] : []),
    ...(m.acodec ? [['Audio', m.acodec.toUpperCase()] as [string, string]] : []),
    ['Modified', new Date(m.mtimeMs).toLocaleDateString()]
  ];
  return (
    <aside className="inspector" aria-label="Info">
      <div className="inspector__art"><Artwork mediaId={m.id} hasArt={m.hasArt} title={m.title} kind={m.kind} shape={m.kind === 'audio' ? 'square' : 'wide'} size="large" version={m.mtimeMs} /></div>
      <h2 className="t-title-3 clamp-2">{m.title}</h2>
      <p className="secondary t-subhead">{subtitleFor(m)}</p>
      <Button variant="primary" icon={Play} onClick={() => openMedia(m)}>{m.kind === 'video' || m.kind === 'audio' ? 'Play' : 'Open'}</Button>
      <dl className="info-list info-list--compact">{rows.map(([k, v]) => <div key={k} className="info-list__row"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <div><div className="t-caps">Rating</div><Rating value={m.rating} onChange={(v) => void invoke('state:update', m.id, { rating: v }).then(() => useLibrary.setState((s) => ({ revision: s.revision + 1 })))} /></div>
    </aside>
  );
}
