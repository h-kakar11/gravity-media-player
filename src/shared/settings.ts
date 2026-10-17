import { sanitizeMarkers, type SkipMarkers } from './skip';
import type { RootType, SortKey } from './types';

export type ThemeName = 'system' | 'light' | 'dark' | 'midnight' | 'paper' | 'contrast';
export type ViewMode = 'grid' | 'list' | 'columns';

/**
 * App accent colours. `light` is used for icons/text in light mode *and* as the fill behind white
 * text; `dark` is the brighter variant used for icons/text in dark mode. Every value is checked
 * for WCAG AA contrast in tests/unit/contrast.test.ts.
 */
export const ACCENTS: Record<string, { label: string; light: string; dark: string }> = {
  blue: { label: 'Blue', light: '#0a62e8', dark: '#4a93ff' },
  indigo: { label: 'Indigo', light: '#5a52e0', dark: '#8c87ff' },
  purple: { label: 'Purple', light: '#9a3fd0', dark: '#c27af5' },
  pink: { label: 'Pink', light: '#d3245b', dark: '#ff5c8d' },
  red: { label: 'Red', light: '#d12b2b', dark: '#ff6259' },
  orange: { label: 'Orange', light: '#b04a05', dark: '#ff9d42' },
  green: { label: 'Green', light: '#17773a', dark: '#46d46a' },
  graphite: { label: 'Graphite', light: '#5f6168', dark: '#b0b3bc' }
};

export interface EqPresetData { name: string; preamp: number; gains: number[] }

export interface Settings {
  version: 1;
  appearance: {
    theme: ThemeName;
    accent: string;
    textScale: number;
    sidebarSize: 'small' | 'medium' | 'large';
    posterSize: number;
    density: 'comfortable' | 'compact';
    ambient: boolean;
    reduceMotion: 'system' | 'on' | 'off';
    reduceTransparency: 'system' | 'on' | 'off';
    sidebarHidden: string[];
    sidebarOrder: string[];
    sidebarCollapsed: boolean;
  };
  home: { shelves: { id: string; enabled: boolean }[] };
  library: {
    scanOnStartup: boolean;
    watch: boolean;
    quickScan: boolean;
    hddMode: 'auto' | 'on' | 'off';
    scanConcurrency: number;
    ignoreHidden: boolean;
    ignorePatterns: string[];
    previews: 'on-play' | 'scan' | 'off';
    frameArt: boolean;
    useNfo: boolean;
    followSymlinks: boolean;
    defaultRootType: RootType;
  };
  view: {
    mode: Record<string, ViewMode>;
    sort: Record<string, { key: SortKey; desc: boolean }>;
  };
  playback: {
    resume: 'always' | 'never';
    autoplayNext: boolean;
    skipBackSec: number;
    skipForwardSec: number;
    defaultSpeed: number;
    rememberSpeed: boolean;
    preferredAudioLangs: string[];
    preferredSubtitleLangs: string[];
    subtitles: 'off' | 'auto' | 'always';
    completeThreshold: number;
    subtitleStyle: {
      size: number;
      color: string;
      background: number;
      font: 'system' | 'serif' | 'mono' | 'rounded';
      outline: boolean;
      bottom: number;
    };
    transcodeMaxHeight: number;
    transcodeQuality: 'fast' | 'balanced' | 'high';
    hwaccel: string;
    autoHideControlsSec: number;
    seekPreview: boolean;
    keepAwake: boolean;
    fullscreenOnPlay: boolean;
    screenshotFolder: string;
    miniPlayerOnLeave: boolean;
  };
  audio: {
    volume: number;
    muted: boolean;
    eq: { enabled: boolean; preset: string; preamp: number; gains: number[]; limiter: boolean };
    customPresets: EqPresetData[];
    crossfadeSec: number;
    gapless: boolean;
    replayGain: 'off' | 'track';
    nightMode: 'off' | 'light' | 'strong';
    outputDeviceId: string;
    mono: boolean;
    balance: number;
    visualizer: boolean;
    lyrics: boolean;
  };
  reader: {
    direction: 'ltr' | 'rtl';
    mode: 'single' | 'double' | 'scroll';
    fit: 'width' | 'height' | 'screen' | 'original';
    coverAlone: boolean;
    background: 'black' | 'dark' | 'sepia' | 'white' | 'system';
    preload: number;
    epub: {
      fontFamily: 'serif' | 'sans' | 'mono' | 'publisher';
      fontSize: number;
      lineHeight: number;
      margin: number;
      theme: 'auto' | 'light' | 'sepia' | 'dark' | 'black';
      flow: 'paginated' | 'scrolled';
      justify: boolean;
    };
  };
  hotkeys: Record<string, string[]>;
  controls: { video: string[]; music: string[] };
  performance: {
    uncappedFps: boolean;
    hardwareDecode: boolean;
    thumbnailCacheMb: number;
  };
  ffmpeg: { path: string; ffprobePath: string };
  /** Opt-in online lookups. Off by default; nothing leaves the machine until `enabled` is on. */
  metadata: {
    enabled: boolean;
    tmdbKey: string;
    language: string;
    anilist: boolean;
    tmdb: boolean;
    musicbrainz: boolean;
    // ----- 02 subtitles -----
    /** Opt-in OpenSubtitles search; the three values below are credentials and never leave this computer. */
    openSubtitles: boolean;
    openSubtitlesKey: string;
    openSubtitlesUser: string;
    openSubtitlesPass: string;
  };
  window: {
    bounds: { x?: number; y?: number; width: number; height: number; maximized: boolean } | null;
    miniBounds: { x?: number; y?: number; width: number; height: number } | null;
    overlayBounds: { x?: number; y?: number; width: number; height: number } | null;
  };
  // ----- 10 quality of life -----
  /** Skip intro / credits. `markers` holds what the user marked, per show (see shared/skip.ts). */
  skip: { autoIntro: boolean; autoCredits: boolean; markers: Record<string, SkipMarkers> };
  /** First-run welcome: `done` once it has been dismissed, or once the library already had folders. */
  welcome: { done: boolean };
  // ----- 06 synced lyrics -----
  /** Opt-in LRCLIB lookup (no key). Sends title, artist, album and duration of the song being opened. */
  lyrics: {
    lrclib: boolean;
    autoSave: boolean;
  };
}

