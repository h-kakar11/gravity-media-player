import { describe, expect, it } from 'vitest';
import { SORT_LABELS } from '@shared/ipc';
import type { Playlist } from '@shared/types';
import { albumSortKey, seriesSortKey, sortPlaylists } from '../../src/renderer/lib/sort';

const pl = (id: number, name: string, createdAt: number, durationSec = 0): Playlist =>
  ({ id, name, description: '', itemCount: 0, durationSec, createdAt, updatedAt: createdAt, artMediaIds: [] });

describe('sort helpers', () => {
  const lists = [pl(1, 'Road trip', 100, 600), pl(2, 'Focus', 300, 60), pl(3, 'Chill 10', 200, 1800), pl(4, 'Chill 2', 200, 1800)];

  it('labels the date-added sort as recently added', () => {
    expect(SORT_LABELS.added).toBe('Recently Added');
  });

  it('sorts playlists newest first by creation date', () => {
    expect(sortPlaylists(lists, 'added', true).map((p) => p.id)).toEqual([2, 4, 3, 1]);
    expect(sortPlaylists(lists, 'added', false).map((p) => p.id)).toEqual([1, 3, 4, 2]);
  });

  it('sorts playlists by name with natural number order and by length', () => {
    expect(sortPlaylists(lists, 'title', false).map((p) => p.name)).toEqual(['Chill 2', 'Chill 10', 'Focus', 'Road trip']);
    expect(sortPlaylists(lists, 'duration', true).map((p) => p.id)).toEqual([4, 3, 1, 2]);
  });

  it('does not reorder the original list', () => {
    const before = lists.map((p) => p.id);
    sortPlaylists(lists, 'added', true);
    expect(lists.map((p) => p.id)).toEqual(before);
  });

  it('maps view sort keys onto what the album and series queries accept', () => {
    expect(albumSortKey('name')).toBe('artist');
    expect(albumSortKey('added')).toBe('added');
    expect(albumSortKey('size')).toBe('title');
    expect(seriesSortKey('played')).toBe('played');
    expect(seriesSortKey('year')).toBe('title');
  });
});
