import { Heart, Pause, Play } from 'lucide-react';
import { formatDuration } from '@shared/format';
import type { MediaItem } from '@shared/types';
import { invoke } from '../api';
import { itemMenu, toggleFavorite } from '../lib/actions';
import { artistOf } from '../lib/media';
import { useMusic } from '../state/music';
import { useUi } from '../state/ui';
import { Artwork } from './Artwork';
import { DataTable, type Column } from './DataTable';
import { DRAG_MIME } from './Sidebar';

interface Props {
  items: MediaItem[];
  /** Play this list starting at the given index. */
  onPlay?: (index: number) => void;
  showArtwork?: boolean;
  showAlbum?: boolean;
  /** Show a sortable "Added" column (the date the file first appeared in the library). */
  showAdded?: boolean;
  showArtist?: boolean;
  showNumber?: 'track' | 'index';
  sort?: { key: string; desc: boolean };
  onSort?: (key: string) => void;
  entryIds?: Map<number, number>;
  onReorder?: (fromKey: string, toIndex: number) => void;
  onRemove?: (item: MediaItem) => void;
}

/** Animated equaliser bars shown beside the currently playing track. */
export function NowPlayingBars({ paused }: { paused?: boolean }) {
  return <span className={`bars ${paused ? 'is-paused' : ''}`} aria-label="Now playing"><i /><i /><i /><i /></span>;
}

export function TrackTable({ items, onPlay, showArtwork, showAlbum, showAdded, showArtist = true, showNumber = 'index', sort, onSort, onReorder, onRemove }: Props) {
  const currentId = useMusic((s) => s.queue[s.index]?.id);
  const playing = useMusic((s) => s.playing);
  const play = (i: number) => (onPlay ? onPlay(i) : useMusic.getState().playItems(items, i));

  const columns: Column<MediaItem>[] = [
    {
      id: 'num', header: '#', width: '44px', sortKey: showNumber === 'track' ? 'track' : undefined, align: 'right',
      render: (m, i) => (
        <span className="track-num tabular">
          {currentId === m.id ? <NowPlayingBars paused={!playing} /> : <span className="track-num__n">{showNumber === 'track' ? (m.trackNo ?? '–') : i + 1}</span>}
          <button type="button" className="track-num__play" aria-label={`Play ${m.title}`} onClick={(e) => { e.stopPropagation(); play(i); }}>
            {currentId === m.id && playing ? <Pause size={14} fill="currentColor" strokeWidth={0} /> : <Play size={14} fill="currentColor" strokeWidth={0} />}
          </button>
        </span>
      )
    },
    {
      id: 'title', header: 'Title', width: 'minmax(200px, 3fr)', sortKey: 'title',
      render: (m) => (
        <div className="cell-title">
          {showArtwork && <div className="cell-title__art cell-title__art--sq"><Artwork mediaId={m.id} hasArt={m.hasArt} title={m.title} kind="audio" shape="square" fit="cover" version={m.mtimeMs} /></div>}
          <div className="min0">
            <div className={`truncate ${currentId === m.id ? 'accent-text' : ''}`}>{m.title}</div>
            {showArtist && <div className="truncate secondary t-footnote">{artistOf(m)}</div>}
          </div>
        </div>
      )
    },
    ...(showAlbum ? [{ id: 'album', header: 'Album', width: 'minmax(120px, 2fr)', hideBelow: 700, sortKey: 'name', render: (m: MediaItem) => <span className="truncate secondary">{m.album ?? '—'}</span> }] : []),
    { id: 'fmt', header: 'Format', width: '100px', hideBelow: 900, render: (m) => <span className="secondary t-footnote">{m.acodec.toUpperCase()}{m.sampleRate >= 88200 ? ' · Hi-Res' : ''}</span> },
    ...(showAdded ? [{ id: 'added', header: 'Added', width: '100px', hideBelow: 1000, sortKey: 'added', render: (m: MediaItem) => <span className="secondary tabular t-footnote">{new Date(m.addedAt).toLocaleDateString()}</span> }] : []),
    { id: 'plays', header: 'Plays', width: '60px', hideBelow: 820, align: 'right', render: (m) => <span className="secondary tabular">{m.playCount || ''}</span> },
    {
      id: 'fav', header: '', width: '36px',
      render: (m) => (
        <button type="button" className={`row-fav ${m.favorite ? 'is-on' : ''}`} aria-label={m.favorite ? 'Remove from Favourites' : 'Add to Favourites'} aria-pressed={m.favorite} onClick={(e) => { e.stopPropagation(); void toggleFavorite(m); }}>
          <Heart size={14} fill={m.favorite ? 'currentColor' : 'none'} strokeWidth={1.9} />
        </button>
      )
    },
    { id: 'dur', header: 'Time', width: '64px', sortKey: 'duration', align: 'right', render: (m) => <span className="secondary tabular">{formatDuration(m.durationSec)}</span> }
  ];

  return (
    <DataTable
      items={items} columns={columns} getKey={(m) => m.id} rowHeight={showArtwork ? 52 : 44} isCurrent={(m) => m.id === currentId}
      onActivate={(_, i) => play(i)} sort={sort} onSort={onSort}
      onContext={(e, m) => {
        e.preventDefault();
        const entries = itemMenu(m, { queue: items });
        if (onRemove) entries.splice(entries.length - 2, 0, { label: 'Remove from Playlist', run: () => onRemove(m) });
        useUi.getState().openMenu(e.clientX, e.clientY, entries);
      }}
      draggableIds={(m) => [m.id]} dragMime={DRAG_MIME} onReorder={onReorder}
    />
  );
}

export { invoke };
