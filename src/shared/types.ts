/** Data models shared between the main process, preload and renderer. */

export type MediaKind = 'video' | 'audio' | 'image' | 'comic' | 'book';
export type VideoClass = 'movie' | 'episode' | 'clip';
/** What a library folder contains. `auto` classifies by file type and folder shape. */
export type RootType = 'auto' | 'video' | 'music' | 'photos' | 'comics' | 'books';

export interface LibraryRoot {
  id: number;
  path: string;
  name: string;
  type: RootType;
  enabled: boolean;
  /** Watch for file system changes while the app runs. */
  watch: boolean;
  /** False when the folder (or its drive) is currently unreachable. */
  online: boolean;
  /** What the OS says the folder lives on: spinning disk, flash, or not determinable (network, virtual). */
  drive: 'hdd' | 'ssd' | 'unknown';
  itemCount: number;
  lastScanAt: number | null;
  scanning: boolean;
}

export interface MediaItem {
  id: number;
  rootId: number;
  kind: MediaKind;
  vclass: VideoClass | null;
  /** Absolute path of the file (or folder, for folder-based comics). */
  path: string;
  dir: string;
  fileName: string;
  ext: string;
  title: string;
  sortTitle: string;
  size: number;
  mtimeMs: number;
  addedAt: number;
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
  audioTrackCount: number;
  subtitleTrackCount: number;
  /** ReplayGain track gain in dB, when the file carries one. */
  replayGain: number | null;
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
  /** Page count for comics, spine items for books. */
  pages: number;
  hasArt: boolean;
  missing: boolean;
  // user state
  favorite: boolean;
  rating: number;
  playCount: number;
  lastPlayedAt: number | null;
  positionSec: number;
  /** 0..1 completion fraction used for progress bars. */
  progress: number;
  completed: boolean;
  notes: string;
  /** Opaque reader location (page index, EPUB position). */
  location: string | null;
}

export interface AlbumSummary {
  key: string;
  album: string;
  artist: string;
  year: number | null;
  trackCount: number;
  durationSec: number;
  artMediaId: number | null;
  favorite: boolean;
  addedAt: number;
  lastPlayedAt: number | null;
  playCount: number;
}

export interface ArtistSummary {
  key: string;
  name: string;
  albumCount: number;
  trackCount: number;
  artMediaId: number | null;
}

export interface SeriesSummary {
  key: string;
  title: string;
  /** `show` for TV, `comic` for manga/comic series. */
  type: 'show' | 'comic';
  seasonCount: number;
  /** Set when the query asked for one row per season: that season (0 = specials). Null for a whole show. */
  season: number | null;
  episodeCount: number;
  completedCount: number;
  year: number | null;
  artMediaId: number | null;
  addedAt: number;
  lastPlayedAt: number | null;
  favorite: boolean;
}

export interface FolderEntry {
  path: string;
  name: string;
  itemCount: number;
  kinds: Partial<Record<MediaKind, number>>;
  artMediaIds: number[];
  favorite: boolean;
}

export interface BrowseResult {
  /** Null path = the list of library roots. */
  path: string | null;
  parent: string | null;
  crumbs: { name: string; path: string | null }[];
  folders: FolderEntry[];
  items: MediaItem[];
}

export type SortKey =
  | 'title' | 'added' | 'played' | 'year' | 'duration' | 'size' | 'rating'
  | 'track' | 'episode' | 'name' | 'random' | 'progress';

export type WatchStatus = 'any' | 'unwatched' | 'inprogress' | 'completed';

export interface LibraryQuery {
  kind?: MediaKind | MediaKind[];
  vclass?: VideoClass;
  excludeVclass?: VideoClass;
  text?: string;
  favorite?: boolean;
  status?: WatchStatus;
  genre?: string;
  yearFrom?: number;
  yearTo?: number;
  resolution?: 'sd' | 'hd' | 'fhd' | 'uhd';
  /** Album key (see AlbumSummary.key). */
  album?: string;
  artistKey?: string;
  series?: string;
  season?: number;
  dir?: string;
  underDir?: string;
  rootId?: number;
  ids?: number[];
  sort?: SortKey;
  desc?: boolean;
  limit?: number;
  offset?: number;
  includeMissing?: boolean;
}

