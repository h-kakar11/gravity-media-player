import type { MetaCandidate, MetaEpisode } from '@shared/metadata';
import { MetaHttpError, type MetaHttp } from './http';

/** Similarity of two titles in 0..1 (token overlap on letters/digits, case and punctuation blind). */
export function titleScore(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const tx = new Set(x.split(' ')), ty = new Set(y.split(' '));
  let shared = 0;
  for (const t of tx) if (ty.has(t)) shared++;
  return (2 * shared) / (tx.size + ty.size);
}

const strip = (s?: string | null) => (s ? s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : undefined);

// ----- AniList (GraphQL, no key) -------------------------------------------------------------
const ANILIST = 'https://graphql.anilist.co';
const ANILIST_QUERY = `query ($q: String) { Page(perPage: 8) { media(search: $q, type: ANIME, sort: SEARCH_MATCH) {
  id title { romaji english native } seasonYear startDate { year } description(asHtml: false) genres coverImage { extraLarge large } } } }`;

interface AniMedia { id: number; title: { romaji?: string; english?: string }; seasonYear?: number; startDate?: { year?: number }; description?: string; genres?: string[]; coverImage?: { extraLarge?: string; large?: string } }

export async function searchAniList(http: MetaHttp, query: string): Promise<MetaCandidate[]> {
  const res = await http.json<{ data?: { Page?: { media?: AniMedia[] } } }>(ANILIST, {
    init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: ANILIST_QUERY, variables: { q: query } }) },
    gapMs: 700
  });
  return (res.data?.Page?.media ?? []).map((m) => {
    const names = [m.title.english, m.title.romaji].filter((n): n is string => !!n);
    return {
      provider: 'anilist', id: String(m.id), kind: 'series', title: names[0] ?? query, year: m.seasonYear ?? m.startDate?.year,
      plot: strip(m.description), genres: m.genres ?? [], poster: m.coverImage?.extraLarge ?? m.coverImage?.large,
      score: Math.max(0, ...names.map((n) => titleScore(query, n)))
    } satisfies MetaCandidate;
  });
}

// ----- TMDB (REST, user key) -----------------------------------------------------------------
const TMDB = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w780';
const TMDB_GENRES: Record<number, string> = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy',
  36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller',
  10752: 'War', 37: 'Western', 10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics'
};

interface TmdbItem { id: number; title?: string; name?: string; release_date?: string; first_air_date?: string; overview?: string; genre_ids?: number[]; poster_path?: string | null }

/** A v4 read token (starts "eyJ") goes in a header; a v3 key is a query parameter. Callers pass an explicit cacheKey so the credential never reaches the cache table. */
function tmdbAuth(key: string, params: URLSearchParams): RequestInit | undefined {
  if (/^eyJ/.test(key)) return { headers: { Authorization: `Bearer ${key}` } };
  params.set('api_key', key);
  return undefined;
}

export async function searchTmdb(http: MetaHttp, key: string, kind: 'movie' | 'series', query: string, year: number | undefined, lang: string): Promise<MetaCandidate[]> {
  const path = kind === 'movie' ? 'movie' : 'tv';
  const params = new URLSearchParams({ query, language: lang, include_adult: 'false' });
  if (year) params.set(kind === 'movie' ? 'year' : 'first_air_date_year', String(year));
  const init = tmdbAuth(key, params);
  const res = await http.json<{ results?: TmdbItem[] }>(`${TMDB}/search/${path}?${params}`, {
    init,
    cacheKey: `tmdb:${path}:${lang}:${year ?? ''}:${query.toLowerCase()}`
  }).catch((err: Error) => { throw new Error(`TMDB lookup failed (${err.message.replace(key, '***')}) — check the API key in Settings → Metadata`); });
  return (res.results ?? []).slice(0, 8).map((r) => {
    const title = r.title ?? r.name ?? query;
    const date = r.release_date ?? r.first_air_date;
    return {
      provider: 'tmdb', id: String(r.id), kind, title, year: date ? Number(date.slice(0, 4)) || undefined : undefined,
      plot: r.overview || undefined, genres: (r.genre_ids ?? []).map((g) => TMDB_GENRES[g]).filter((g): g is string => !!g),
      poster: r.poster_path ? `${TMDB_IMG}${r.poster_path}` : undefined, score: titleScore(query, title)
    } satisfies MetaCandidate;
  });
}

// ----- Episode lists -------------------------------------------------------------------------
/** One episode as a provider reports it, before it is stored. */
export type ProviderEpisode = MetaEpisode;

