import type {
  NewEpisodeCounts, UpNextEntry, WatchAction, WatchlistEntry, WatchlistTarget, WatchOverview, WatchShow, WatchUpdateResult
} from '@shared/watch';
import { watchKey } from '@shared/watch';
import type { MediaItem } from '@shared/types';
import type { Db } from '../db/database';
import type { LibraryRepo } from '../db/repo';
import { compareUpNext, planShow, type EpisodeRow, type ShowPlan } from './upnext';

/** Most shows Up Next will list; the Home shelf shows fewer. */
const UP_NEXT_LIMIT = 30;

type Row = Record<string, unknown>;
const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : d);
const nnum = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : null);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);

const EPISODE = "m.kind = 'video' AND m.vclass = 'episode' AND m.series_key IS NOT NULL";

/** Shows the user has any relationship with: played, watchlisted, hidden or dismissed. Only these are worth planning. */
const FOLLOWED = `
  WITH followed(key) AS (
    SELECT m.series_key FROM media m JOIN state s ON s.media_id = m.id
      WHERE ${EPISODE} AND (s.last_played_at IS NOT NULL OR s.completed = 1 OR s.position > 10)
    UNION SELECT m.series_key FROM history h JOIN media m ON m.id = h.media_id WHERE ${EPISODE}
    UNION SELECT series_key FROM watchlist WHERE series_key IS NOT NULL
    UNION SELECT series_key FROM show_tracking
  )`;

/** Earliest sign the user started watching each show, from any record of playback (missing files included). */
const FIRST_ACTIVITY = `
  SELECT key, MIN(t) AS first FROM (
    SELECT m.series_key AS key, s.last_played_at AS t FROM media m JOIN state s ON s.media_id = m.id WHERE ${EPISODE} AND s.last_played_at IS NOT NULL
    UNION ALL SELECT m.series_key, s.completed_at FROM media m JOIN state s ON s.media_id = m.id WHERE ${EPISODE} AND s.completed_at IS NOT NULL
    UNION ALL SELECT m.series_key, h.started_at FROM history h JOIN media m ON m.id = h.media_id WHERE ${EPISODE}
  ) GROUP BY key`;

interface ShowState {
  key: string;
  title: string;
  plan: ShowPlan;
  seasons: number;
  artId: number | null;
  hiddenAt: number | null;
}

/**
 * Watchlist, Up Next and new-episode state. The watchlist and the per-show "seen"/"hidden" marks are stored; Up Next
 * and new-episode counts are always derived from playback state and `media.added_at`, so they cannot drift.
 */
export class WatchService {
  constructor(
    private readonly db: Db,
    private readonly repo: LibraryRepo,
    private readonly now: () => number = Date.now
  ) {}

  // ---------------------------------------------------------------------------
  // Reads

  overview(): WatchOverview {
    const shows = this.shows();
    return { upNext: this.upNext(shows), watchlist: this.watchlist(shows) };
  }

  /** Watchlist membership as `watchKey`s, cheap enough to keep in the renderer for context menus and toggles. */
  keys(): string[] {
    return this.db.all<Row>('SELECT kind, media_id, series_key FROM watchlist ORDER BY position, id')
      .map((r) => (r.kind === 'movie' ? watchKey({ kind: 'movie', id: num(r.media_id) }) : watchKey({ kind: 'show', key: str(r.series_key) })));
  }

  /** series_key → new unplayed episodes, for shows the user follows. */
  badges(): NewEpisodeCounts {
    const out: NewEpisodeCounts = {};
    for (const s of this.shows().values()) if (s.plan.newEpisodes > 0) out[s.key] = s.plan.newEpisodes;
    return out;
  }

  // ---------------------------------------------------------------------------
  // Writes

  update(action: WatchAction): WatchUpdateResult {
    const changed = this.db.tx(() => this.apply(action));
    return { overview: this.overview(), changed };
  }

  private apply(action: WatchAction): number {
    switch (action.type) {
      case 'add': return this.add(this.resolve(action.target));
      case 'remove': return this.remove(this.resolve(action.target, false));
      case 'reorder': return this.reorder(action.ids);
      case 'clearWatched': return this.clearWatched();
      case 'hideUpNext': return this.track(action.seriesKey, 'hidden_at');
      case 'markSeen': return this.track(action.seriesKey, 'seen_at');
      default: throw new Error('Unknown watchlist action');
    }
  }