export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const VIDEO_CONTROL_IDS = [
  'skipBack', 'playPause', 'skipForward', 'next', 'previous', 'volume', 'speed', 'audio', 'subtitles',
  'chapters', 'pip', 'mini', 'overlay', 'screenshot', 'stats', 'aspect', 'fullscreen'
] as const;

export const MUSIC_CONTROL_IDS = ['shuffle', 'previous', 'playPause', 'next', 'repeat', 'volume', 'lyrics', 'queue', 'eq', 'mini'] as const;

export const SIDEBAR_ITEMS = [
  'home', 'videos', 'music', 'comics', 'books', 'photos', 'browse', 'favorites', 'watchlist', 'history', 'stats'
] as const;

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  appearance: {
    theme: 'system',
    accent: 'blue',
    textScale: 1,
    sidebarSize: 'medium',
    posterSize: 188,
    density: 'comfortable',
    ambient: true,
    reduceMotion: 'system',
    reduceTransparency: 'system',
    sidebarHidden: [],
    sidebarOrder: [...SIDEBAR_ITEMS],
    sidebarCollapsed: false
  },
  home: {
    shelves: [
      { id: 'continueWatching', enabled: true },
      { id: 'upNext', enabled: true },
      { id: 'watchlist', enabled: true },
      { id: 'continueReading', enabled: true },
      { id: 'recentVideos', enabled: true },
      { id: 'recentAlbums', enabled: true },
      { id: 'recentlyPlayedMusic', enabled: true },
      { id: 'recentComics', enabled: true },
      { id: 'favorites', enabled: true }
    ]
  },
  library: {
    scanOnStartup: true,
    watch: true,
    quickScan: true,
    hddMode: 'auto',
    scanConcurrency: 0,
    ignoreHidden: true,
    ignorePatterns: ['@eaDir', '$RECYCLE.BIN', 'System Volume Information', '.Trash*', 'lost+found', '*.partial', '*.part', '*.crdownload'],
    previews: 'on-play',
    frameArt: true,
    useNfo: true,
    followSymlinks: false,
    defaultRootType: 'auto'
  },
  view: { mode: {}, sort: {} },
  playback: {
    resume: 'always',
    autoplayNext: true,
    skipBackSec: 10,
    skipForwardSec: 10,
    defaultSpeed: 1,
    rememberSpeed: false,
    preferredAudioLangs: [],
    preferredSubtitleLangs: ['en'],
    subtitles: 'auto',
    completeThreshold: 0.92,
    subtitleStyle: { size: 1, color: '#ffffff', background: 0.55, font: 'system', outline: true, bottom: 7 },
    transcodeMaxHeight: 0,
    transcodeQuality: 'balanced',
    hwaccel: 'auto',
    autoHideControlsSec: 3,
    seekPreview: true,
    keepAwake: true,
    fullscreenOnPlay: false,
    screenshotFolder: '',
    miniPlayerOnLeave: false
  },
  audio: {
    volume: 0.8,
    muted: false,
    eq: { enabled: false, preset: 'Flat', preamp: 0, gains: new Array(10).fill(0), limiter: true },
    customPresets: [],
    crossfadeSec: 0,
    gapless: true,
    replayGain: 'track',
    nightMode: 'off',
    outputDeviceId: '',
    mono: false,
    balance: 0,
    visualizer: true,
    lyrics: true
  },
  reader: {
    direction: 'ltr',
    mode: 'single',
    fit: 'screen',
    coverAlone: true,
    background: 'dark',
    preload: 3,
    epub: { fontFamily: 'serif', fontSize: 1.1, lineHeight: 1.6, margin: 8, theme: 'auto', flow: 'paginated', justify: false }
  },
  hotkeys: {},
  controls: {
    video: ['skipBack', 'playPause', 'skipForward', 'next', 'volume', 'speed', 'audio', 'subtitles', 'chapters', 'pip', 'mini', 'stats', 'fullscreen'],
    music: ['shuffle', 'previous', 'playPause', 'next', 'repeat', 'volume', 'lyrics', 'queue', 'eq', 'mini']
  },
  performance: { uncappedFps: false, hardwareDecode: true, thumbnailCacheMb: 2048 },
  ffmpeg: { path: '', ffprobePath: '' },
  metadata: { enabled: false, tmdbKey: '', language: 'en', anilist: true, tmdb: true, musicbrainz: true, openSubtitles: false, openSubtitlesKey: '', openSubtitlesUser: '', openSubtitlesPass: '' },
  window: { bounds: null, miniBounds: null, overlayBounds: null },
  skip: { autoIntro: false, autoCredits: false, markers: {} },
  welcome: { done: false },
  // ----- 06 synced lyrics -----
  lyrics: { lrclib: false, autoSave: false }
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** String-keyed maps whose keys aren't known up front (so they can't be validated against the defaults). */
const FREE_RECORDS = new Set(['view.mode', 'view.sort', 'hotkeys', 'skip.markers']);
/** Window geometry: null until first saved, then an object whose optional x/y may be added later. */
const NULLABLE_OBJECTS = new Set(['window.bounds', 'window.miniBounds', 'window.overlayBounds']);

