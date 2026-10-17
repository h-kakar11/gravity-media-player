import type { MetaCandidate } from '@shared/metadata';
import type { MetaHttp } from './http';

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

export async function searchTmdb(http: MetaHttp, key: string, kind: 'movie' | 'series', query: string, year: number | undefined, lang: string): Promise<MetaCandidate[]> {
  const path = kind === 'movie' ? 'movie' : 'tv';
  const params = new URLSearchParams({ query, language: lang, include_adult: 'false' });
  if (year) params.set(kind === 'movie' ? 'year' : 'first_air_date_year', String(year));
  // A v4 read token (starts "eyJ") goes in a header; a v3 key is a query parameter. Either way the
  // explicit cacheKey keeps the credential out of the cache table.
  const bearer = /^eyJ/.test(key);
  if (!bearer) params.set('api_key', key);
  const res = await http.json<{ results?: TmdbItem[] }>(`${TMDB}/search/${path}?${params}`, {
    init: bearer ? { headers: { Authorization: `Bearer ${key}` } } : undefined,
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
