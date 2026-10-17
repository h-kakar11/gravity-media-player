import { app, dialog, ipcMain, powerSaveBlocker, screen, shell } from 'electron';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { IpcArgs, IpcChannel, IpcResult } from '@shared/ipc';
import type { CacheStats, EpubInfo, LibraryRoot, MediaItem, SubtitleTrack } from '@shared/types';
import type { Settings } from '@shared/settings';
import type { Db } from './db/database';
import type { PlaylistRepo } from './db/playlists';
import type { LibraryRepo } from './db/repo';
import type { StatsRepo } from './db/stats';
import type { ArtService } from './library/art';
import type { MetadataService } from './metadata/service';
import type { OrganiseService } from './organise/service';
import { HealthScanner } from './health/scan';
import { drives } from './library/drive';
import type { Indexer } from './library/indexer';
import type { LibraryWatcher } from './library/watcher';
import type { Ffmpeg } from './media/ffmpeg';
import type { PlaybackService } from './media/playback-service';
import type { SpriteService } from './media/sprites';
import type { AppPaths } from './paths';
import type { ComicReader } from './readers/comic';
import { epubInfo, spineText } from './readers/epub';
import type { ZipCache } from './readers/zip';
import type { SettingsStore } from './settings-store';
import type { WindowManager } from './window';
import { embeddedSubtitleTracks, findExternalSubtitles, readSubtitle } from './media/subtitles';
import { loadLyrics } from './media/lyrics';
import { logger } from './log';

const log = logger('ipc');

export interface Services {
  paths: AppPaths;
  settings: SettingsStore;
  db: Db;
  repo: LibraryRepo;
  playlists: PlaylistRepo;
  stats: StatsRepo;
  indexer: Indexer;
  watcher: LibraryWatcher;
  ffmpeg: Ffmpeg;
  playback: PlaybackService;
  art: ArtService;
  meta: MetadataService;
  organise: OrganiseService;
  sprites: SpriteService;
  comics: ComicReader;
  zips: ZipCache;
  wm: WindowManager;
  devUrl: string | null;
  testMode: boolean;
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else try { total += (await stat(p)).size; } catch { /* vanished */ }
  }
  return total;
}

