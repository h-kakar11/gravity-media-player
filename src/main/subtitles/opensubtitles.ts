import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { normalizeLang } from '@shared/playback-plan';
import type { Settings } from '@shared/settings';
import { LANGUAGE_CODE, subtitleSidecarName, type SubtitleDownloadResult, type SubtitleHit, type SubtitleSearchRequest, type SubtitleSearchResult } from '@shared/subtitle-search';
import { parseSubtitles } from '@shared/subtitles';
import type { Db } from '../db/database';
import type { LibraryRepo } from '../db/repo';
import { logger } from '../log';
import { decodeSubtitleBytes } from '../media/subtitles';
import { MetaHttp, type FetchFn } from '../metadata/http';
import type { AppPaths } from '../paths';
import { movieHash } from './moviehash';

const log = logger('subtitles');

const API = 'https://api.opensubtitles.com/api/v1';
const UA = 'Gravity v1.0';
const SEARCH_TTL = 12 * 3_600_000;
const MAX_BYTES = 5 * 1024 * 1024;
const HOST_OK = /(^|\.)opensubtitles\.com$/i;

interface OsSearchResponse {
  data?: {
    attributes?: {
      language?: string;
      download_count?: number;
      hearing_impaired?: boolean;
      fps?: number;
      release?: string;
      moviehash_match?: boolean;
      uploader?: { name?: string };
      feature_details?: { title?: string; movie_name?: string };
      files?: { file_id?: number }[];
    };
  }[];
}

/** Opt-in OpenSubtitles.com client: search by file hash and title, download beside the video. */
export class SubtitleService {
  private readonly http: MetaHttp;
  private session: { token: string; base: string; at: number } | null = null;

  constructor(
    db: Db,
    private readonly repo: LibraryRepo,
    private readonly settings: { get(): Settings },
    private readonly paths: Pick<AppPaths, 'cache'>,
    private readonly fetchFn: FetchFn = (u, i) => fetch(u, i),
    private readonly now: () => number = Date.now
  ) {
    this.http = new MetaHttp(db, fetchFn, now);
  }

  /** Where downloads fall back to when the video's folder can't be written. */
  cacheDir(mediaId: number): string {
    return join(this.paths.cache, 'subtitles', String(mediaId));
  }

