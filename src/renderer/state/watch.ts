import { create } from 'zustand';
import { watchKey, type NewEpisodeCounts, type WatchAction, type WatchlistTarget, type WatchUpdateResult } from '@shared/watch';
import { invoke } from '../api';
import { useLibrary } from './library';
import { toast } from './ui';

/**
 * What cards, detail pages and menus need to know about the watchlist: which items are on it (so a bookmark can
 * be filled in) and how many new episodes each show has (for the card badge). The lists themselves are loaded by
 * the Watchlist page and Home through `watch:overview`.
 *
 * This store follows the library revision on its own, so nothing has to mount a hook for it to stay current.
 */
interface WatchState {
  keys: ReadonlySet<string>;
  badges: NewEpisodeCounts;
}

export const useWatch = create<WatchState>(() => ({ keys: new Set<string>(), badges: {} }));

let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

async function load(): Promise<void> {
  const mine = ++seq;
  try {
    const [keys, badges] = await Promise.all([invoke('watch:keys'), invoke('watch:badges')]);
    if (mine === seq) useWatch.setState({ keys: new Set(keys), badges });
  } catch {
    // Decoration only: without it cards simply show no bookmark or badge.
  }
}

function schedule(delay: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void load(); }, delay);
}

useLibrary.subscribe((s, prev) => { if (s.revision !== prev.revision) schedule(150); });
schedule(0);

/** Whether a movie or show is on the watchlist. Subscribes to changes. */
export function useOnWatchlist(target: WatchlistTarget): boolean {
  return useWatch((s) => s.keys.has(watchKey(target)));
}

/** Number of unplayed episodes added since the user started following a show. */
export function useNewEpisodes(seriesKey: string): number {
  return useWatch((s) => s.badges[seriesKey] ?? 0);
}

/** Apply a change, refresh everything that shows watchlist state, and report failure instead of throwing. */
export async function updateWatch(action: WatchAction): Promise<WatchUpdateResult | null> {
  try {
    const result = await invoke('watch:update', action);
    useLibrary.setState((s) => ({ revision: s.revision + 1 }));
    return result;
  } catch (err) {
    toast('error', (err as Error).message);
    return null;
  }
}

/** Add the target to the watchlist, or take it off if it is already there. Asks the database, not the cache. */
export async function toggleWatchlist(target: WatchlistTarget, title: string): Promise<void> {
  let on: boolean;
  try {
    on = (await invoke('watch:keys')).includes(watchKey(target));
  } catch (err) {
    toast('error', (err as Error).message);
    return;
  }
  const result = await updateWatch({ type: on ? 'remove' : 'add', target });
  if (result) toast('success', on ? `Removed “${title}” from your Watchlist` : `Added “${title}” to your Watchlist`);
}
