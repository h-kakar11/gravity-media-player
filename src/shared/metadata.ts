export type MetaKind = 'series' | 'movie' | 'album';
export type MetaProvider = 'anilist' | 'tmdb' | 'musicbrainz';

/** What a match is attached to: a show (lower-cased series name), a movie (media id) or an album (album_key). */
export interface MetaApplyTarget { kind: MetaKind; key: string }

export interface MetaCandidate {
  provider: MetaProvider;
  id: string;
  kind: MetaKind;
  title: string;
  year?: number;
  plot?: string;
  genres: string[];
  poster?: string;
  /** Title similarity to the query, 0..1. */
  score: number;
}

export interface MetaMatch {
  provider: MetaProvider;
  id: string;
  title: string;
  year: number | null;
  plot: string | null;
  genres: string[];
  poster: string | null;
  locked: boolean;
}

export interface MetaRunResult { matched: number; skipped: number; failed: number }