  private config() {
    const m = this.settings.get().metadata;
    if (!m.openSubtitles) throw new Error('Online subtitles are off. Turn them on in Settings → Metadata.');
    if (!m.openSubtitlesKey) throw new Error('Add your OpenSubtitles API key in Settings → Metadata.');
    return m;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { 'Api-Key': this.config().openSubtitlesKey, 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json', ...extra };
  }

  private static friendly(err: unknown): Error {
    const msg = (err as Error).message;
    if (/responded 401|responded 403/.test(msg)) return new Error('OpenSubtitles rejected the API key or login. Check Settings → Metadata.');
    if (/responded 429/.test(msg)) return new Error('OpenSubtitles rate limit reached. Try again in a minute.');
    if (/responded 406/.test(msg)) return new Error('You have used today’s OpenSubtitles download quota.');
    return err as Error;
  }

  async search(req: SubtitleSearchRequest): Promise<SubtitleSearchResult> {
    this.config();
    const row = this.repo.getRow(req.mediaId);
    if (!row || String(row.kind) !== 'video') throw new Error('Subtitles can only be searched for videos');
    const langs = [...new Set(req.languages.map((l) => l.trim().toLowerCase()).filter((l) => LANGUAGE_CODE.test(l)).map((l) => normalizeLang(l)))];
    const isEpisode = row.series != null && row.season != null && row.episode != null;
    const query = (req.query?.trim() || (isEpisode ? String(row.series) : String(row.title))).slice(0, 200);
    const hash = await movieHash(String(row.path)).catch(() => null);

    const q = new URLSearchParams();
    if (hash) q.set('moviehash', hash);
    q.set('query', query.toLowerCase());
    if (langs.length) q.set('languages', [...langs].sort().join(','));
    if (isEpisode) {
      q.set('season_number', String(row.season));
      q.set('episode_number', String(row.episode));
      q.set('type', 'episode');
    } else {
      if (row.year != null) q.set('year', String(row.year));
      q.set('type', 'movie');
    }
    q.set('order_by', 'download_count');
    q.sort();
    const url = `${API}/subtitles?${q}`;

    let body: OsSearchResponse;
    try {
      // The key is a header, and the cache key is derived from the query alone, so the key is never stored.
      body = await this.http.json<OsSearchResponse>(url, { init: { headers: this.headers() }, cacheKey: `opensubtitles:search:${q}`, ttlMs: SEARCH_TTL, gapMs: 700 });
    } catch (err) {
      throw SubtitleService.friendly(err);
    }

    const hits: SubtitleHit[] = [];
    for (const d of body.data ?? []) {
      const a = d.attributes;
      const fileId = a?.files?.[0]?.file_id;
      if (!a || typeof fileId !== 'number') continue;
      hits.push({
        fileId,
        title: a.feature_details?.movie_name || a.feature_details?.title || query,
        release: a.release ?? '',
        language: a.language ?? '',
        downloads: a.download_count ?? 0,
        hashMatch: a.moviehash_match === true,
        hearingImpaired: a.hearing_impaired === true,
        fps: typeof a.fps === 'number' && a.fps > 0 ? a.fps : null,
        uploader: a.uploader?.name ?? ''
      });
    }
    // Exact file matches first, then the most downloaded.
    hits.sort((x, y) => Number(y.hashMatch) - Number(x.hashMatch) || y.downloads - x.downloads);
    return { hits, query, hashed: !!hash };
  }

  private async login(): Promise<{ token: string; base: string } | null> {
    const m = this.settings.get().metadata;
    if (!m.openSubtitlesUser || !m.openSubtitlesPass) return null;
    // Tokens last 24 hours; keep one in memory only.
    if (this.session && this.now() - this.session.at < 20 * 3_600_000) return this.session;
    const res = await this.fetchFn(`${API}/login`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ username: m.openSubtitlesUser, password: m.openSubtitlesPass }), signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) throw new Error(res.status === 401 || res.status === 400 ? 'OpenSubtitles login failed. Check your username and password in Settings → Metadata.' : `OpenSubtitles login responded ${res.status}`);
    const j = (await res.json()) as { token?: string; base_url?: string };
    if (!j.token) throw new Error('OpenSubtitles login returned no token');
    const host = (j.base_url || 'api.opensubtitles.com').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const base = HOST_OK.test(host) ? `https://${host}/api/v1` : API;
    this.session = { token: j.token, base, at: this.now() };
    return this.session;
  }

  async download(mediaId: number, fileId: number, language: string, hearingImpaired: boolean): Promise<SubtitleDownloadResult> {
    this.config();
    const row = this.repo.getRow(mediaId);
    if (!row || String(row.kind) !== 'video') throw new Error('Media not found');
    if (!Number.isInteger(fileId) || fileId <= 0) throw new Error('Invalid subtitle');
    const video = String(row.path);

    const sess = await this.login();
    const res = await this.fetchFn(`${sess?.base ?? API}/download`, {
      method: 'POST',
      headers: this.headers(sess ? { Authorization: `Bearer ${sess.token}` } : {}),
      body: JSON.stringify({ file_id: fileId, sub_format: 'srt' }),
      signal: AbortSignal.timeout(20_000)
    });
    if (res.status === 401 && !sess) throw new Error('OpenSubtitles needs your username and password to download. Add them in Settings → Metadata.');
    if (!res.ok) throw SubtitleService.friendly(new Error(`opensubtitles responded ${res.status}`));
    const info = (await res.json()) as { link?: string; remaining?: number };
    if (!info.link || !/^https:\/\//i.test(info.link)) throw new Error('OpenSubtitles returned no download link');

    const file = await this.fetchFn(info.link, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
    if (!file.ok) throw new Error(`Subtitle download failed (${file.status})`);
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES) throw new Error('The downloaded subtitle was empty or too large');
    const text = decodeSubtitleBytes(buf, language);
    if (parseSubtitles(text, 'srt').length === 0) throw new Error('The downloaded file was not a usable subtitle');
    // Always stored as UTF-8, whatever encoding the uploader used.
    const out = Buffer.from(text.replace(/\r\n?/g, '\n'), 'utf8');

    const stem = basename(video, extname(video));
    const saved = await this.save(dirname(video), stem, language, hearingImpaired, out)
      .then((path) => ({ path, where: 'sidecar' as const }))
      .catch(async (err) => {
        log.warn('Video folder not writable, using cache:', (err as Error).message);
        return { path: await this.save(this.cacheDir(mediaId), stem, language, hearingImpaired, out), where: 'cache' as const };
      });
    return { trackId: `ext:${saved.path}`, path: saved.path, where: saved.where, remaining: typeof info.remaining === 'number' ? info.remaining : null };
  }

  /** Write without clobbering: identical content is reused, a different file gets a numbered name. */
  private async save(dir: string, stem: string, language: string, hi: boolean, data: Buffer): Promise<string> {
    await mkdir(dir, { recursive: true });
    for (let n = 1; n < 50; n++) {
      const target = join(dir, subtitleSidecarName(stem, language, hi, n));
      try {
        const existing = await readFile(target);
        if (existing.equals(data)) return target;
      } catch {
        await writeFile(target, data, { flag: 'wx' });
        return target;
      }
    }
    throw new Error('Too many subtitle files with this name');
  }
}
