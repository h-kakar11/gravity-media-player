/**
 * Portable profile: ratings, favourites, playlists, watch progress, history and metadata matches in one versioned
 * JSON file that can be restored on another machine or after the library has moved.
 *
 * Media is identified by its path relative to its library folder plus its file size, never by database id or
 * absolute path. Settings, API keys, tokens and folder locations are never part of the file.
 */

export const PROFILE_FORMAT = 'gravity-profile';
export const PROFILE_VERSION = 1;

export interface ProfileState {
  favorite: boolean;
  /** 0–5; 0 = unrated. */
  rating: number;
  notes: string;
  playCount: number;
  lastPlayedAt: number | null;
  positionSec: number;
  /** 0–1 */
  progress: number;
  completed: boolean;
  completedAt: number | null;
}

export interface ProfileHistory { kind: string; startedAt: number; watchedSec: number; mediaSec: number; fromSec: number; toSec: number; speed: number }

export interface ProfileMedia {
  /** Path relative to the library folder, `/`-separated. */
  rel: string;
  /** Name of the library folder it was in (a tie-breaker only; folders may be renamed or moved). */
  root: string;
  size: number;
  kind: string;
  title: string;
  state?: ProfileState;
  history?: ProfileHistory[];
}

export interface ProfilePlaylist { name: string; description: string; createdAt: number; /** Indexes into `media`. */ items: number[] }

export interface ProfileMatch {
  kind: 'series' | 'movie' | 'album';
  /** Show / album key. Unused for movies, which point at `media`. */
  key: string;
  /** Index into `media` for movie matches. */
  media?: number;
  provider: string;
  extId: string;
  title: string;
  year: number | null;
  plot: string | null;
  genres: string[];
  poster: string | null;
  locked: boolean;
  matchedAt: number;
}

export interface ProfileFile {
  format: typeof PROFILE_FORMAT;
  version: number;
  exportedAt: number;
  appVersion: string;
  media: ProfileMedia[];
  playlists: ProfilePlaylist[];
  /** Favourite albums and shows. */
  favorites: { type: 'album' | 'series'; key: string }[];
  matches: ProfileMatch[];
}

/** What to do when the backup and this library disagree about the same thing (ratings, notes, matches, playlist rules). */
export type ConflictPolicy = 'keep' | 'backup';

export interface ImportOptions { conflicts: ConflictPolicy }

export interface ImportConflict { what: 'rating' | 'notes' | 'match'; title: string; mine: string; backup: string }

export interface ImportReport {
  /** True for a preview: nothing was written. */
  dryRun: boolean;
  version: number;
  exportedAt: number;
  appVersion: string;
  media: { total: number; matched: number; relocated: number; ambiguous: number; unmatched: number };
  /** Titles of backup entries that could not be placed (capped). */
  ambiguousSamples: string[];
  unmatchedSamples: string[];
  state: { added: number; updated: number; unchanged: number };
  history: { added: number; duplicate: number };
  playlists: { created: number; merged: number; itemsAdded: number; itemsSkipped: number };
  favorites: { added: number; unchanged: number };
  matches: { added: number; unchanged: number; replaced: number };
  conflicts: ImportConflict[];
  conflictCount: number;
  warnings: string[];
}

export interface ExportOutcome { path: string; media: number; playlists: number; history: number; matches: number }

export const PROFILE_LIMITS = { fileBytes: 200 * 1024 * 1024, media: 1_000_000, history: 2_000_000, playlists: 5_000, text: 20_000 } as const;
