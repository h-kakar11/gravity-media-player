import type { NewEpisodeCounts, WatchAction, WatchOverview, WatchUpdateResult } from './watch'; // feature 04; first line so parallel edits to the import list below don't collide
import type {
  AlbumSummary, AppInfo, ArtistSummary, BrowseResult, CacheStats, ComicInfo, EpubInfo, HistorySession, HomeData,
  LibraryChange, LibraryFacets, LibraryQuery, LibraryRoot, LyricsResult, MediaItem, MediaKind, PlaybackRequest,
  PlaybackPrefs, PlaybackSession, Playlist, PlaylistEntry, ProbeInfo, ProgressUpdate, QueryResult, RootType, ScanProgress,
  SearchResults, SeriesSummary, SortKey, SpriteSheet, StatsRange, StatsResult, SubtitleTrack, UserStatePatch,
  WindowMode, WindowState
} from './types';
import type { DroppedPath } from './drop';
import type { StatsInsights, YearInReview } from './insights';
import type { LyricsSaveResult } from './lrclib';
import type { Settings } from './settings';
import type { HealthReport, HealthScanOptions } from './health'; // feature 05
import type { OrganiseJournalInfo, OrganiseOptions, OrganisePlan, OrganiseResult } from './organise';
import type { SubtitleDownloadResult, SubtitleSearchRequest, SubtitleSearchResult } from './subtitle-search';
import type { MetaApplyTarget, MetaCandidate, MetaKind, MetaMatch, MetaRunResult } from './metadata';
import type { CastCommand, CastDevice, CastStatus } from './cast';

import type { MetaApplyResult, MetaEpisode, MetaEpisodeSync } from './metadata'; // feature 01; own slot so parallel import edits above don't collide

