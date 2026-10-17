import type { MediaItem } from './types';

/**
 * Watchlist, Up Next and new-episode state (feature 04).
 *
 * Everything the renderer sees is keyed by database ids or by a show's `series_key` (the lower-cased series
 * name, the same key the Show page route uses). Paths never cross the IPC boundary.
 */

export type WatchlistKind = 'movie' | 'show';

/** What can be put on the watchlist: a movie by media id, or a show by series key. */
export type WatchlistTarget = { kind: 'movie'; id: number } | { kind: 'show'; key: string };

export interface WatchShow {
  key: string;
  title: string;
  seasonCount: number;
  episodeCount: number;
  completedCount: number;
  artMediaId: number | null;
  lastPlayedAt: number | null;
  /** Episodes that arrived after the user started following the show and have not been played. */
  newEpisodes: number;
}

export interface WatchlistEntry {
  /** Stable row id; used for reordering. */
  id: number;
  kind: WatchlistKind;
  /** What the entry points at; present even when the item is offline, so it can always be removed. */
  target: WatchlistTarget;
  addedAt: number;
  /** Title remembered when the entry was added, so an entry stays readable if its files go offline. */
  title: string;
  /** False when the movie file or every episode of the show is currently missing from the library. */
  available: boolean;
  /** Movie played, or every episode of the show played. */
  watched: boolean;
  movie: MediaItem | null;
  show: WatchShow | null;
}

export interface UpNextEntry {
  seriesKey: string;
  showTitle: string;
  /** The next unplayed episode after the furthest one the user has reached. */
  episode: MediaItem;
  lastPlayedAt: number;
  playedCount: number;
  episodeCount: number;
  /** Unplayed episodes added since the user started following the show. */
  newEpisodes: number;
  /** True when `episode` itself is one of the new ones. */
  isNew: boolean;
}

export interface WatchOverview {
  upNext: UpNextEntry[];
  watchlist: WatchlistEntry[];
}

export type WatchAction =
  | { type: 'add'; target: WatchlistTarget }
  | { type: 'remove'; target: WatchlistTarget }
  /** Entry ids in the order they should appear; entries not listed keep their relative order after them. */
  | { type: 'reorder'; ids: number[] }
  /** Drop watchlist entries that have been fully played. */
  | { type: 'clearWatched' }
  /** Stop suggesting a show in Up Next until it is played again. */
  | { type: 'hideUpNext'; seriesKey: string }
  /** Dismiss a show's new-episode badge. */
  | { type: 'markSeen'; seriesKey: string };

export interface WatchUpdateResult {
  overview: WatchOverview;
  /** Rows added, removed or changed by the action. */
  changed: number;
}

/** series_key → number of new episodes (only shows with at least one). */
export type NewEpisodeCounts = Record<string, number>;

/**
 * Stable string for a watchlist target, used by the renderer to know what is on the list. Show keys are opaque:
 * they are the database's `series_key`, passed back exactly as received (never re-cased or trimmed).
 */
export const watchKey = (t: WatchlistTarget): string => (t.kind === 'movie' ? `m:${t.id}` : `s:${t.key}`);
