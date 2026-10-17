import type { MediaItem } from './types';

/** Rule engine for smart playlists. Definitions are plain JSON, validated on the main side before any SQL is built. */

export type TextOp = 'is' | 'isNot' | 'contains';
export type NumberOp = 'eq' | 'lt' | 'lte' | 'gt' | 'gte' | 'between';

export type SmartRule =
  | { field: 'genre' | 'artist'; op: TextOp; value: string }
  | { field: 'year'; op: NumberOp; value: number; value2?: number }
  /** Star rating 0–5; 0 means "not rated". */
  | { field: 'rating'; op: NumberOp; value: number; value2?: number }
  /** `value: true` → never played; `false` → played at least once. */
  | { field: 'unplayed'; value: boolean }
  /** Added to the library in the last `days` days. */
  | { field: 'addedWithin'; days: number }
  | { field: 'favorite'; value: boolean };

export type SmartField = SmartRule['field'];

export interface SmartGroup {
  /** `all` = AND, `any` = OR. */
  match: 'all' | 'any';
  items: SmartNode[];
}

export type SmartNode = SmartRule | SmartGroup;

export type SmartSort = 'title' | 'added' | 'played' | 'year' | 'rating' | 'random';

export interface SmartDefinition {
  root: SmartGroup;
  sort: SmartSort;
  desc: boolean;
  /** Keep only the first N matches (after sorting). */
  limit: number | null;
}

export interface SmartPlaylist {
  id: number;
  name: string;
  description: string;
  definition: SmartDefinition;
  /** Playable items matching right now. */
  itemCount: number;
  durationSec: number;
  createdAt: number;
  updatedAt: number;
  artMediaIds: number[];
  /** Set when the stored rules could not be read; the playlist then matches nothing. */
  error: string | null;
}

export interface SmartPreview {
  count: number;
  durationSec: number;
  items: MediaItem[];
}

export const SMART_LIMITS = { depth: 5, rules: 60, text: 200, name: 120, limit: 10_000 } as const;
export const SMART_SORTS: readonly SmartSort[] = ['title', 'added', 'played', 'year', 'rating', 'random'];

export const isGroup = (n: SmartNode): n is SmartGroup => 'items' in n;

export const emptyDefinition = (): SmartDefinition => ({ root: { match: 'all', items: [] }, sort: 'title', desc: false, limit: null });
