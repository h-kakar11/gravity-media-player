import type {
  AlbumSummary, AppInfo, ArtistSummary, BrowseResult, CacheStats, ComicInfo, EpubInfo, HistorySession, HomeData,
  LibraryChange, LibraryFacets, LibraryQuery, LibraryRoot, LyricsResult, MediaItem, MediaKind, PlaybackRequest,
  PlaybackPrefs, PlaybackSession, Playlist, PlaylistEntry, ProbeInfo, ProgressUpdate, QueryResult, RootType, ScanProgress,
  SearchResults, SeriesSummary, SortKey, SpriteSheet, StatsRange, StatsResult, SubtitleTrack, UserStatePatch,
  WindowMode, WindowState
} from './types';
import type { Settings } from './settings';
import type { OrganiseJournalInfo, OrganiseOptions, OrganisePlan, OrganiseResult } from './organise';
import type { MetaApplyTarget, MetaCandidate, MetaKind, MetaMatch, MetaRunResult } from './metadata';
import type { MetaApplyResult, MetaEpisode, MetaEpisodeSync } from './metadata'; // feature 01; a separate line so parallel import edits above don't collide

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

  'state:update': [[id: number, patch: UserStatePatch], MediaItem];
  'state:progress': [[update: ProgressUpdate], void];
  'state:markMany': [[ids: number[], completed: boolean], void];

  'history:record': [[session: HistorySession], void];
  'history:recent': [[kinds: MediaKind[] | null, limit: number], MediaItem[]];
  'history:clear': [[], void];
  'stats:get': [[range: StatsRange], StatsResult];

  'playlists:list': [[], Playlist[]];
  'playlists:create': [[name: string, mediaIds?: number[]], Playlist];
  'playlists:update': [[id: number, patch: { name?: string; description?: string }], Playlist];
  'playlists:delete': [[id: number], void];
  'playlists:items': [[id: number], PlaylistEntry[]];
  'playlists:add': [[id: number, mediaIds: number[]], Playlist];
  'playlists:remove': [[id: number, entryIds: number[]], void];
  'playlists:reorder': [[id: number, entryIds: number[]], void];

  'playback:probe': [[mediaId: number], ProbeInfo];
  'playback:open': [[req: PlaybackRequest], PlaybackSession];
  'playback:close': [[sid: string], void];
  'playback:subtitles': [[mediaId: number], SubtitleTrack[]];
  'playback:subtitleText': [[mediaId: number, trackId: string], SubtitleText];
  'playback:sprite': [[mediaId: number], SpriteSheet | null];
  'playback:lyrics': [[mediaId: number], LyricsResult];
  'playback:screenshot': [[dataUrl: string, baseName: string], string | null];
  'playback:keepAwake': [[on: boolean], void];
  'playback:prefs': [[mediaId: number, patch?: Partial<PlaybackPrefs>], PlaybackPrefs];

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

  'cache:stats': [[], CacheStats];
  'cache:clear': [[what: 'art' | 'previews' | 'all'], CacheStats];
  'db:backup': [[], string | null];
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
  title: 'Title', added: 'Date Added', played: 'Last Played', year: 'Year', duration: 'Duration', size: 'File Size',
  rating: 'Rating', track: 'Track', episode: 'Episode', name: 'File Name', random: 'Shuffle', progress: 'Progress'
};