export function registerIpc(s: Services): void {
  const send = <T>(event: string, payload: T) => {
    const w = s.wm.win;
    if (w && !w.isDestroyed()) w.webContents.send(`gravity:event:${event}`, payload);
  };

  const allowed = (url: string) => url.startsWith('gravity://app') || (!!s.devUrl && url.startsWith(s.devUrl));
  function handle<C extends IpcChannel>(channel: C, fn: (...args: IpcArgs<C>) => IpcResult<C> | Promise<IpcResult<C>>): void {
    ipcMain.handle(`gravity:${channel}`, async (event, ...args) => {
      if (!allowed(event.senderFrame?.url ?? '')) throw new Error('Blocked IPC from untrusted frame');
      try {
        return await fn(...(args as IpcArgs<C>));
      } catch (err) {
        log.warn(`${channel} failed:`, (err as Error).message);
        throw err;
      }
    });
  }

  // ----- events ----------------------------------------------------------
  s.indexer.on('changed', (c) => send('library:changed', c));
  s.indexer.on('progress', (p) => send('scan:progress', p));
  s.indexer.on('roots', () => send('roots:changed', null));
  s.settings.on('changed', (v: Settings) => send('settings:changed', v));

  const syncWatchers = async () => { if (s.db.isOpen) await s.watcher.sync(s.repo.listRoots(), s.settings.get().library.watch); };
  s.settings.on('changed', () => void syncWatchers());

  // ----- app & settings ----------------------------------------------------
  handle('app:info', async () => ({
    version: app.getVersion(),
    platform: process.platform as 'darwin' | 'win32' | 'linux',
    arch: process.arch,
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    userDataPath: s.paths.userData,
    cachePath: s.paths.cache,
    ffmpeg: await s.ffmpeg.resolve(),
    displayRefreshRate: screen.getPrimaryDisplay().displayFrequency || 60,
    displays: screen.getAllDisplays().map((d) => ({ id: d.id, refreshRate: d.displayFrequency || 60, width: d.size.width, height: d.size.height, scale: d.scaleFactor })),
    nativeMaterial: s.wm.nativeMaterial,
    testMode: s.testMode,
    licensesPath: join(app.getAppPath(), 'THIRD_PARTY_LICENSES.md')
  }));
  handle('app:log', (level, message) => log[level](`[renderer] ${message}`));
  handle('app:relaunch', () => {
    if (s.testMode) return;
    app.relaunch();
    app.quit();
  });
  handle('app:open', async (what) => {
    const target = what === 'userData' ? s.paths.userData : what === 'cache' ? s.paths.cache : join(app.getAppPath(), 'THIRD_PARTY_LICENSES.md');
    if (what === 'licenses') shell.showItemInFolder(target);
    else await shell.openPath(target);
  });

  handle('meta:search', (kind, query, year) => s.meta.search(kind, query, year));
  handle('meta:apply', (target, candidate) => s.meta.apply(target, candidate));
  handle('meta:clear', (target) => s.meta.clear(target));
  handle('meta:match', (target) => s.meta.matchFor(target));
  handle('meta:run', () => s.meta.autoMatch());
  handle('organise:plan', (o) => s.organise.plan(o));
  handle('organise:apply', (o, ids) => s.organise.apply(o, ids));
  handle('organise:history', () => s.organise.history());
  handle('organise:undo', (id) => s.organise.undo(id));

  handle('settings:get', () => s.settings.get());
  handle('settings:set', (patch) => s.settings.set(patch));
  handle('settings:reset', () => s.settings.reset());
  handle('settings:export', async () => {
    const r = await dialog.showSaveDialog(s.wm.win!, { title: 'Export Settings', defaultPath: 'gravity-settings.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return null;
    // The TMDB key is a credential: never written to an export file.
    const out = structuredClone(s.settings.get());
    out.metadata.tmdbKey = '';
    await writeFile(r.filePath, JSON.stringify(out, null, 2));
    return r.filePath;
  });
  handle('settings:import', async () => {
    const r = await dialog.showOpenDialog(s.wm.win!, { title: 'Import Settings', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    const file = r.filePaths[0];
    if (r.canceled || !file) return null;
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<Settings>;
    const next = parsed as Settings;
    // Importing never wipes (or injects) the locally stored key.
    if (next.metadata) next.metadata.tmdbKey = s.settings.get().metadata.tmdbKey;
    return s.settings.replace(next);
  });

  // ----- roots -------------------------------------------------------------
  const rootList = () => s.repo.listRoots().map((r) => {
    const online = existsSync(r.path);
    return { ...r, online, scanning: s.indexer.scanning.has(r.id), drive: drives.cached(r.path) };
  });

  handle('roots:list', () => rootList());
  handle('roots:add', async (path, type) => {
    let paths: string[] = path ? [path] : [];
    if (!path) {
      const r = await dialog.showOpenDialog(s.wm.win!, { title: 'Add Library Folder', properties: ['openDirectory', 'multiSelections', 'createDirectory'], buttonLabel: 'Add Folder' });
      if (r.canceled) return null;
      paths = r.filePaths;
    }
    let first: LibraryRoot | null = null;
    for (const p of paths) {
      if (!statSync(p).isDirectory()) throw new Error('Choose a folder, not a file');
      const id = s.repo.addRoot(p, basename(p) || p, type ?? s.settings.get().library.defaultRootType);
      first ??= rootList().find((x) => x.id === id) ?? null;
      void s.indexer.scanRoot(id).then(() => syncWatchers());
    }
    send('roots:changed', null);
    return first;
  });
  handle('roots:update', async (id, patch) => {
    s.repo.updateRoot(id, patch);
    if (patch.type !== undefined) void s.indexer.scanRoot(id, { deep: true });
    void syncWatchers();
    send('roots:changed', null);
    return rootList().find((r) => r.id === id)!;
  });
  handle('roots:remove', async (id) => {
    s.repo.removeRoot(id);
    await syncWatchers();
    send('roots:changed', null);
    send('library:changed', { added: 0, updated: 0, removed: 1, kinds: ['video', 'audio', 'image', 'comic', 'book'] });
  });
  handle('roots:rescan', async (id, deep) => {
    if (id == null) void s.indexer.scanAll({ deep });
    else void s.indexer.scanRoot(id, { deep });
  });
  handle('roots:cleanup', () => {
    const n = s.repo.purgeMissing();
    send('library:changed', { added: 0, updated: 0, removed: n, kinds: ['video', 'audio', 'image', 'comic', 'book'] });
    return n;
  });

  // ----- library -----------------------------------------------------------
  handle('library:query', (q) => s.repo.query(q));
  handle('library:get', (ids) => s.repo.getMany(ids));
  handle('library:albums', (q) => s.repo.albums(q));
  handle('library:artists', (q) => s.repo.artists(q.text));
  handle('library:series', (q) => s.repo.series(q));
  handle('library:browse', (path) => s.repo.browse(path, new Set(rootList().filter((r) => r.online).map((r) => r.id))));
  handle('library:home', () => s.repo.home());
  handle('library:facets', (kind) => s.repo.facets(kind));
  handle('library:search', (text) => s.repo.search(text));
  handle('library:siblings', (id) => s.repo.siblings(id));
  handle('library:ingest', async (paths) => {
    const ids = await s.indexer.ingestFiles(paths);
    s.indexer.flushChanges();
    return s.repo.getMany(ids);
  });
  handle('library:favorite', (t, on) => s.repo.setCollectionFavorite(t.type, t.key, on));
  handle('library:favorites', (type) => s.repo.favoriteKeys(type));

  // ----- state & history ----------------------------------------------------
  handle('state:update', (id, patch) => {
    s.repo.updateState(id, patch);
    return s.repo.get(id) as MediaItem;
  });
  handle('state:progress', (u) => s.repo.setProgress(u));
  handle('state:markMany', (ids, completed) => s.repo.markMany(ids, completed));
  handle('history:record', (h) => s.repo.recordHistory(h));
  handle('history:recent', (kinds, limit) => s.repo.recentlyPlayed(kinds, limit));
  handle('history:clear', () => s.repo.clearHistory());
  handle('stats:get', (range) => s.stats.compute(range));

  // ----- playlists ---------------------------------------------------------
  handle('playlists:list', () => s.playlists.list());
  // Every change announces itself, so the sidebar and an open playlist stay current whoever made it.
  const changed = <T>(r: T): T => { send('playlists:changed', null); return r; };
  handle('playlists:create', (name, ids) => changed(s.playlists.create(name, ids)));
  handle('playlists:update', (id, patch) => changed(s.playlists.update(id, patch)));
  handle('playlists:delete', (id) => changed(s.playlists.delete(id)));
  handle('playlists:items', (id) => s.playlists.items(id));
  handle('playlists:add', (id, ids) => changed(s.playlists.add(id, ids)));
  handle('playlists:remove', (id, entries) => changed(s.playlists.remove(id, entries)));
  handle('playlists:reorder', (id, entries) => changed(s.playlists.reorder(id, entries)));

  // ----- playback ----------------------------------------------------------
  handle('playback:probe', (id) => s.playback.probe(id));
  handle('playback:open', (req) => s.playback.open(req));
  handle('playback:close', (sid) => s.playback.close(sid));
  handle('playback:subtitles', async (id) => {
    const row = s.repo.getRow(id);
    if (!row) return [];
    const probe = await s.playback.probe(id).catch(() => null);
    const embedded: SubtitleTrack[] = probe ? embeddedSubtitleTracks(probe) : [];
    const external = await findExternalSubtitles(String(row.path));
    return [...embedded, ...external];
  });
  handle('playback:subtitleText', async (id, trackId) => {
    const row = s.repo.getRow(id);
    if (!row) throw new Error('Media not found');
    return readSubtitle(s.ffmpeg, String(row.path), await s.playback.probe(id), trackId);
  });
  handle('playback:sprite', (id) => {
    const layout = s.sprites.layout(id);
    if (layout && s.settings.get().library.previews !== 'off') s.sprites.warm(id);
    return layout;
  });
  handle('playback:lyrics', async (id) => {
    const row = s.repo.getRow(id);
    if (!row) throw new Error('Media not found');
    return loadLyrics(String(row.path));
  });
  handle('playback:screenshot', async (dataUrl, baseName) => {
    const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
    if (!m) throw new Error('Invalid screenshot data');
    const folder = s.settings.get().playback.screenshotFolder || join(app.getPath('pictures'), 'Gravity');
    await mkdir(folder, { recursive: true });
    const safe = baseName.replace(/[^\p{L}\p{N} _.-]+/gu, '_').slice(0, 80) || 'Screenshot';
    const file = join(folder, `${safe} ${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.png`);
    await writeFile(file, Buffer.from(m[1]!, 'base64'));
    return file;
  });
  handle('playback:prefs', (id, patch) => {
    if (patch) s.repo.playbackPrefsUpdate(id, patch);
    return s.repo.getPlaybackPrefs(id);
  });
  let blocker: number | null = null;
  handle('playback:keepAwake', (on) => {
    if (on && s.settings.get().playback.keepAwake) {
      if (blocker == null || !powerSaveBlocker.isStarted(blocker)) blocker = powerSaveBlocker.start('prevent-display-sleep');
    } else if (blocker != null) {
      powerSaveBlocker.stop(blocker);
      blocker = null;
    }
  });

  // ----- readers -----------------------------------------------------------
  const epubCache = new Map<number, EpubInfo>();
  handle('reader:epub', async (id) => {
    const row = s.repo.getRow(id);
    if (!row) throw new Error('Book not found');
    const zip = await s.zips.get(String(row.path), Number(row.mtime_ms));
    const { info } = await epubInfo(zip);
    epubCache.set(id, info);
    return info;
  });
  handle('reader:comic', async (id) => {
    const row = s.repo.getRow(id);
    if (!row) throw new Error('Comic not found');
    return s.comics.info({ path: String(row.path), isFolder: String(row.ext) === '', mtimeMs: Number(row.mtime_ms) });
  });
  handle('reader:search', async (id, query) => {
    const row = s.repo.getRow(id);
    const q = query.trim().toLowerCase();
    if (!row || q.length < 2) return [];
    const zip = await s.zips.get(String(row.path), Number(row.mtime_ms));
    const info = epubCache.get(id) ?? (await epubInfo(zip)).info;
    const out: { spineIndex: number; excerpt: string }[] = [];
    for (const item of info.spine) {
      const text = await spineText(zip, item.href).catch(() => '');
      const lower = text.toLowerCase();
      let at = lower.indexOf(q);
      let n = 0;
      while (at >= 0 && n < 5 && out.length < 80) {
        out.push({ spineIndex: item.index, excerpt: `${at > 40 ? '…' : ''}${text.slice(Math.max(0, at - 40), at + q.length + 60)}…` });
        at = lower.indexOf(q, at + q.length + 60);
        n++;
      }
    }
    return out;
  });

  // ----- window ------------------------------------------------------------
  handle('window:state', () => s.wm.getState());
  handle('window:setMode', (mode) => s.wm.setMode(mode));
  handle('window:fullscreen', (on) => s.wm.setFullscreen(on));
  handle('window:alwaysOnTop', (on) => s.wm.setAlwaysOnTop(on));
  handle('window:control', (a) => s.wm.control(a));
  handle('window:setAspect', (r) => s.wm.setAspect(r));
  handle('window:overlay', (o) => s.wm.setOverlayOptions(o));

  // ----- shell & dialogs ------------------------------------------------------
  handle('shell:reveal', (id) => {
    const row = s.repo.getRow(id);
    if (row) shell.showItemInFolder(String(row.path));
  });
  handle('shell:trash', async (id) => {
    const row = s.repo.getRow(id);
    if (!row) return false;
    try {
      await shell.trashItem(String(row.path));
    } catch (err) {
      throw new Error(`Could not move to trash: ${(err as Error).message}`);
    }
    s.repo.markMissing([id]);
    send('library:changed', { added: 0, updated: 0, removed: 1, kinds: [String(row.kind) as MediaItem['kind']] });
    return true;
  });
  handle('dialog:pickFolder', async (title) => {
    const r = await dialog.showOpenDialog(s.wm.win!, { title: title ?? 'Choose Folder', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  handle('dialog:pickFile', async (title, extensions) => {
    const r = await dialog.showOpenDialog(s.wm.win!, { title, properties: ['openFile'], filters: extensions.length ? [{ name: 'Files', extensions }] : undefined });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });

  // ----- library health (read-only) ------------------------------------------------
  const health = new HealthScanner(s.db);
  handle('health:scan', (options) => health.scan(options ?? {}));

  // ----- cache & data -----------------------------------------------------------
  const cacheStats =async (): Promise<CacheStats> => ({
    artBytes: (await dirSize(s.paths.art)) + (await dirSize(s.paths.artSrc)),
    previewBytes: await dirSize(s.paths.sprites),
    transcodeBytes: await dirSize(s.paths.tmp),
    dbBytes: existsSync(s.paths.db) ? statSync(s.paths.db).size : 0
  });
  handle('cache:stats', cacheStats);
  handle('cache:clear', async (what) => {
    const dirs = what === 'art' ? [s.paths.art] : what === 'previews' ? [s.paths.sprites] : [s.paths.art, s.paths.sprites, s.paths.tmp];
    for (const d of dirs) { await rm(d, { recursive: true, force: true }); await mkdir(d, { recursive: true }); }
    return cacheStats();
  });
  handle('db:backup', async () => {
    const r = await dialog.showSaveDialog(s.wm.win!, { title: 'Back Up Library Database', defaultPath: `gravity-library-${new Date().toISOString().slice(0, 10)}.db` });
    if (r.canceled || !r.filePath) return null;
    await rm(r.filePath, { force: true });
    s.db.raw.exec(`VACUUM INTO '${r.filePath.replace(/'/g, "''")}'`);
    return r.filePath;
  });
}
