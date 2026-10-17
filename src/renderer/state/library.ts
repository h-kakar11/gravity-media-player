import { create } from 'zustand';
import type { LibraryRoot, Playlist, ScanProgress } from '@shared/types';
import { invoke, on } from '../api';
import { toast } from './ui';

interface LibraryState {
  /** Bumps whenever library contents change, so queries re-run. */
  revision: number;
  roots: LibraryRoot[];
  rootsLoaded: boolean;
  scan: ScanProgress | null;
  playlists: Playlist[];
  refreshRoots: () => Promise<void>;
  refreshPlaylists: () => Promise<void>;
}

export const useLibrary = create<LibraryState>((set) => ({
  revision: 0,
  roots: [],
  rootsLoaded: false,
  scan: null,
  playlists: [],
  refreshRoots: async () => set({ roots: await invoke('roots:list'), rootsLoaded: true }),
  refreshPlaylists: async () => set({ playlists: await invoke('playlists:list') })
}));

let scanClear: ReturnType<typeof setTimeout> | null = null;

export function initLibrary(): void {
  const st = useLibrary.getState();
  void st.refreshRoots();
  void st.refreshPlaylists();

  let bumpTimer: ReturnType<typeof setTimeout> | null = null;
  on('library:changed', (c) => {
    // Coalesce bursts (a scan emits many) into at most ~3 refreshes per second.
    if (!bumpTimer) {
      bumpTimer = setTimeout(() => {
        bumpTimer = null;
        useLibrary.setState((s) => ({ revision: s.revision + 1 }));
        void useLibrary.getState().refreshRoots();
        void useLibrary.getState().refreshPlaylists();
      }, 350);
    }
    if (c.added > 0 && !useLibrary.getState().scan) toast('info', c.added === 1 ? 'Added 1 new item to your library' : `Added ${c.added} new items to your library`);
  });
  on('roots:changed', () => void useLibrary.getState().refreshRoots());
  on('scan:progress', (p) => {
    if (scanClear) clearTimeout(scanClear);
    if (p.phase === 'done' || p.phase === 'offline') {
      useLibrary.setState({ scan: null });
      void useLibrary.getState().refreshRoots();
      if (p.phase === 'offline') toast('error', 'A library folder is offline. Its items stay in your library until it returns.');
    } else {
      useLibrary.setState({ scan: p });
      scanClear = setTimeout(() => useLibrary.setState({ scan: null }), 8000);
    }
  });
}
