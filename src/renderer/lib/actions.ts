import { ListPlus, ListEnd, Play, Heart, HeartOff, CheckCircle2, Circle, Info, FolderOpen, Trash2, RotateCcw, SkipForward } from 'lucide-react';
import { Bookmark, BookmarkMinus } from 'lucide-react';
import { createElement } from 'react';
import type { MediaItem } from '@shared/types';
import { watchKey } from '@shared/watch';
import { invoke, quiet } from '../api';
import { useLibrary } from '../state/library';
import { useMusic } from '../state/music';
import { useReader } from '../state/reader';
import { toast, useUi, type MenuEntry } from '../state/ui';
import { useVideo } from '../state/video';
import { toggleWatchlist, useWatch } from '../state/watch';
import { Icon } from '../components/ui';

const ico = (c: Parameters<typeof Icon>[0]['as']) => createElement(Icon, { as: c, size: 15 });
const refresh = () => useLibrary.setState((s) => ({ revision: s.revision + 1 }));

/** Open/play an item in the right place: video player, music queue, or reader. */
export function openMedia(item: MediaItem, context?: MediaItem[], opts: { fromStart?: boolean } = {}): void {
  const list = context && context.length ? context : [item];
  const index = Math.max(0, list.findIndex((m) => m.id === item.id));
  switch (item.kind) {
    case 'video': useVideo.getState().play(list.filter((m) => m.kind === 'video'), list.filter((m) => m.kind === 'video').findIndex((m) => m.id === item.id), opts.fromStart ? { startSec: 0 } : undefined); break;
    case 'audio': useMusic.getState().playItems(list.filter((m) => m.kind === 'audio'), list.filter((m) => m.kind === 'audio').findIndex((m) => m.id === item.id)); break;
    default: useReader.getState().open(item, list.length ? list : [item]); void index;
  }
}

export async function toggleFavorite(item: MediaItem): Promise<void> {
  const next = await invoke('state:update', item.id, { favorite: !item.favorite });
  refresh();
  toast('success', next.favorite ? `Added “${item.title}” to Favourites` : `Removed “${item.title}” from Favourites`);
}

export async function setWatched(items: MediaItem[], completed: boolean): Promise<void> {
  await invoke('state:markMany', items.map((i) => i.id), completed);
  refresh();
  toast('success', completed ? 'Marked as played' : 'Marked as unplayed');
}

export async function addToPlaylist(ids: number[]): Promise<void> {
  useUi.getState().openSheet({ type: 'playlist-picker', mediaIds: ids });
}

export async function trashItem(item: MediaItem): Promise<void> {
  const ok = await useUi.getState().confirm({
    title: `Move “${item.title}” to the Trash?`,
    message: 'The file will be moved to your system Trash. Its watch history and favourites are kept in case you restore it.',
    confirmLabel: 'Move to Trash',
    destructive: true
  });
  if (!ok) return;
  try {
    await invoke('shell:trash', item.id);
    refresh();
    toast('success', 'Moved to the Trash');
  } catch (err) {
    toast('error', (err as Error).message);
  }
}

export function itemMenu(item: MediaItem, ctx: { queue?: MediaItem[]; onOpen?: () => void } = {}): MenuEntry[] {
  const entries: MenuEntry[] = [];
  const isAV = item.kind === 'video' || item.kind === 'audio';
  const resumable = item.kind === 'video' && item.positionSec > 10 && !item.completed;
  entries.push({ label: resumable ? 'Resume' : item.kind === 'audio' ? 'Play' : isAV ? 'Play' : 'Open', icon: ico(Play), run: () => openMedia(item, ctx.queue) });
  if (resumable) entries.push({ label: 'Play from Beginning', icon: ico(RotateCcw), run: () => openMedia(item, ctx.queue, { fromStart: true }) });
  if (item.kind === 'audio') {
    entries.push({ label: 'Play Next', icon: ico(SkipForward), run: () => { useMusic.getState().playNext([item]); toast('info', `“${item.title}” will play next`); } });
    entries.push({ label: 'Add to Queue', icon: ico(ListEnd), run: () => { useMusic.getState().addToQueue([item]); toast('info', 'Added to the queue'); } });
  }
  entries.push({ separator: true });
  if (isAV) entries.push({ label: 'Add to Playlist…', icon: ico(ListPlus), run: () => void addToPlaylist([item.id]) });
  if (item.kind === 'video' && item.vclass !== 'episode') {
    const target = { kind: 'movie', id: item.id } as const;
    const onList = useWatch.getState().keys.has(watchKey(target));
    entries.push({ label: onList ? 'Remove from Watchlist' : 'Add to Watchlist', icon: ico(onList ? BookmarkMinus : Bookmark), run: () => void toggleWatchlist(target, item.title) });
  }
  entries.push({ label: item.favorite ? 'Remove from Favourites' : 'Add to Favourites', icon: ico(item.favorite ? HeartOff : Heart), run: () => void toggleFavorite(item) });
  if (item.kind !== 'audio' && item.kind !== 'image') {
    entries.push({ label: item.completed ? 'Mark as Unplayed' : 'Mark as Played', icon: ico(item.completed ? Circle : CheckCircle2), run: () => void setWatched([item], !item.completed) });
  }
  entries.push({ separator: true });
  entries.push({ label: 'Get Info', icon: ico(Info), run: () => useUi.getState().openSheet({ type: 'info', mediaId: item.id }) });
  entries.push({ label: 'Show in Folder', icon: ico(FolderOpen), run: () => quiet(invoke('shell:reveal', item.id)) });
  entries.push({ separator: true });
  entries.push({ label: 'Move to Trash…', icon: ico(Trash2), danger: true, run: () => void trashItem(item) });
  return entries;
}

export function showItemMenu(e: React.MouseEvent, item: MediaItem, ctx: { queue?: MediaItem[] } = {}): void {
  e.preventDefault();
  e.stopPropagation();
  useUi.getState().openMenu(e.clientX, e.clientY, itemMenu(item, ctx));
}
