import type { MediaItem } from '@shared/types';
import { naturalCompare } from '@shared/natural-sort';

/** Volume, then chapter, then natural file order. */
export function compareComicItems(a: MediaItem, b: MediaItem): number {
  return (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0) || naturalCompare(a.fileName, b.fileName);
}