export interface QueryResult<T> {
  items: T[];
  total: number;
}

export interface LibraryFacets {
  genres: { name: string; count: number }[];
  years: { year: number; count: number }[];
  total: number;
}

export interface HomeData {
  continueWatching: MediaItem[];
  continueReading: MediaItem[];
  recentVideos: MediaItem[];
  recentAlbums: AlbumSummary[];
  recentlyPlayedMusic: MediaItem[];
  recentComics: MediaItem[];
  favorites: MediaItem[];
  counts: Record<MediaKind, number>;
}

export interface SearchResults {
  media: MediaItem[];
  albums: AlbumSummary[];
  series: SeriesSummary[];
  artists: ArtistSummary[];
}

export interface Playlist {
  id: number;
  name: string;
  description: string;
  itemCount: number;
  durationSec: number;
  createdAt: number;
  updatedAt: number;
  artMediaIds: number[];
}

export interface PlaylistEntry {
  entryId: number;
  position: number;
  item: MediaItem;
}

export interface UserStatePatch {
  favorite?: boolean;
  rating?: number;
  notes?: string;
  completed?: boolean;
  /** Reset resume position and watched state. */
  reset?: boolean;
}

export interface ProgressUpdate {
  mediaId: number;
  positionSec?: number;
  location?: string | null;
  progress?: number;
  completed?: boolean;
}

/** A single viewing/listening session, recorded for statistics. */
export interface HistorySession {
  mediaId: number;
  startedAt: number;
  /** Wall-clock seconds the media was actively playing. */
  watchedSec: number;
  /** Seconds of media content covered (differs from watched time at non-1x speeds). */
  mediaSec: number;
  fromSec: number;
  toSec: number;
  speed: number;
}

export interface StatsRange {
  from?: number;
  to?: number;
}

export interface StatsResult {
  totalSec: number;
  videoSec: number;
  audioSec: number;
  readingSec: number;
  sessions: number;
  titlesPlayed: number;
  completedTitles: number;
  longestSessionSec: number;
  avgSessionSec: number;
  streakDays: number;
  /** Seconds per local day (YYYY-MM-DD), split by kind. */
  daily: { day: string; video: number; audio: number; reading: number }[];
  /** Seconds by hour of day, 0..23. */
  hourly: number[];
  /** Seconds by weekday, 0 = Sunday. */
  weekday: number[];
  topVideos: { item: MediaItem; sec: number; plays: number }[];
  topSeries: { title: string; sec: number; artMediaId: number | null }[];
  topTracks: { item: MediaItem; plays: number; sec: number }[];
  topArtists: { name: string; sec: number; plays: number }[];
  topGenres: { name: string; sec: number }[];
  library: { kind: MediaKind; count: number; totalSize: number; totalDurationSec: number }[];
  mostActiveHour: number | null;
  avgSpeed: number;
}

// ---------------------------------------------------------------------------
// Playback

export interface StreamInfo {
  index: number;
  type: 'video' | 'audio' | 'subtitle' | 'attachment' | 'data';
  codec: string;
  profile: string;
  level: number;
  width: number;
  height: number;
  pixFmt: string;
  bitDepth: number;
  fps: number;
  bitrate: number;
  channels: number;
  channelLayout: string;
  sampleRate: number;
  language: string;
  title: string;
  isDefault: boolean;
  isForced: boolean;
  attachedPic: boolean;
  /** Color transfer (e.g. smpte2084 for HDR10, arib-std-b67 for HLG). */
  colorTransfer: string;
  rotation: number;
}

export interface ChapterInfo {
  startSec: number;
  endSec: number;
  title: string;
}

