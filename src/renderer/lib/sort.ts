import type { MediaItem, Playlist, SortKey } from '@shared/types';
import { naturalCompare } from '@shared/natural-sort';

/** Volume, then chapter, then natural file order. */
export function compareComicItems(a: MediaItem, b: MediaItem): number {
  return (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0) || naturalCompare(a.fileName, b.fileName);
}

/** Sort keys the album query understands; anything else falls back to the title. */
export type AlbumSortKey = 'title' | 'artist' | 'added' | 'year' | 'played';
export function albumSortKey(key: SortKey): AlbumSortKey {
  return key === 'name' ? 'artist' : key === 'added' || key === 'year' || key === 'played' ? key : 'title';
}

/** Sort keys the series query understands. */
export type SeriesSortKey = 'title' | 'added' | 'played';
export function seriesSortKey(key: SortKey): SeriesSortKey {
  return key === 'added' || key === 'played' ? key : 'title';
}

/** Playlists carry no play history, so "Recently Added" is when they were created. */
export function sortPlaylists(list: Playlist[], key: SortKey, desc: boolean): Playlist[] {
  const out = [...list].sort((a, b) => {
    const c = key === 'added' ? a.createdAt - b.createdAt : key === 'duration' ? a.durationSec - b.durationSec : naturalCompare(a.name, b.name);
    return c || a.id - b.id;
  });
  return desc ? out.reverse() : out;
}
