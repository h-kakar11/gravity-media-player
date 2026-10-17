import { create } from 'zustand';
import type { MediaItem } from '@shared/types';

interface ReaderState {
  item: MediaItem | null;
  context: MediaItem[];
  open: (item: MediaItem, context?: MediaItem[]) => void;
  close: () => void;
}

export const useReader = create<ReaderState>((set) => ({
  item: null,
  context: [],
  open: (item, context = [item]) => set({ item, context }),
  close: () => set({ item: null })
}));