/**
 * Merge `patch` into `base`, keeping only keys that exist in `base` and whose types match.
 * Unknown keys and wrong-typed values are dropped, so a hand-edited or outdated config file
 * can never produce an unusable settings object. Free-form maps (view modes, hotkeys) accept new
 * keys, merged one entry at a time.
 */
export function mergeSettings<T>(base: T, patch: unknown, path = ''): T {
  if (!isObj(base) || !isObj(patch)) return base;
  const out: Json = { ...(base as Json) };
  for (const key of Object.keys(base as Json)) {
    if (!(key in patch)) continue;
    const here = path ? `${path}.${key}` : key;
    const b = (base as Json)[key];
    const p = (patch as Json)[key];
    if (FREE_RECORDS.has(here)) {
      if (isObj(p)) out[key] = { ...(b as Json), ...validEntries(here, p) };
    } else if (NULLABLE_OBJECTS.has(here)) {
      if (p === null) out[key] = null;
      else if (isObj(p)) out[key] = { ...(isObj(b) ? b : {}), ...p };
    } else if (isObj(b)) {
      out[key] = mergeSettings(b, p, here);
    } else if (Array.isArray(b)) {
      if (Array.isArray(p)) out[key] = p;
    } else if (typeof b === typeof p) {
      out[key] = p;
    }
  }
  return out as T;
}

