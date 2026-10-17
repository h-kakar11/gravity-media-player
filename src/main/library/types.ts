import type { MediaKind, VideoClass } from '@shared/types';

/** Everything the indexer extracts for a file before it is written to the database. */
export interface MediaFields {
  rootId: number;
  path: string;
  dir: string;
  fileName: string;
  ext: string;
  kind: MediaKind;
  vclass: VideoClass | null;
  title: string;
  sortTitle: string;
  size: number;
  mtimeMs: number;
  ino: string | null;
  dev: string | null;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  container: string;
  vcodec: string;
  acodec: string;
  channels: number;
  sampleRate: number;
  bitDepth: number;
  hdr: boolean;
  audioTracks: number;
  subTracks: number;
  year: number | null;
  genre: string | null;
  artist: string | null;
  albumArtist: string | null;
  album: string | null;
  trackNo: number | null;
  discNo: number | null;
  series: string | null;
  season: number | null;
  episode: number | null;
  plot: string | null;
  pages: number;
  artKey: string | null;
  /** Recipe for generating artwork lazily: `file:<abs path>`, `frame`, `comic`, `self`. */
  artSrc: string | null;
  replayGain: number | null;
  probeJson?: string | null;
}

export function emptyFields(partial: Pick<MediaFields, 'rootId' | 'path' | 'dir' | 'fileName' | 'ext' | 'kind' | 'title' | 'size' | 'mtimeMs'>): MediaFields {
  return {
    vclass: null, sortTitle: '', ino: null, dev: null, durationSec: 0, width: 0, height: 0, fps: 0, bitrate: 0,
    container: '', vcodec: '', acodec: '', channels: 0, sampleRate: 0, bitDepth: 0, hdr: false, audioTracks: 0, subTracks: 0,
    year: null, genre: null, artist: null, albumArtist: null, album: null, trackNo: null, discNo: null,
    series: null, season: null, episode: null, plot: null, pages: 0, artKey: null, artSrc: null, replayGain: null,
    probeJson: null, ...partial
  };
}
