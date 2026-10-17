/** Shapes shared by the main-process OpenSubtitles client and the player's search sheet. */

export interface SubtitleSearchRequest {
  mediaId: number;
  /** ISO 639-1/2 codes, e.g. ['en', 'de']. */
  languages: string[];
  /** Free-text override of the title taken from the library. */
  query?: string;
}

export interface SubtitleHit {
  fileId: number;
  title: string;
  release: string;
  language: string;
  downloads: number;
  /** The file hash matched exactly, so timing will line up. */
  hashMatch: boolean;
  hearingImpaired: boolean;
  fps: number | null;
  uploader: string;
}

export interface SubtitleSearchResult {
  hits: SubtitleHit[];
  /** What was actually asked for, so the sheet can show it. */
  query: string;
  hashed: boolean;
}

export interface SubtitleDownloadResult {
  /** Id of the new track, ready for `playback:subtitleText`. */
  trackId: string;
  path: string;
  /** Next to the video, or in the cache folder when that folder is read-only. */
  where: 'sidecar' | 'cache';
  /** Downloads left today, when the service reports it. */
  remaining: number | null;
}

export const LANGUAGE_CODE = /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/;

/** Sidecar name next to the video: "Movie.en.srt", "Movie.en.sdh.srt", "Movie.en.2.srt". */
export function subtitleSidecarName(videoStem: string, language: string, hearingImpaired: boolean, n = 1): string {
  const lang = LANGUAGE_CODE.test(language) ? language.toLowerCase() : 'und';
  return `${videoStem}.${lang}${hearingImpaired ? '.sdh' : ''}${n > 1 ? `.${n}` : ''}.srt`;
}