  /**
   * Normalise a target. Adding an episode adds its show: a single episode is not something you "plan to watch".
   * With `validate` off (removal) a target that no longer exists in the library is still accepted, so a stale
   * entry can always be removed.
   */
  private resolve(target: WatchlistTarget, validate = true): Resolved {
    if (!target || (target.kind !== 'movie' && target.kind !== 'show')) throw new Error('Unknown watchlist item');
    if (target.kind === 'show') {
      if (typeof target.key !== 'string' || target.key === '') throw new Error('Unknown show');
      return this.resolveShow(target.key, validate);
    }
    if (!Number.isInteger(target.id)) throw new Error('Unknown movie');
    const m = this.db.get<Row>('SELECT id, kind, vclass, title, series_key FROM media WHERE id = ?', [target.id]);
    if (!m) {
      if (validate) throw new Error('That item is no longer in the library');
      return { kind: 'movie', id: target.id, title: '' };
    }
    if (m.kind !== 'video') throw new Error('Only movies and shows can be added to the watchlist');
    if (m.vclass === 'episode') {
      if (typeof m.series_key !== 'string') throw new Error('This episode does not belong to a show');
      return this.resolveShow(m.series_key, validate);
    }
    return { kind: 'movie', id: target.id, title: str(m.title) };
  }

  private resolveShow(key: string, validate: boolean): Resolved {
    const s = this.db.get<Row>(`SELECT MIN(m.series) AS title, COUNT(*) AS n FROM media m WHERE ${EPISODE} AND m.missing = 0 AND m.series_key = ?`, [key]);
    if (validate && num(s?.n) === 0) throw new Error('That show is not in the library');
    return { kind: 'show', key, title: str(s?.title) || key };
  }

  private add(t: Resolved): number {
    const next = num(this.db.get<Row>('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM watchlist')?.p);
    const sql = t.kind === 'movie'
      ? 'INSERT OR IGNORE INTO watchlist (kind, media_id, title, added_at, position) VALUES (?, ?, ?, ?, ?)'
      : 'INSERT OR IGNORE INTO watchlist (kind, series_key, title, added_at, position) VALUES (?, ?, ?, ?, ?)';
    return this.db.run(sql, [t.kind, t.kind === 'movie' ? t.id : t.key, t.title, this.now(), next]).changes;
  }

  private remove(t: Resolved): number {
    return t.kind === 'movie'
      ? this.db.run('DELETE FROM watchlist WHERE media_id = ?', [t.id]).changes
      : this.db.run('DELETE FROM watchlist WHERE series_key = ?', [t.key]).changes;
  }

  private reorder(ids: number[]): number {
    if (!Array.isArray(ids)) throw new Error('Invalid order');
    const current = this.db.all<Row>('SELECT id, position FROM watchlist ORDER BY position, id').map((r) => ({ id: num(r.id), position: num(r.position) }));
    const known = new Set(current.map((c) => c.id));
    const listed: number[] = [];
    for (const id of ids) if (known.has(id) && !listed.includes(id)) listed.push(id);
    const order = [...listed, ...current.map((c) => c.id).filter((id) => !listed.includes(id))];
    let changed = 0;
    order.forEach((id, position) => {
      if (current.find((c) => c.id === id)!.position === position) return;
      this.db.run('UPDATE watchlist SET position = ? WHERE id = ?', [position, id]);
      changed++;
    });
    return changed;
  }

  /** Drop finished entries. Entries whose files are offline are kept: "unavailable" is not "watched". */
  private clearWatched(): number {
    let changed = 0;
    for (const e of this.watchlist(this.shows())) {
      if (!e.available || !e.watched) continue;
      changed += this.db.run('DELETE FROM watchlist WHERE id = ?', [e.id]).changes;
    }
    return changed;
  }

  private track(seriesKey: string, column: 'seen_at' | 'hidden_at'): number {
    if (typeof seriesKey !== 'string' || seriesKey === '') throw new Error('Unknown show');
    // The column name is one of two literals chosen by this class, never caller text.
    this.db.run(
      `INSERT INTO show_tracking (series_key, ${column}) VALUES (?, ?) ON CONFLICT(series_key) DO UPDATE SET ${column} = excluded.${column}`,
      [seriesKey, this.now()]
    );
    return 1;
  }

  // ---------------------------------------------------------------------------
  // Planning

