import { writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { parseLrc } from '@shared/lyrics';
import { LRCLIB_DURATION_TOLERANCE_SEC, type LrclibQuery, type LyricsSaveResult } from '@shared/lrclib';
import type { LyricsResult } from '@shared/types';
import type { Db } from '../db/database';
import type { LibraryRepo } from '../db/repo';
import { logger } from '../log';
import { MetaHttp, type FetchFn } from '../metadata/http';
import type { SettingsStore } from '../settings-store';

const log = logger('lrclib');
const BASE = 'https://lrclib.net/api';
const DAY = 86_400_000;
const FOUND_TTL = 30 * DAY;
const MISS_TTL = 7 * DAY;

interface LrclibRecord {
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number | null;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/**
 * Lyrics from LRCLIB (lrclib.net): free, no key. Opt-in (`lyrics.lrclib`). Sends the title, artist, album and
 * duration of the song being opened, nothing else. Hits are cached for 30 days and misses for 7 in `meta_cache`,
 * so a song is looked up at most once a week and offline use never errors.
 */
export class LrclibService {
  private readonly http: MetaHttp;

  constructor(private readonly db: Db, private readonly repo: LibraryRepo, private readonly settings: Pick<SettingsStore, 'get'>, fetchFn?: FetchFn, private readonly now: () => number = Date.now) {
    this.http = new MetaHttp(db, fetchFn, now);
  }

  enabled(): boolean { return this.settings.get().lyrics.lrclib; }

  queryFor(mediaId: number): LrclibQuery | null {
    const row = this.repo.getRow(mediaId);
    if (!row || String(row.kind) !== 'audio') return null;
    const title = String(row.title ?? '').trim();
    const artist = String(row.artist ?? row.album_artist ?? '').trim();
    if (!title || !artist) return null;
    const dur = Number(row.duration);
    return { title, artist, album: String(row.album ?? '').trim(), durationSec: Number.isFinite(dur) && dur > 0 ? Math.round(dur) : null };
  }

  /** Online lyrics as a `LyricsResult`, or null when LRCLIB has none (or the lookup is off / the song lacks tags). */
  async lyrics(mediaId: number): Promise<LyricsResult | null> {
    if (!this.enabled()) return null;
    const q = this.queryFor(mediaId);
    if (!q) return null;
    const rec = await this.find(q);
    if (!rec || rec.instrumental) return null;
    const synced = text(rec.syncedLyrics);
    if (synced) {
      const parsed = parseLrc(synced);
      if (parsed.synced && parsed.lines.length) return { ...parsed, source: 'lrclib' };
    }
    const plain = text(rec.plainLyrics);
    if (plain) {
      const parsed = parseLrc(plain);
      if (parsed.lines.length) return { synced: false, lines: parsed.lines, source: 'lrclib' };
    }
    return null;
  }

  /** Write the synced lyrics next to the song as `<name>.lrc`. Never overwrites an existing file. */
  async saveSidecar(mediaId: number): Promise<LyricsSaveResult> {
    if (!this.enabled()) throw new Error('Turn on LRCLIB lyrics in Settings → Audio first');
    const q = this.queryFor(mediaId);
    const row = this.repo.getRow(mediaId);
    if (!q || !row) throw new Error('This song has no title and artist to look up');
    const rec = await this.find(q);
    const synced = rec && !rec.instrumental ? text(rec.syncedLyrics) : null;
    if (!synced || !parseLrc(synced).synced) throw new Error('LRCLIB has no synced lyrics for this song');
    const path = String(row.path);
    const target = join(dirname(path), basename(path, extname(path)) + '.lrc');
    try {
      await writeFile(target, synced.endsWith('\n') ? synced : synced + '\n', { encoding: 'utf8', flag: 'wx' });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') throw new Error('A .lrc file already exists next to this song');
      if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') throw new Error('Gravity can’t write to this song’s folder');
      throw err;
    }
    return { path: target };
  }

  /** Exact lookup first, then a search filtered by duration. Returns null on "not found"; throws on network errors. */
  async find(q: LrclibQuery): Promise<LrclibRecord | null> {
    const norm = [q.artist, q.title, q.album, q.durationSec ?? ''].map((x) => String(x).toLowerCase().trim()).join('|');
    const missKey = `lrclib:miss:${norm}`;
    const miss = this.db.get<{ fetched_at: number }>('SELECT fetched_at FROM meta_cache WHERE key = ?', [missKey]);
    if (miss && this.now() - Number(miss.fetched_at) < MISS_TTL) return null;

    const get = new URLSearchParams({ track_name: q.title, artist_name: q.artist });
    if (q.album) get.set('album_name', q.album);
    if (q.durationSec != null) get.set('duration', String(q.durationSec));
    let rec: LrclibRecord | null = null;
    // /get needs the duration to be reliable; without one go straight to search.
    if (q.durationSec != null && q.album) {
      rec = await this.getOrNull<LrclibRecord>(`${BASE}/get?${get}`, `lrclib:get:${norm}`);
    }
    if (!rec || (!text(rec.syncedLyrics) && !text(rec.plainLyrics) && !rec.instrumental)) {
      const search = new URLSearchParams({ track_name: q.title, artist_name: q.artist });
      const list = await this.getOrNull<LrclibRecord[]>(`${BASE}/search?${search}`, `lrclib:search:${norm}`);
      rec = pickBest(Array.isArray(list) ? list : [], q) ?? rec;
    }
    if (!rec || (!rec.instrumental && !text(rec.syncedLyrics) && !text(rec.plainLyrics))) {
      this.db.run('INSERT OR REPLACE INTO meta_cache (key, json, fetched_at) VALUES (?, ?, ?)', [missKey, '{}', this.now()]);
      return null;
    }
    return rec;
  }

  private async getOrNull<T>(url: string, cacheKey: string): Promise<T | null> {
    try {
      return await this.http.json<T>(url, { cacheKey, ttlMs: FOUND_TTL });
    } catch (err) {
      if (/responded 404$/.test((err as Error).message)) return null;
      log.warn('lookup failed:', (err as Error).message);
      throw err;
    }
  }
}

/** Prefer synced lyrics, then the closest duration, among results within the tolerance. */
export function pickBest(list: LrclibRecord[], q: LrclibQuery): LrclibRecord | null {
  const candidates = list.filter((r) => {
    if (!text(r.syncedLyrics) && !text(r.plainLyrics) && !r.instrumental) return false;
    if (q.durationSec == null || typeof r.duration !== 'number') return true;
    return Math.abs(r.duration - q.durationSec) <= LRCLIB_DURATION_TOLERANCE_SEC;
  });
  candidates.sort((a, b) => {
    const sa = text(a.syncedLyrics) ? 0 : 1, sb = text(b.syncedLyrics) ? 0 : 1;
    if (sa !== sb) return sa - sb;
    const da = q.durationSec != null && typeof a.duration === 'number' ? Math.abs(a.duration - q.durationSec) : 0;
    const db = q.durationSec != null && typeof b.duration === 'number' ? Math.abs(b.duration - q.durationSec) : 0;
    return da - db;
  });
  return candidates[0] ?? null;
}
