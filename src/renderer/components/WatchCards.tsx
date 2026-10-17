import { Bookmark, BookmarkMinus, BellOff, EyeOff, Info, Play } from 'lucide-react';
import { episodeTag } from '@shared/format';
import type { MediaItem } from '@shared/types';
import { watchKey, type UpNextEntry, type WatchlistEntry } from '@shared/watch';
import { invoke } from '../api';
import { openMedia } from '../lib/actions';
import { navigate } from '../state/router';
import { toast, useUi } from '../state/ui';
import { toggleWatchlist, updateWatch, useOnWatchlist, useWatch } from '../state/watch';
import '../styles/watch.css';
import { Artwork } from './Artwork';
import { CardShell, MediaCard } from './cards';
import { Icon, IconButton } from './ui';

const ico = (c: Parameters<typeof Icon>[0]['as']) => <Icon as={c} size={15} />;

/** Play a show from `start` (or wherever the viewer left off), queueing the rest of its episodes. */
export async function playShow(seriesKey: string, start?: MediaItem): Promise<void> {
  try {
    const episodes = (await invoke('library:query', { kind: 'video', series: seriesKey, sort: 'episode' })).items;
    const first = start ?? episodes.find((e) => !e.completed && e.positionSec > 10) ?? episodes.find((e) => !e.completed) ?? episodes[0];
    if (!first) return void toast('info', 'This show has no episodes in your library right now');
    openMedia(first, episodes.some((e) => e.id === first.id) ? episodes : [first, ...episodes]);
  } catch (err) {
    toast('error', (err as Error).message);
  }
}

/** Bookmark button for a detail page: fills in when the movie or show is on the watchlist. */
export function WatchlistToggle({ target, title }: { target: Parameters<typeof useOnWatchlist>[0]; title: string }) {
  const on = useOnWatchlist(target);
  return (
    <IconButton icon={Bookmark} label={on ? 'Remove from Watchlist' : 'Add to Watchlist'} active={on} className="round" size={18} onClick={() => void toggleWatchlist(target, title)} />
  );
}

export function showUpNextMenu(e: React.MouseEvent, entry: UpNextEntry): void {
  e.preventDefault();
  e.stopPropagation();
  const onList = useWatch.getState().keys.has(watchKey({ kind: 'show', key: entry.seriesKey }));
  useUi.getState().openMenu(e.clientX, e.clientY, [
    { label: 'Play', icon: ico(Play), run: () => void playShow(entry.seriesKey, entry.episode) },
    { label: 'Open Show', icon: ico(Info), run: () => navigate({ name: 'show', key: entry.seriesKey }) },
    { separator: true },
    ...(entry.newEpisodes > 0 ? [{ label: 'Dismiss New Episodes', icon: ico(BellOff), run: () => void updateWatch({ type: 'markSeen', seriesKey: entry.seriesKey }) }] : []),
    { label: 'Hide from Up Next', icon: ico(EyeOff), run: () => void updateWatch({ type: 'hideUpNext', seriesKey: entry.seriesKey }) },
    { label: onList ? 'Remove from Watchlist' : 'Add to Watchlist', icon: ico(onList ? BookmarkMinus : Bookmark), run: () => void toggleWatchlist({ kind: 'show', key: entry.seriesKey }, entry.showTitle) }
  ]);
}

export function showWatchlistMenu(e: React.MouseEvent, entry: WatchlistEntry): void {
  e.preventDefault();
  e.stopPropagation();
  const open = entry.kind === 'movie' ? (entry.movie ? () => navigate({ name: 'media', id: entry.movie!.id }) : null) : entry.show ? () => navigate({ name: 'show', key: entry.show!.key }) : null;
  const play = entry.kind === 'movie' ? (entry.movie && entry.available ? () => openMedia(entry.movie!, [entry.movie!]) : null) : entry.show ? () => void playShow(entry.show!.key) : null;
  useUi.getState().openMenu(e.clientX, e.clientY, [
    ...(play ? [{ label: 'Play', icon: ico(Play), run: play }] : []),
    ...(open ? [{ label: entry.kind === 'movie' ? 'Open Movie' : 'Open Show', icon: ico(Info), run: open }] : []),
    ...(play || open ? [{ separator: true }] : []),
    { label: 'Remove from Watchlist', icon: ico(BookmarkMinus), run: () => void updateWatch({ type: 'remove', target: entry.target }) }
  ]);
}

/** The next episode of a show you are partway through. */
export function UpNextCard({ entry, width = 296 }: { entry: UpNextEntry; width?: number }) {
  const ep = entry.episode;
  const play = () => void playShow(entry.seriesKey, ep);
  const sub = [episodeTag(ep.season, ep.episode), ep.title].filter(Boolean).join(' · ');
  return (
    <CardShell
      title={entry.showTitle} subtitle={sub} width={width}
      art={<Artwork mediaId={ep.id} hasArt={ep.hasArt} title={entry.showTitle} kind="video" shape="wide" version={ep.mtimeMs} />}
      onOpen={play} onPlay={play}
      onContext={(e) => showUpNextMenu(e, entry)}
      progress={entry.episodeCount ? entry.playedCount / entry.episodeCount : 0}
      badges={entry.isNew ? <span className="pill pill--new">New</span> : entry.newEpisodes > 0 ? <span className="pill pill--new">{entry.newEpisodes} new</span> : undefined}
    />
  );
}

/** A movie or show somebody saved for later; entries whose files are offline stay visible but muted. */
export function WatchlistCard({ entry, width = 164 }: { entry: WatchlistEntry; width?: number }) {
  if (entry.kind === 'movie' && entry.movie && entry.available) return <MediaCard item={entry.movie} shape="tall" width={width} />;
  const show = entry.kind === 'show' ? entry.show : null;
  if (show) {
    return (
      <CardShell
        title={show.title} width={width} titleLines={2}
        subtitle={`${show.seasonCount} season${show.seasonCount === 1 ? '' : 's'} · ${show.episodeCount} episode${show.episodeCount === 1 ? '' : 's'}`}
        art={<Artwork mediaId={show.artMediaId} hasArt={show.artMediaId != null} title={show.title} kind="video" shape="tall" />}
        onOpen={() => navigate({ name: 'show', key: show.key })}
        onContext={(e) => showWatchlistMenu(e, entry)}
        progress={show.episodeCount ? show.completedCount / show.episodeCount : 0}
        completed={entry.watched}
        badges={show.newEpisodes > 0 ? <span className="pill pill--new">{show.newEpisodes} new</span> : undefined}
      />
    );
  }
  return (
    <CardShell
      title={entry.title} subtitle="Not in your library" width={width} titleLines={2} className="card--offline"
      art={<Artwork mediaId={null} hasArt={false} title={entry.title} kind="video" shape="tall" />}
      onOpen={() => navigate({ name: 'watchlist' })}
      onContext={(e) => showWatchlistMenu(e, entry)}
    />
  );
}
