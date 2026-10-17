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

/** Online title and summary for one episode of a matched show. Stored in `meta_episode`, never written onto the media rows. */
export interface MetaEpisode {
  season: number;
  episode: number;
  title: string | null;
  plot: string | null;
  /** ISO date (YYYY-MM-DD) when the provider knows it. */
  airDate: string | null;
}

/** Outcome of fetching episode info for a show. `failedSeasons` seasons could not be fetched; the rest were stored. */
export interface MetaEpisodeSync { seasons: number; episodes: number; failedSeasons: number }

/** `meta:apply` result. The match itself succeeded if this exists; `episodeError` says why episode info is missing. */
export interface MetaApplyResult {
  /** Library rows the match was applied to. */
  rows: number;
  /** Only for shows; null when the match was for a movie or album. */
  episodes: MetaEpisodeSync | null;
  episodeError: string | null;
}

export interface MetaRunResult {
  matched: number;
  skipped: number;
  failed: number;
  /** Already-matched shows whose episode info was fetched or refreshed in this run. */
  episodes: number;
}

/** The title the scanner invents when a file name carries none ("Episode 4"), which a real title should replace. */
export const isPlaceholderEpisodeTitle = (title: string | null | undefined): boolean => !title || /^episode\s*\d*$/i.test(title.trim());

/**
 * What to show for an episode. Local data (an `.nfo`, embedded tags, a title in the file name) always wins; the online
 * title and summary only fill what is missing, so nothing the user or their files said is ever replaced.
 */
export function mergeEpisodeText(local: { title: string; plot: string | null }, online?: Pick<MetaEpisode, 'title' | 'plot'> | null): { title: string; plot: string | null } {
  const title = !isPlaceholderEpisodeTitle(local.title) ? local.title : (online?.title?.trim() || local.title);
  const plot = local.plot?.trim() ? local.plot : (online?.plot?.trim() || null);
  return { title, plot };
}