export type DeepPartial<T> = T extends (infer U)[]
  ? U[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export interface AlbumQuery { text?: string; artistKey?: string; favorite?: boolean; sort?: 'title' | 'artist' | 'added' | 'year' | 'played'; desc?: boolean; limit?: number; offset?: number }
export interface SeriesQuery { type: 'show' | 'comic'; text?: string; favorite?: boolean; sort?: 'title' | 'added' | 'played'; desc?: boolean; limit?: number; offset?: number }
export interface Siblings { prev: MediaItem | null; next: MediaItem | null }
export interface SubtitleText { text: string; format: string }
export interface FavoriteTarget { type: 'album' | 'series' | 'folder'; key: string }

/** Request/response channels: name → [args tuple, result]. */
export interface IpcContract {
  'app:info': [[], AppInfo];
  'app:log': [[level: 'info' | 'warn' | 'error', message: string], void];
  'app:relaunch': [[], void];
  'app:open': [[what: 'userData' | 'cache' | 'licenses'], void];

  'settings:get': [[], Settings];
  'settings:set': [[patch: DeepPartial<Settings>], Settings];
  'settings:reset': [[], Settings];
  'settings:export': [[], string | null];
  'settings:import': [[], Settings | null];

  'roots:list': [[], LibraryRoot[]];
  'roots:add': [[path: string | null, type?: RootType], LibraryRoot | null];
  'roots:update': [[id: number, patch: Partial<Pick<LibraryRoot, 'name' | 'type' | 'enabled' | 'watch'>>], LibraryRoot];
  'roots:remove': [[id: number], void];
  'roots:rescan': [[id: number | null, deep?: boolean], void];
  'roots:cleanup': [[], number];

  'library:query': [[q: LibraryQuery], QueryResult<MediaItem>];
  'library:get': [[ids: number[]], MediaItem[]];
  'library:albums': [[q: AlbumQuery], QueryResult<AlbumSummary>];
  'library:artists': [[q: { text?: string }], QueryResult<ArtistSummary>];
  'library:series': [[q: SeriesQuery], QueryResult<SeriesSummary>];
  'library:browse': [[path: string | null], BrowseResult];
  'library:home': [[], HomeData];
  'library:facets': [[kind: MediaKind], LibraryFacets];
  'library:search': [[text: string], SearchResults];
  'library:siblings': [[id: number], Siblings];
  'library:ingest': [[paths: string[]], MediaItem[]];
  'library:favorite': [[target: FavoriteTarget, on: boolean], void];
  'library:favorites': [[type: FavoriteTarget['type']], string[]];

  // [04] watchlist and Up Next
  'watch:overview': [[], WatchOverview];
  'watch:update': [[action: WatchAction], WatchUpdateResult];
  'watch:badges': [[], NewEpisodeCounts];
  'watch:keys': [[], string[]];

  'state:update': [[id: number, patch: UserStatePatch], MediaItem];
  'state:progress': [[update: ProgressUpdate], void];
  'state:markMany': [[ids: number[], completed: boolean], void];

  'history:record': [[session: HistorySession], void];
  'history:recent': [[kinds: MediaKind[] | null, limit: number], MediaItem[]];
  'history:clear': [[], void];
  'stats:get': [[range: StatsRange], StatsResult];
  // ----- 08 stats -----
  'stats:insights': [[range: StatsRange], StatsInsights];
  'stats:yearInReview': [[year: number], YearInReview];
  /** Opens a save dialog and writes the year-in-review page; resolves to the path, or null if cancelled. */
  'stats:exportYearInReview': [[year: number], string | null];

  'playlists:list': [[], Playlist[]];
  'playlists:create': [[name: string, mediaIds?: number[]], Playlist];
  'playlists:update': [[id: number, patch: { name?: string; description?: string }], Playlist];
  'playlists:delete': [[id: number], void];
  'playlists:items': [[id: number], PlaylistEntry[]];
  'playlists:add': [[id: number, mediaIds: number[]], Playlist];
  'playlists:remove': [[id: number, entryIds: number[]], void];
  'playlists:reorder': [[id: number, entryIds: number[]], void];

  // [03] smart playlists (inline type imports keep the import list above untouched)
  'smart:list': [[], import('./smart').SmartPlaylist[]];
  'smart:create': [[name: string, definition: import('./smart').SmartDefinition], import('./smart').SmartPlaylist];
  'smart:update': [[id: number, patch: { name?: string; description?: string; definition?: import('./smart').SmartDefinition }], import('./smart').SmartPlaylist];
  'smart:delete': [[id: number], void];
  'smart:items': [[id: number], PlaylistEntry[]];
  'smart:preview': [[definition: import('./smart').SmartDefinition], import('./smart').SmartPreview];

  'playback:probe': [[mediaId: number], ProbeInfo];
  'playback:open': [[req: PlaybackRequest], PlaybackSession];
  'playback:close': [[sid: string], void];
  'playback:subtitles': [[mediaId: number], SubtitleTrack[]];
  'playback:subtitleText': [[mediaId: number, trackId: string], SubtitleText];
  'playback:sprite': [[mediaId: number], SpriteSheet | null];
  'playback:lyrics': [[mediaId: number], LyricsResult];
  // ----- 06 synced lyrics -----
  'lyrics:save': [[mediaId: number], LyricsSaveResult];
  'playback:screenshot': [[dataUrl: string, baseName: string], string | null];
  'playback:keepAwake': [[on: boolean], void];
  'playback:prefs': [[mediaId: number, patch?: Partial<PlaybackPrefs>], PlaybackPrefs];

  // ----- 10 quality of life -----
  'library:classifyPaths': [[paths: string[]], DroppedPath[]];
  // ----- 02 subtitles -----
  'subtitles:search': [[req: SubtitleSearchRequest], SubtitleSearchResult];
  'subtitles:download': [[mediaId: number, fileId: number, language: string, hearingImpaired: boolean], SubtitleDownloadResult];
  // ----- 07 casting -----
  /** Devices found so far. Empty (and silent on the network) unless casting is enabled. */
  'cast:devices': [[], CastDevice[]];
  /** Scan the LAN. Rejects when casting is disabled in settings. */
  'cast:discover': [[], CastDevice[]];
  'cast:start': [[deviceId: string, mediaId: number, startSec: number, audioIndex: number], CastStatus];
  'cast:control': [[cmd: CastCommand], CastStatus];
  'cast:status': [[], CastStatus];

  'reader:epub': [[mediaId: number], EpubInfo];
  'reader:comic': [[mediaId: number], ComicInfo];
  'reader:search': [[mediaId: number, query: string], { spineIndex: number; excerpt: string }[]];

  'window:state': [[], WindowState];
  'window:setMode': [[mode: WindowMode], WindowState];
  'window:fullscreen': [[on?: boolean], WindowState];
  'window:alwaysOnTop': [[on: boolean], WindowState];
  'window:control': [[action: 'minimize' | 'maximize' | 'close'], void];
  'window:setAspect': [[ratio: number], void];
  'window:overlay': [[opts: { opacity?: number; clickThrough?: boolean }], void];

  'shell:reveal': [[mediaId: number], void];
  'shell:trash': [[mediaId: number], boolean];
  'dialog:pickFolder': [[title?: string], string | null];
  'dialog:pickFile': [[title: string, extensions: string[]], string | null];

  'meta:search': [[kind: MetaKind, query: string, year?: number], MetaCandidate[]];
  'meta:apply': [[target: MetaApplyTarget, candidate: MetaCandidate], MetaApplyResult];
  'meta:clear': [[target: MetaApplyTarget], void];
  'meta:match': [[target: MetaApplyTarget], MetaMatch | null];
  'meta:run': [[], MetaRunResult];
  /** Stored online episode titles/summaries for a show (lower-cased series name). Works offline. */
  'meta:episodes': [[seriesKey: string], MetaEpisode[]];
  /** Re-fetch episode info for an already matched show. Rejects with a readable reason when nothing could be fetched. */
  'meta:episodesSync': [[seriesKey: string], MetaEpisodeSync];

  'organise:plan': [[options: OrganiseOptions], OrganisePlan];
  'organise:apply': [[options: OrganiseOptions, ids: number[]], OrganiseResult];
  'organise:history': [[], OrganiseJournalInfo[]];
  'organise:undo': [[id: string], OrganiseResult];

  'health:scan': [[options?: HealthScanOptions], HealthReport];

  'cache:stats': [[], CacheStats];
  'cache:clear': [[what: 'art' | 'previews' | 'all'], CacheStats];
  'db:backup': [[], string | null];
  'backup:export': [[], import('./backup').ExportOutcome | null];
  'backup:open': [[], { token: string; report: import('./backup').ImportReport } | null];
  'backup:apply': [[token: string, options: import('./backup').ImportOptions], import('./backup').ImportReport];
}

export type IpcChannel = keyof IpcContract;
export type IpcArgs<C extends IpcChannel> = IpcContract[C][0];
export type IpcResult<C extends IpcChannel> = IpcContract[C][1];

/** One-way events pushed from main to the renderer. */
export interface IpcEvents {
  'library:changed': LibraryChange;
  'scan:progress': ScanProgress;
  'settings:changed': Settings;
  'roots:changed': null;
  'playlists:changed': null;
  'menu:action': string;
  'window:state': WindowState;
  'toast': { kind: 'info' | 'error' | 'success'; message: string };
  'open-media': number[];
  'system:resume': null;
  // ----- 07 casting -----
  'cast:status': CastStatus;
}

export type IpcEventName = keyof IpcEvents;

/** What the preload script exposes on `window.gravity`. */
export interface GravityApi {
  invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>>;
  on<E extends IpcEventName>(event: E, listener: (payload: IpcEvents[E]) => void): () => void;
  /** Resolve absolute paths for files dropped onto the window. */
  pathForFile(file: File): string;
  platform: 'darwin' | 'win32' | 'linux';
}

export const SORT_LABELS: Record<SortKey, string> = {
  title: 'Title', added: 'Recently Added', played: 'Last Played', year: 'Year', duration: 'Duration', size: 'File Size',
  rating: 'Rating', track: 'Track', episode: 'Episode', name: 'File Name', random: 'Shuffle', progress: 'Progress'
};
