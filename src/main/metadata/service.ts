import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { MetaApplyTarget, MetaCandidate, MetaKind, MetaMatch, MetaProvider, MetaRunResult } from '@shared/metadata';
import type { Db } from '../db/database';
import type { LibraryRepo } from '../db/repo';
import type { AppPaths } from '../paths';
import type { SettingsStore } from '../settings-store';
import { logger } from '../log';
import { MetaHttp, type FetchFn } from './http';
import { searchAniList, searchMusicBrainz, searchTmdb } from './providers';

const log = logger('meta');
/** Auto-match only accepts a candidate this close to the title; anything lower is left for "Fix Match". */
export const AUTO_THRESHOLD = 0.85;

interface MatchRow { kind: string; key: string; provider: string; ext_id: string; title: string; year: number | null; plot: string | null; genres: string | null; poster: string | null; locked: number }

/** Online lookups, strictly opt-in. Matches are stored per show/movie/album and applied to media rows without touching files. */
export class MetadataService {
  private readonly http: MetaHttp;

  constructor(private readonly db: Db, private readonly repo: LibraryRepo, private readonly paths: AppPaths, private readonly settings: SettingsStore, fetchFn?: FetchFn) {
    this.http = new MetaHttp(db, fetchFn);
  }

  private cfg() { return this.settings.get().metadata; }

  private requireEnabled(): void {
    if (!this.cfg().enabled) throw new Error('Online metadata is turned off. Enable it in Settings → Metadata.');
  }