function validEntries(path: string, patch: Json): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(patch)) {
    if (path === 'hotkeys') { if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out[k] = v; }
    else if (path === 'view.mode') { if (typeof v === 'string') out[k] = v; }
    else if (path === 'skip.markers') { const m = sanitizeMarkers(v); if (m) out[k] = m; }
    else if (isObj(v) && typeof v.key === 'string' && typeof v.desc === 'boolean') out[k] = v;
  }
  return out;
}

export function clampSettings(s: Settings): Settings {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
  s.appearance.textScale = clamp(s.appearance.textScale, 0.8, 1.6);
  s.appearance.posterSize = clamp(s.appearance.posterSize, 110, 360);
  s.playback.skipBackSec = clamp(Math.round(s.playback.skipBackSec), 1, 300);
  s.playback.skipForwardSec = clamp(Math.round(s.playback.skipForwardSec), 1, 300);
  s.playback.defaultSpeed = clamp(s.playback.defaultSpeed, 0.1, 5);
  s.playback.completeThreshold = clamp(s.playback.completeThreshold, 0.5, 1);
  s.playback.autoHideControlsSec = clamp(s.playback.autoHideControlsSec, 1, 15);
  s.audio.volume = clamp(s.audio.volume, 0, 1);
  s.audio.crossfadeSec = clamp(s.audio.crossfadeSec, 0, 12);
  s.audio.balance = clamp(s.audio.balance, -1, 1);
  s.audio.eq.preamp = clamp(s.audio.eq.preamp, -18, 18);
  if (s.audio.eq.gains.length !== EQ_BANDS.length) s.audio.eq.gains = EQ_BANDS.map((_, i) => s.audio.eq.gains[i] ?? 0);
  s.audio.eq.gains = s.audio.eq.gains.map((g) => clamp(g, -18, 18));
  s.reader.preload = clamp(Math.round(s.reader.preload), 0, 10);
  s.reader.epub.fontSize = clamp(s.reader.epub.fontSize, 0.7, 2.4);
  s.reader.epub.lineHeight = clamp(s.reader.epub.lineHeight, 1.1, 2.4);
  s.reader.epub.margin = clamp(s.reader.epub.margin, 0, 30);
  s.metadata.tmdbKey = s.metadata.tmdbKey.trim();
  s.metadata.openSubtitlesKey = s.metadata.openSubtitlesKey.trim();
  s.metadata.openSubtitlesUser = s.metadata.openSubtitlesUser.trim();
  s.metadata.language = /^[a-z]{2}(-[A-Za-z]{2})?$/.test(s.metadata.language) ? s.metadata.language : 'en';
  s.library.scanConcurrency = clamp(Math.round(s.library.scanConcurrency), 0, 16);
  s.performance.thumbnailCacheMb = clamp(s.performance.thumbnailCacheMb, 128, 32768);
  const known = new Set<string>(SIDEBAR_ITEMS);
  s.appearance.sidebarOrder = [...s.appearance.sidebarOrder.filter((i) => known.has(i)), ...SIDEBAR_ITEMS.filter((i) => !s.appearance.sidebarOrder.includes(i))];
  // Shelves added after a user's settings were saved would otherwise never show: slot each one in after its default predecessor.
  DEFAULT_SETTINGS.home.shelves.forEach((d, i, all) => {
    if (s.home.shelves.some((x) => x.id === d.id)) return;
    const prev = i > 0 ? s.home.shelves.findIndex((x) => x.id === all[i - 1]!.id) : -1;
    s.home.shelves.splice(prev + 1, 0, { ...d });
  });
  const vk = new Set<string>(VIDEO_CONTROL_IDS);
  s.controls.video = s.controls.video.filter((c) => vk.has(c));
  const mk = new Set<string>(MUSIC_CONTROL_IDS);
  s.controls.music = s.controls.music.filter((c) => mk.has(c));
  return s;
}