  /** Plan every followed show in three queries. */
  private shows(): Map<string, ShowState> {
    const episodes = this.db.all<Row>(
      `${FOLLOWED}
       SELECT m.id, m.series_key AS key, m.series AS series, m.season, m.episode, m.added_at, m.art_src IS NOT NULL AS has_art,
              COALESCE(s.completed, 0) AS done, COALESCE(s.position, 0) AS pos, s.last_played_at AS last
       FROM media m LEFT JOIN state s ON s.media_id = m.id
       WHERE ${EPISODE} AND m.missing = 0 AND m.series_key IN (SELECT key FROM followed)`
    );
    const first = new Map(this.db.all<Row>(FIRST_ACTIVITY).map((r) => [str(r.key), nnum(r.first)]));
    const tracking = new Map(this.db.all<Row>('SELECT series_key, seen_at, hidden_at FROM show_tracking').map((r) => [str(r.series_key), r]));
    const listed = new Map(this.db.all<Row>("SELECT series_key, added_at FROM watchlist WHERE kind = 'show'").map((r) => [str(r.series_key), num(r.added_at)]));

    const byShow = new Map<string, Row[]>();
    for (const e of episodes) {
      const key = str(e.key);
      const list = byShow.get(key);
      if (list) list.push(e); else byShow.set(key, [e]);
    }

    const out = new Map<string, ShowState>();
    for (const [key, rows] of byShow) {
      const episodeRows: EpisodeRow[] = rows.map((r) => ({
        id: num(r.id), season: nnum(r.season), episode: nnum(r.episode), addedAt: num(r.added_at),
        completed: num(r.done) === 1, started: num(r.done) !== 1 && num(r.pos) > 10, lastPlayedAt: nnum(r.last)
      }));
      const t = tracking.get(key);
      const seen = nnum(t?.seen_at);
      const baseline = seen ?? earliest(first.get(key) ?? null, listed.get(key) ?? null);
      const art = rows
        .filter((r) => num(r.has_art) === 1)
        .sort((a, b) => num(a.season) - num(b.season) || num(a.episode) - num(b.episode) || num(a.id) - num(b.id))[0];
      out.set(key, {
        key,
        title: rows.map((r) => str(r.series)).sort()[0] || key,
        plan: planShow(episodeRows, baseline),
        seasons: new Set(rows.map((r) => num(r.season, 1))).size,
        artId: art ? num(art.id) : null,
        hiddenAt: nnum(t?.hidden_at)
      });
    }
    return out;
  }

  private upNext(shows: Map<string, ShowState>): UpNextEntry[] {
    const picked = [...shows.values()]
      .filter((s) => s.plan.inProgress && s.plan.next && !(s.hiddenAt != null && s.hiddenAt >= s.plan.lastPlayedAt))
      .sort((a, b) => compareUpNext({ ...a.plan, title: a.title, key: a.key }, { ...b.plan, title: b.title, key: b.key }))
      .slice(0, UP_NEXT_LIMIT);
    const items = new Map(this.repo.getMany(picked.map((s) => s.plan.next!.rowId)).map((m) => [m.id, m]));
    const out: UpNextEntry[] = [];
    for (const s of picked) {
      const episode = items.get(s.plan.next!.rowId);
      if (!episode) continue;
      out.push({
        seriesKey: s.key, showTitle: s.title, episode, lastPlayedAt: s.plan.lastPlayedAt, playedCount: s.plan.playedCount,
        episodeCount: s.plan.episodeCount, newEpisodes: s.plan.newEpisodes, isNew: s.plan.next!.isNew
      });
    }
    return out;
  }

  private watchlist(shows: Map<string, ShowState>): WatchlistEntry[] {
    const rows = this.db.all<Row>('SELECT id, kind, media_id, series_key, title, added_at FROM watchlist ORDER BY position, id');
    const movies = new Map<number, MediaItem>(
      this.repo.getMany(rows.filter((r) => r.kind === 'movie').map((r) => num(r.media_id))).map((m) => [m.id, m])
    );
    return rows.map((r): WatchlistEntry => {
      const base = { id: num(r.id), addedAt: num(r.added_at) };
      if (r.kind === 'movie') {
        const movie = movies.get(num(r.media_id)) ?? null;
        return {
          ...base, kind: 'movie', target: { kind: 'movie', id: num(r.media_id) }, title: movie?.title || str(r.title),
          available: !!movie && !movie.missing, watched: !!movie?.completed, movie, show: null
        };
      }
      const key = str(r.series_key);
      const s = shows.get(key);
      const show: WatchShow | null = s
        ? {
            key, title: s.title, seasonCount: s.seasons, episodeCount: s.plan.episodeCount, completedCount: s.plan.playedCount,
            artMediaId: s.artId, lastPlayedAt: s.plan.lastPlayedAt || null, newEpisodes: s.plan.newEpisodes
          }
        : null;
      return {
        ...base, kind: 'show', target: { kind: 'show', key }, title: s?.title || str(r.title), available: !!s, show,
        watched: !!s && s.plan.episodeCount > 0 && s.plan.playedCount >= s.plan.episodeCount, movie: null
      };
    });
  }
}

type Resolved = { kind: 'movie'; id: number; title: string } | { kind: 'show'; key: string; title: string };

function earliest(a: number | null, b: number | null): number | null {
  return a == null ? b : b == null ? a : Math.min(a, b);
}
