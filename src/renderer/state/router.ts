import { create } from 'zustand';
import type { SidebarId } from '../lib/sidebar';

export type VideoTab = 'all' | 'movies' | 'shows' | 'clips';
export type MusicTab = 'albums' | 'artists' | 'songs' | 'playlists';

export type Route =
  | { name: 'home' }
  | { name: 'videos'; tab?: VideoTab }
  | { name: 'show'; key: string }
  | { name: 'media'; id: number }
  | { name: 'music'; tab?: MusicTab }
  | { name: 'album'; key: string }
  | { name: 'artist'; key: string }
  | { name: 'playlist'; id: number }
  | { name: 'comics' }
  | { name: 'series'; key: string }
  | { name: 'books' }
  | { name: 'photos' }
  | { name: 'browse'; path: string | null }
  | { name: 'favorites' }
  | { name: 'watchlist' }
  | { name: 'history' }
  | { name: 'stats' }
  | { name: 'search'; q: string }
  | { name: 'settings'; pane?: string };

export const routeKey = (r: Route) => JSON.stringify(r);

/** Which sidebar entry should be highlighted for a route. */
export function sectionOf(r: Route): SidebarId | `playlist:${number}` | null {
  switch (r.name) {
    case 'home': return 'home';
    case 'videos': case 'show': return 'videos';
    case 'media': return 'videos';
    case 'music': case 'album': case 'artist': return 'music';
    case 'playlist': return `playlist:${r.id}`;
    case 'comics': case 'series': return 'comics';
    case 'books': return 'books';
    case 'photos': return 'photos';
    case 'browse': return 'browse';
    case 'favorites': return 'favorites';
    case 'watchlist': return 'watchlist';
    case 'history': return 'history';
    case 'stats': return 'stats';
    default: return null;
  }
}

interface RouterState {
  stack: Route[];
  index: number;
  route: Route;
  navigate: (r: Route, opts?: { replace?: boolean }) => void;
  back: () => void;
  forward: () => void;
  canBack: () => boolean;
  canForward: () => boolean;
}

export const useRouter = create<RouterState>((set, get) => ({
  stack: [{ name: 'home' }],
  index: 0,
  route: { name: 'home' },
  navigate: (r, opts) => {
    const { stack, index, route } = get();
    if (routeKey(r) === routeKey(route)) return;
    if (opts?.replace) {
      const next = stack.slice();
      next[index] = r;
      set({ stack: next, route: r });
      return;
    }
    const next = [...stack.slice(0, index + 1), r].slice(-100);
    set({ stack: next, index: next.length - 1, route: r });
  },
  back: () => {
    const { stack, index } = get();
    if (index > 0) set({ index: index - 1, route: stack[index - 1]! });
  },
  forward: () => {
    const { stack, index } = get();
    if (index < stack.length - 1) set({ index: index + 1, route: stack[index + 1]! });
  },
  canBack: () => get().index > 0,
  canForward: () => get().index < get().stack.length - 1
}));

export const navigate = (r: Route, opts?: { replace?: boolean }) => useRouter.getState().navigate(r, opts);
