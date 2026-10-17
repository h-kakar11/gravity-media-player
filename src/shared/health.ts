/**
 * Library Health: read-only findings about duplicates, lower-quality copies, missing episodes and
 * unreadable files. Nothing here modifies the library or the disk — the renderer can only reveal a
 * file or (after confirmation) send it to the trash through the existing shell actions.
 */

export type HealthCategory = 'duplicates' | 'missing' | 'files';

export type HealthKind =
  | 'duplicate-movie'
  | 'duplicate-episode'
  | 'missing-episodes'
  /** On disk but cannot be opened for reading (permissions, locked, I/O error). */
  | 'unreadable'
  | 'zero-length'
  /** Indexed earlier but no longer on disk. */
  | 'file-missing'
  /** Readable, but the indexer found no playable duration — often a truncated or corrupt download. */
  | 'no-duration';

export type HealthSeverity = 'info' | 'warning' | 'error';

export interface HealthFile {
  id: number;
  path: string;
  fileName: string;
  size: number;
  durationSec: number;
  width: number;
  height: number;
  vcodec: string;
  /** Bits per second; derived from size and duration when the container did not report one. */
  bitrate: number;
  /** "1080p · HEVC · 8.2 Mbps", built from whatever is known. Empty when nothing is known. */
  quality: string;
  /** The copy Gravity would keep. Always false outside duplicate groups. */
  best: boolean;
  /** Ranks below the best copy on resolution, codec or bitrate. False for the best copy and for identical copies. */
  lower: boolean;
  /** Why this copy ranks below (or ties with) the best one. Empty for the best copy and for non-duplicate findings. */
  reasons: string[];
  /** False when the file is gone — there is nothing to reveal. */
  exists: boolean;
}

export interface HealthMissingEpisode {
  season: number;
  episode: number;
  /** Episode title when it came from online metadata. */
  title: string | null;
}

export interface HealthFinding {
  /** Stable across scans of an unchanged library, so the UI can keep expanded/collapsed state. */
  id: string;
  kind: HealthKind;
  category: HealthCategory;
  severity: HealthSeverity;
  title: string;
  /** Plain-language reason this was flagged. */
  explanation: string;
  files: HealthFile[];
  /** `missing-episodes` only. */
  missing?: HealthMissingEpisode[];
  /** `missing-episodes` only: where the expected episode list came from. */
  source?: 'metadata' | 'gaps';
  /** Bytes freed by removing every copy except the best one (duplicate groups only). */
  reclaimableBytes: number;
}

export interface HealthSummary {
  duplicateGroups: number;
  /** Copies ranked below the best copy of their group. */
  lowerQualityCopies: number;
  reclaimableBytes: number;
  missingEpisodes: number;
  problemFiles: number;
  /** Files whose presence and readability were verified on disk. */
  filesChecked: number;
}

export interface HealthReport {
  generatedAt: number;
  summary: HealthSummary;
  findings: HealthFinding[];
  /** Partial failures worth telling the user about (offline library folders, capped lists). */
  warnings: string[];
  /** True when a category hit the per-scan cap and some findings were left out. */
  truncated: boolean;
}

export interface HealthScanOptions {
  /** Verify files on disk (stat + read access). On by default; off gives a fast database-only pass. */
  checkFiles?: boolean;
}

export const HEALTH_CATEGORY_LABELS: Record<HealthCategory, string> = {
  duplicates: 'Duplicates',
  missing: 'Missing episodes',
  files: 'Problem files'
};