export interface ProbeInfo {
  container: string;
  formatName: string;
  durationSec: number;
  bitrate: number;
  size: number;
  streams: StreamInfo[];
  chapters: ChapterInfo[];
}

export type PlaybackMode = 'direct' | 'remux' | 'transcode';

export interface PlaybackRequest {
  mediaId: number;
  mode: PlaybackMode;
  startSec: number;
  /** Index into the audio streams (0-based among audio). */
  audioIndex: number;
  /** Cap output height when transcoding (0 = source). */
  maxHeight: number;
  /** Absolute stream index of a subtitle to burn into the picture, or -1. */
  burnSubtitle: number;
  /** Why this mode was chosen, shown in the stats overlay. */
  reason: string;
}

export interface PlaybackSession {
  sid: string;
  mode: PlaybackMode;
  url: string;
  /** Media time (seconds) at which the stream starts. */
  offsetSec: number;
  durationSec: number;
  audioIndex: number;
  reason: string;
  encoder: string;
  videoCodecOut: string;
  audioCodecOut: string;
}

export interface SubtitleTrack {
  id: string;
  label: string;
  language: string;
  format: 'srt' | 'vtt' | 'ass' | 'bitmap';
  source: 'embedded' | 'external';
  isDefault: boolean;
  isForced: boolean;
  /** Stream index (embedded) or file path (external). */
  ref: string | number;
}

export interface PlaybackPrefs {
  speed: number | null;
  audioIndex: number | null;
  subtitleId: string | null;
  subtitleDelay: number | null;
}

export interface SpriteSheet {
  url: string;
  cols: number;
  rows: number;
  thumbWidth: number;
  thumbHeight: number;
  intervalSec: number;
  count: number;
}

export interface EpubInfo {
  title: string;
  author: string;
  language: string;
  spine: { index: number; href: string; id: string; size: number }[];
  toc: TocEntry[];
  direction: 'ltr' | 'rtl' | 'auto';
  /** Fixed-layout / image-based books are shown as pages. */
  fixedLayout: boolean;
}

export interface TocEntry {
  title: string;
  href: string;
  spineIndex: number;
  children: TocEntry[];
}

export interface ComicInfo {
  pages: { index: number; name: string }[];
}

export interface LyricLine {
  timeSec: number;
  text: string;
}

export interface LyricsResult {
  synced: boolean;
  lines: LyricLine[];
  source: 'lrc' | 'embedded' | 'lrclib' | 'none';
}

export interface FfmpegInfo {
  ffmpegPath: string | null;
  ffprobePath: string | null;
  version: string | null;
  source: 'custom' | 'system' | 'bundled' | 'none';
  encoders: string[];
  hwaccels: string[];
}

export interface AppInfo {
  version: string;
  platform: 'darwin' | 'win32' | 'linux';
  arch: string;
  electron: string;
  chrome: string;
  userDataPath: string;
  cachePath: string;
  ffmpeg: FfmpegInfo;
  displayRefreshRate: number;
  displays: { id: number; refreshRate: number; width: number; height: number; scale: number }[];
  /** True when the window uses a native vibrancy / mica material. */
  nativeMaterial: boolean;
  testMode: boolean;
  /** Absolute path of the packaged `.app`/exe's resources, for About pane. */
  licensesPath: string;
}

export interface ScanProgress {
  rootId: number;
  phase: 'walking' | 'indexing' | 'artwork' | 'done' | 'offline';
  scanned: number;
  total: number;
  added: number;
  updated: number;
  removed: number;
  current: string;
}

export interface LibraryChange {
  added: number;
  updated: number;
  removed: number;
  /** Kinds touched, so views can refresh selectively. */
  kinds: MediaKind[];
}

export interface CacheStats {
  artBytes: number;
  previewBytes: number;
  transcodeBytes: number;
  dbBytes: number;
}

export type WindowMode = 'normal' | 'mini' | 'overlay';

export interface WindowState {
  fullscreen: boolean;
  maximized: boolean;
  mode: WindowMode;
  alwaysOnTop: boolean;
  focused: boolean;
}