  async search(kind: MetaKind, query: string, year?: number): Promise<MetaCandidate[]> {
    this.requireEnabled();
    const c = this.cfg();
    const q = query.trim();
    if (!q) return [];
    const jobs: Promise<MetaCandidate[]>[] = [];
    if (kind === 'series') {
      if (c.anilist) jobs.push(searchAniList(this.http, q));
      if (c.tmdb && c.tmdbKey) jobs.push(searchTmdb(this.http, c.tmdbKey, 'series', q, year, c.language));
    } else if (kind === 'movie') {
      if (c.tmdb && c.tmdbKey) jobs.push(searchTmdb(this.http, c.tmdbKey, 'movie', q, year, c.language));
    } else if (c.musicbrainz) {
      const [album, artist = ''] = q.split('\u0001');
      jobs.push(searchMusicBrainz(this.http, album!, artist));
    }
    const settled = await Promise.allSettled(jobs);
    const ok = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    if (ok.length === 0) {
      const failed = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) throw failed.reason as Error;
    }
    return ok.sort((a, b) => b.score - a.score);
  }

  matchFor(t: MetaApplyTarget): MetaMatch | null {
    const r = this.db.get<MatchRow>('SELECT * FROM meta_match WHERE kind = ? AND key = ?', [t.kind, t.key]);
    return r ? { provider: r.provider as MetaProvider, id: r.ext_id, title: r.title, year: r.year, plot: r.plot, genres: r.genres ? (JSON.parse(r.genres) as string[]) : [], poster: r.poster, locked: !!r.locked } : null;
  }

  clear(t: MetaApplyTarget): void {
    this.db.run('DELETE FROM meta_match WHERE kind = ? AND key = ?', [t.kind, t.key]);
  }

  /** Store the match, then write it onto the library rows. Manual picks are locked so auto-match never replaces them. */
  async apply(t: MetaApplyTarget, c: MetaCandidate, opts: { locked?: boolean } = {}): Promise<number> {
    this.requireEnabled();
    const locked = opts.locked ?? true;
    this.db.run(
      `INSERT OR REPLACE INTO meta_match (kind, key, provider, ext_id, title, year, plot, genres, poster, locked, matched_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [t.kind, t.key, c.provider, c.id, c.title, c.year ?? null, c.plot ?? null, JSON.stringify(c.genres), c.poster ?? null, locked ? 1 : 0, Date.now()]
    );
    const artKey = c.poster ? await this.downloadPoster(c) : null;
    const where = t.kind === 'series' ? "kind = 'video' AND series_key = ?" : t.kind === 'movie' ? "kind = 'video' AND id = ?" : "kind = 'music' AND album_key = ?";
    const arg = t.kind === 'movie' ? Number(t.key) : t.key;
    const rows = this.db.all<{ id: number; art_src: string | null }>(`SELECT id, art_src FROM media WHERE ${where} AND missing = 0`, [arg]);
    return this.db.tx(() => {
      for (const r of rows) {
        // Local artwork (folder.jpg, embedded covers) wins; the online poster only fills gaps and video-frame fallbacks.
        if (artKey && (r.art_src == null || r.art_src === 'frame')) this.repo.setArt(r.id, artKey.key, `file:${artKey.file}`);
        if (t.kind === 'movie') {
          this.db.run('UPDATE media SET plot = COALESCE(NULLIF(plot, \'\'), ?), year = COALESCE(year, ?), genre = COALESCE(NULLIF(genre, \'\'), ?) WHERE id = ?', [c.plot ?? null, c.year ?? null, c.genres.join(', ') || null, r.id]);
        } else if (t.kind === 'series') {
          this.db.run('UPDATE media SET year = COALESCE(year, ?), genre = COALESCE(NULLIF(genre, \'\'), ?) WHERE id = ?', [c.year ?? null, c.genres.join(', ') || null, r.id]);
        }
      }
      return rows.length;
    });
  }

  private async downloadPoster(c: MetaCandidate): Promise<{ key: string; file: string } | null> {
    const key = 'mt' + createHash('sha1').update(`${c.provider}:${c.id}`).digest('hex').slice(0, 20);
    const dir = join(this.paths.art, 'online');
    const file = join(dir, `${key}.jpg`);
    if (existsSync(file)) return { key, file };
    try {
      const res = await fetch(c.poster!, { signal: AbortSignal.timeout(20_000), redirect: 'follow' });
      if (!res.ok) return null;
      await mkdir(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, Buffer.from(await res.arrayBuffer()));
      await rename(tmp, file);
      return { key, file };
    } catch (err) {
      log.warn('Poster download failed:', (err as Error).message);
      return null;
    }
  }

  /** Match every show and movie that has no stored match yet, keeping only confident hits. */
  async autoMatch(): Promise<MetaRunResult> {
    this.requireEnabled();
    const res: MetaRunResult = { matched: 0, skipped: 0, failed: 0 };
    const shows = this.db.all<{ key: string; name: string; year: number | null }>(
      `SELECT series_key AS key, MIN(series) AS name, MIN(year) AS year FROM media WHERE kind = 'video' AND series IS NOT NULL AND missing = 0 AND vclass = 'episode'
       AND series_key NOT IN (SELECT key FROM meta_match WHERE kind = 'series') GROUP BY series_key`);
    const movies = this.db.all<{ key: string; name: string; year: number | null }>(
      `SELECT CAST(id AS TEXT) AS key, title AS name, year FROM media WHERE kind = 'video' AND vclass = 'movie' AND missing = 0 AND CAST(id AS TEXT) NOT IN (SELECT key FROM meta_match WHERE kind = 'movie')`);
    const todo: [MetaKind, { key: string; name: string; year: number | null }][] = [...shows.map((s) => ['series', s] as [MetaKind, typeof s]), ...movies.map((m) => ['movie', m] as [MetaKind, typeof m])];
    for (const [kind, item] of todo) {
      try {
        const best = (await this.search(kind, item.name, item.year ?? undefined))[0];
        if (!best || best.score < AUTO_THRESHOLD) { res.skipped++; continue; }
        await this.apply({ kind, key: item.key }, best, { locked: false });
        res.matched++;
      } catch (err) {
        log.warn(`Match failed for "${item.name}":`, (err as Error).message);
        res.failed++;
        if (/key|turned off/i.test((err as Error).message)) break;
      }
    }
    return res;
  }
}