/** Providers answer "Episode 7" when they have no real title; that is no better than the placeholder we already have. */
const realTitle = (t?: string | null): string | null => {
  const s = t?.trim();
  return s && !/^episode\s*\d*$/i.test(s) ? s : null;
};

interface TmdbSeason { episodes?: { episode_number?: number; name?: string; overview?: string; air_date?: string | null }[] }

/** Episodes of one TMDB season. Resolves to null when TMDB has no such season, so callers can skip it rather than fail. */
export async function fetchTmdbSeason(http: MetaHttp, key: string, showId: string, season: number, lang: string): Promise<ProviderEpisode[] | null> {
  const params = new URLSearchParams({ language: lang });
  const init = tmdbAuth(key, params);
  try {
    const res = await http.json<TmdbSeason>(`${TMDB}/tv/${encodeURIComponent(showId)}/season/${season}?${params}`, { init, cacheKey: `tmdb:season:${lang}:${showId}:${season}` });
    return (res.episodes ?? [])
      .filter((e): e is typeof e & { episode_number: number } => Number.isInteger(e.episode_number))
      .map((e) => ({ season, episode: e.episode_number, title: realTitle(e.name), plot: e.overview?.trim() || null, airDate: e.air_date || null }));
  } catch (err) {
    if (err instanceof MetaHttpError && err.status === 404) return null;
    throw new Error(`TMDB lookup failed (${(err as Error).message.replace(key, '***')}) — check the API key in Settings → Metadata`);
  }
}

const ANILIST_EPISODES = `query ($id: Int) { Media(id: $id, type: ANIME) { episodes streamingEpisodes { title } } }`;
/** Anime entries are single seasons, and AniList lists far fewer episodes than a long-runner needs; keep the table bounded. */
const ANILIST_MAX_EPISODES = 3000;

/**
 * Episodes of one AniList entry, filed under season 1. AniList has no per-episode summaries, and titles only where a
 * streaming site published them ("Episode 3 - Title"); every episode up to the known count still gets a row.
 */
export async function fetchAniListEpisodes(http: MetaHttp, id: string): Promise<ProviderEpisode[]> {
  let res: { data?: { Media?: { episodes?: number | null; streamingEpisodes?: { title?: string | null }[] | null } | null } };
  try {
    res = await http.json(ANILIST, {
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: ANILIST_EPISODES, variables: { id: Number(id) } }) },
      gapMs: 700
    });
  } catch (err) {
    if (err instanceof MetaHttpError && err.status === 404) return [];
    throw new Error(`AniList lookup failed (${(err as Error).message})`);
  }
  const media = res.data?.Media;
  if (!media) return [];
  const titles = new Map<number, string>();
  for (const s of media.streamingEpisodes ?? []) {
    const m = /^\s*(?:episode|ep\.?)\s*(\d+)\s*[-–—:.]\s*(.+?)\s*$/i.exec(s.title ?? '');
    if (m && !titles.has(Number(m[1]))) titles.set(Number(m[1]), m[2]!);
  }
  const count = Math.min(ANILIST_MAX_EPISODES, Math.max(media.episodes ?? 0, ...titles.keys()));
  return Array.from({ length: count }, (_, i) => ({ season: 1, episode: i + 1, title: realTitle(titles.get(i + 1)), plot: null, airDate: null }));
}

// ----- MusicBrainz + Cover Art Archive (no key, 1 req/s) -------------------------------------
interface MbRelease { id: string; title: string; date?: string; score?: number; 'artist-credit'?: { name: string }[] }

export async function searchMusicBrainz(http: MetaHttp, album: string, artist: string): Promise<MetaCandidate[]> {
  const q = `release:"${album.replace(/"/g, '')}"${artist ? ` AND artist:"${artist.replace(/"/g, '')}"` : ''}`;
  const res = await http.json<{ releases?: MbRelease[] }>(`https://musicbrainz.org/ws/2/release/?${new URLSearchParams({ query: q, fmt: 'json', limit: '8' })}`, { gapMs: 1100 });
  return (res.releases ?? []).map((r) => ({
    provider: 'musicbrainz', id: r.id, kind: 'album', title: r.title, year: r.date ? Number(r.date.slice(0, 4)) || undefined : undefined,
    plot: undefined, genres: [], poster: `https://coverartarchive.org/release/${r.id}/front-500`,
    score: titleScore(album, r.title) * ((r.score ?? 100) / 100)
  } satisfies MetaCandidate));
}
