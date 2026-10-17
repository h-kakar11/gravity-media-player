import { Check, Heart, Play } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatDuration } from '@shared/format';
import type { AlbumSummary, FolderEntry, MediaItem, Playlist, SeriesSummary } from '@shared/types';
import { invoke } from '../api';
import { artShape, type ArtShape } from '../lib/art';
import { openMedia, showItemMenu } from '../lib/actions';
import { subtitleFor } from '../lib/media';
import { navigate } from '../state/router';
import { useLibrary } from '../state/library';
import { useUi } from '../state/ui';
import { useMusic } from '../state/music';
import { Artwork, Mosaic } from './Artwork';
import { DRAG_MIME } from './Sidebar';
import { Icon, ProgressBar } from './ui';

interface CardShellProps {
  title: string;
  subtitle?: string;
  art: ReactNode;
  onOpen: () => void;
  onPlay?: () => void;
  onContext?: (e: React.MouseEvent) => void;
  progress?: number;
  completed?: boolean;
  favorite?: boolean;
  badges?: ReactNode;
  dragIds?: number[];
  selected?: boolean;
  className?: string;
  width?: number;
  titleLines?: 1 | 2;
}

/** Shared card chrome: artwork, hover lift, play affordance, progress and state badges. */
export function CardShell({ title, subtitle, art, onOpen, onPlay, onContext, progress, completed, favorite, badges, dragIds, selected, className = '', width, titleLines = 1 }: CardShellProps) {
  return (
    <div
      className={`card ${selected ? 'is-selected' : ''} ${className}`}
      style={width ? { width } : undefined}
      role="button" tabIndex={0} aria-label={`${title}${subtitle ? `, ${subtitle}` : ''}`}
      onClick={onOpen}
      onDoubleClick={onPlay}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.shiftKey && onPlay ? onPlay : onOpen)(); } }}
      onContextMenu={onContext}
      draggable={!!dragIds}
      onDragStart={(e) => { if (dragIds) { e.dataTransfer.setData(DRAG_MIME, JSON.stringify(dragIds)); e.dataTransfer.effectAllowed = 'copy'; } }}
    >
      <div className="card__art">
        {art}
        {progress != null && progress > 0 && !completed && <ProgressBar value={progress} className="card__progress" />}
        {favorite && <span className="card__fav" aria-label="Favourite"><Heart size={12} fill="currentColor" strokeWidth={0} /></span>}
        {completed && <span className="card__done" aria-label="Played"><Check size={12} strokeWidth={3} /></span>}
        {badges && <div className="card__badges">{badges}</div>}
        {onPlay && (
          <button type="button" className="card__play" aria-label={`Play ${title}`} onClick={(e) => { e.stopPropagation(); onPlay(); }} onDoubleClick={(e) => e.stopPropagation()}>
            <Icon as={Play} size={18} fill="currentColor" strokeWidth={0} />
          </button>
        )}
      </div>
      <div className="card__meta">
        <div className={`card__title ${titleLines === 2 ? 'clamp-2' : 'truncate'}`}>{title}</div>
        {subtitle && <div className="card__sub truncate">{subtitle}</div>}
      </div>
    </div>
  );
}

export function MediaCard({
  item, queue, shape, onOpen, subtitle, width, playOnClick, showResume, selected
}: {
  item: MediaItem; queue?: MediaItem[]; shape?: ArtShape; onOpen?: () => void; subtitle?: string; width?: number; playOnClick?: boolean; showResume?: boolean; selected?: boolean;
}) {
  const s = shape ?? artShape(item);
  const play = () => openMedia(item, queue);
  const open =
    onOpen ??
    (() => {
      if (playOnClick) return play();
      if (item.kind === 'video') navigate({ name: 'media', id: item.id });
      else play();
    });
  const badges = item.kind === 'video' && (item.hdr || item.height >= 2000) ? (
    <>
      {item.height >= 2000 && <span className="pill">4K</span>}
      {item.hdr && <span className="pill">HDR</span>}
    </>
  ) : undefined;
  const sub = subtitle ?? (showResume && item.positionSec > 10 && item.durationSec ? `${formatDuration(Math.max(0, item.durationSec - item.positionSec), { long: true })} left` : subtitleFor(item));
  return (
    <CardShell
      title={item.title} subtitle={sub} width={width} selected={selected}
      art={<Artwork mediaId={item.id} hasArt={item.hasArt} title={item.title} kind={item.kind} shape={s} version={item.mtimeMs} />}
      onOpen={open}
      onPlay={item.kind === 'video' || item.kind === 'audio' ? play : undefined}
      onContext={(e) => showItemMenu(e, item, { queue })}
      progress={item.kind === 'audio' ? undefined : item.progress || (item.durationSec && item.positionSec ? item.positionSec / item.durationSec : 0)}
      completed={item.completed && item.kind !== 'audio'}
      favorite={item.favorite}
      badges={badges}
      dragIds={item.kind === 'video' || item.kind === 'audio' ? [item.id] : undefined}
      titleLines={s === 'tall' ? 2 : 1}
    />
  );
}

