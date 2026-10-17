/**
 * Pure planning for Up Next and new-episode state. No database, no clock: the caller reads the episode rows
 * and the show's "following since" time and gets back what to show. Kept separate so the ordering and
 * edge cases can be tested exhaustively.
 */

export interface EpisodeRow {
  id: number;
  season: number | null;
  episode: number | null;
  /** When the file first entered the library. */
  addedAt: number;
  completed: boolean;
  /** Partly watched: past the first few seconds but not finished. */
  started: boolean;
  lastPlayedAt: number | null;
}

/** One numbered episode of a show. Several files for the same season and episode share a slot. */
interface Slot {
  season: number;
  episode: number;
  rows: EpisodeRow[];
  played: boolean;
  started: boolean;
  /** Earliest arrival among the copies, so a later duplicate does not make the episode "new". */
  addedAt: number;
}

export interface ShowPlan {
  /**
   * Numbered episodes outside season 0. Unnumbered files cannot be sequenced and are ignored; specials
   * (season 0) are never suggested, never count as progress and are not needed to finish a show.
   */
  episodeCount: number;
  playedCount: number;
  /** Most recent playback of any episode, 0 when none. */
  lastPlayedAt: number;
  /** The user has played or started at least one episode. */
  inProgress: boolean;
  /** The next unplayed episode after the furthest one reached, or null. */
  next: { rowId: number; season: number; episode: number; isNew: boolean } | null;
  /** Unplayed episodes that arrived after `followingSince` (0 when it is null). */
  newEpisodes: number;
}

function slotsOf(rows: readonly EpisodeRow[]): Slot[] {
  const bySlot = new Map<string, Slot>();
  for (const r of rows) {
    if (r.episode == null || !Number.isFinite(r.episode)) continue;
    const season = r.season ?? 1;
    const key = `${season}x${r.episode}`;
    let s = bySlot.get(key);
    if (!s) bySlot.set(key, (s = { season, episode: r.episode, rows: [], played: false, started: false, addedAt: r.addedAt }));
    s.rows.push(r);
    if (r.completed) s.played = true;
    else if (r.started) s.started = true;
    s.addedAt = Math.min(s.addedAt, r.addedAt);
  }
  return [...bySlot.values()].sort((a, b) => a.season - b.season || a.episode - b.episode);
}

/**
 * @param rows            every non-missing episode file of one show
 * @param followingSince  when the user started following the show (first playback, watchlist add, or the last
 *                        "mark as seen"); null when they are not following it, in which case nothing is new
 */
export function planShow(rows: readonly EpisodeRow[], followingSince: number | null): ShowPlan {
  const slots = slotsOf(rows);
  let lastPlayedAt = 0;
  for (const r of rows) if (r.lastPlayedAt != null && r.lastPlayedAt > lastPlayedAt) lastPlayedAt = r.lastPlayedAt;

  const main = slots.filter((s) => s.season !== 0);
  let frontier = -1;
  main.forEach((s, i) => { if (s.played || s.started) frontier = i; });

  // A new special is still news, so the badge counts every season.
  const isNew = (s: Slot) => followingSince != null && !s.played && !s.started && s.addedAt > followingSince;
  const newEpisodes = slots.filter(isNew).length;

  let next: ShowPlan['next'] = null;
  if (frontier >= 0) {
    const target = main.slice(frontier + 1).find((s) => !s.played && !s.started);
    if (target) {
      const row = [...target.rows].sort((a, b) => a.id - b.id)[0]!;
      next = { rowId: row.id, season: target.season, episode: target.episode, isNew: isNew(target) };
    }
  }
  return {
    episodeCount: main.length,
    playedCount: main.filter((s) => s.played).length,
    lastPlayedAt,
    inProgress: frontier >= 0,
    next,
    newEpisodes
  };
}

/** Up Next order: the show watched most recently first; ties by title so the list never shuffles. */
export function compareUpNext(a: { lastPlayedAt: number; title: string; key: string }, b: { lastPlayedAt: number; title: string; key: string }): number {
  return b.lastPlayedAt - a.lastPlayedAt || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}
