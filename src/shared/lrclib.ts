/** Result of writing LRCLIB lyrics next to a song. */
export interface LyricsSaveResult {
  path: string;
}

/** Fields LRCLIB needs to identify a track. */
export interface LrclibQuery {
  title: string;
  artist: string;
  album: string;
  durationSec: number | null;
}

/** LRCLIB matches by duration; anything further apart than this is a different recording. */
export const LRCLIB_DURATION_TOLERANCE_SEC = 3;