export function AlbumCard({ album, width }: { album: AlbumSummary; width?: number }) {
  const play = async () => {
    const r = await invoke('library:query', { kind: 'audio', album: album.key, sort: 'track' });
    useMusic.getState().playItems(r.items, 0);
  };
  return (
    <CardShell
      title={album.album} subtitle={[album.artist, album.year].filter(Boolean).join(' · ')} width={width}
      art={<Artwork mediaId={album.artMediaId} hasArt={album.artMediaId != null} title={album.album} kind="album" shape="square" fit="cover" />}
      onOpen={() => navigate({ name: 'album', key: album.key })}
      onPlay={() => void play()}
      favorite={album.favorite}
      onContext={(e) => {
        e.preventDefault();
        useUi.getState().openMenu(e.clientX, e.clientY, [
          { label: 'Play', run: () => void play() },
          { label: 'Open Album', run: () => navigate({ name: 'album', key: album.key }) },
          { separator: true },
          { label: album.favorite ? 'Remove from Favourites' : 'Add to Favourites', run: () => void invoke('library:favorite', { type: 'album', key: album.key }, !album.favorite).then(() => useLibrary.setState((s) => ({ revision: s.revision + 1 }))) }
        ]);
      }}
    />
  );
}

export function SeriesCard({ series, width }: { series: SeriesSummary; width?: number }) {
  const left = series.episodeCount - series.completedCount;
  const sub =
    series.type === 'show'
      ? `${series.seasonCount} season${series.seasonCount === 1 ? '' : 's'} · ${series.episodeCount} episode${series.episodeCount === 1 ? '' : 's'}`
      : `${series.episodeCount} volume${series.episodeCount === 1 ? '' : 's'}${left < series.episodeCount && left > 0 ? ` · ${left} unread` : ''}`;
  return (
    <CardShell
      title={series.title} subtitle={sub} width={width} titleLines={2}
      art={<Artwork mediaId={series.artMediaId} hasArt={series.artMediaId != null} title={series.title} kind={series.type === 'show' ? 'video' : 'comic'} shape="tall" />}
      onOpen={() => navigate(series.type === 'show' ? { name: 'show', key: series.key } : { name: 'series', key: series.key })}
      progress={series.episodeCount ? series.completedCount / series.episodeCount : 0}
      completed={series.completedCount === series.episodeCount && series.episodeCount > 0}
      favorite={series.favorite}
    />
  );
}

export function FolderCard({ folder, width }: { folder: FolderEntry; width?: number }) {
  const parts = Object.entries(folder.kinds).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([k, n]) => `${n} ${k === 'audio' ? 'song' : k === 'image' ? 'photo' : k}${n === 1 ? '' : 's'}`);
  return (
    <CardShell
      title={folder.name} subtitle={parts.slice(0, 2).join(', ') || `${folder.itemCount} items`} width={width}
      art={<div className="folder-art"><Mosaic ids={folder.artMediaIds} title={folder.name} kind="folder" /></div>}
      onOpen={() => navigate({ name: 'browse', path: folder.path })}
      favorite={folder.favorite}
    />
  );
}

export function PlaylistCard({ playlist, width }: { playlist: Playlist; width?: number }) {
  return (
    <CardShell
      title={playlist.name} subtitle={`${playlist.itemCount} item${playlist.itemCount === 1 ? '' : 's'}${playlist.durationSec ? ` · ${formatDuration(playlist.durationSec, { long: true })}` : ''}`} width={width}
      art={<div className="folder-art"><Mosaic ids={playlist.artMediaIds} title={playlist.name} kind="audio" /></div>}
      onOpen={() => navigate({ name: 'playlist', id: playlist.id })}
    />
  );
}

export function ArtistCard({ artist, width }: { artist: import('@shared/types').ArtistSummary; width?: number }) {
  return (
    <CardShell
      title={artist.name} subtitle={`${artist.albumCount} album${artist.albumCount === 1 ? '' : 's'} · ${artist.trackCount} songs`} width={width} className="card--round"
      art={<Artwork mediaId={artist.artMediaId} hasArt={artist.artMediaId != null} title={artist.name} kind="audio" shape="square" fit="cover" />}
      onOpen={() => navigate({ name: 'artist', key: artist.key })}
    />
  );
}
