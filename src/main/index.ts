import { app, BrowserWindow, powerMonitor, session } from 'electron';
import { join } from 'node:path';
import { extOf, kindOfExt } from '@shared/formats';
import { Db } from './db/database';
import { PlaylistRepo } from './db/playlists';
import { LibraryRepo } from './db/repo';
import { StatsRepo } from './db/stats';
import { registerIpc } from './ipc';
import { ArtService } from './library/art';
import { MetadataService } from './metadata/service';
import { OrganiseService } from './organise/service';
import { Indexer } from './library/indexer';
import { LibraryWatcher } from './library/watcher';
import { initLog, logger } from './log';
import { buildMenu } from './menu';
import { Ffmpeg } from './media/ffmpeg';
import { PlaybackService } from './media/playback-service';
import { SpriteService } from './media/sprites';
import { appPaths } from './paths';
import { installProtocol, registerScheme } from './protocol';
import { ComicReader } from './readers/comic';
import { ZipCache } from './readers/zip';
import { SettingsStore } from './settings-store';
import { WindowManager } from './window';

const log = logger('main');
const devUrl = process.env.GRAVITY_DEV_URL ?? null;
const testMode = process.env.GRAVITY_TEST === '1';

// Tests and portable setups can relocate all app data.
if (process.env.GRAVITY_USER_DATA) app.setPath('userData', process.env.GRAVITY_USER_DATA);
app.setName('Gravity');
registerScheme();

if (!testMode && !app.requestSingleInstanceLock()) {
  app.quit();
}

// Chromium switches that must be set before the app is ready. Settings are read early for this.
const earlySettings = new SettingsStore(join(app.getPath('userData'), 'settings.json'));
const perf = earlySettings.get().performance;
if (perf.uncappedFps) {
  // Lets high-frame-rate content (and high-refresh displays) present frames as fast as they are decoded.
  app.commandLine.appendSwitch('disable-frame-rate-limit');
  app.commandLine.appendSwitch('disable-gpu-vsync');
}
if (!perf.hardwareDecode) app.commandLine.appendSwitch('disable-accelerated-video-decode');
const features = ['PlatformHEVCDecoderSupport'];
if (process.platform === 'linux' && perf.hardwareDecode) features.push('VaapiVideoDecoder', 'VaapiIgnoreDriverChecks', 'AcceleratedVideoDecodeLinuxGL');
const disabled: string[] = [];
if (process.platform === 'win32') disabled.push('CalculateNativeWinOcclusion'); // keep rendering/audio alive when covered
app.commandLine.appendSwitch('enable-features', features.join(','));
if (disabled.length) app.commandLine.appendSwitch('disable-features', disabled.join(','));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (testMode) {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}

let services: ReturnType<typeof createServices> | null = null;
const pendingOpen: string[] = [];

function createServices() {
  const paths = appPaths();
  initLog(paths.logs);
  const settings = earlySettings;
  const db = new Db(paths.db);
  const repo = new LibraryRepo(db);
  const ffmpeg = new Ffmpeg(settings);
  const indexer = new Indexer(repo, settings, ffmpeg, paths);
  const watcher = new LibraryWatcher(indexer);
  const zips = new ZipCache();
  const playback = new PlaybackService(repo, ffmpeg, settings);
  const art = new ArtService(repo, ffmpeg, paths, settings);
  const meta = new MetadataService(db, repo, paths, settings);
  const organise = new OrganiseService(db, repo, indexer, paths);
  const sprites = new SpriteService(repo, ffmpeg, paths, settings);
  const comics = new ComicReader(zips);
  const wm = new WindowManager(settings, { preload: join(__dirname, '../preload/index.cjs'), devUrl, testMode });
  return { paths, settings, db, repo, playlists: new PlaylistRepo(db), stats: new StatsRepo(db), indexer, watcher, ffmpeg, playback, art, meta, organise, sprites, comics, zips, wm, devUrl, testMode };
}

function mediaPathsFrom(argv: string[]): string[] {
  return argv.slice(1).filter((a) => !a.startsWith('-') && kindOfExt(extOf(a)) != null);
}

async function openFiles(paths: string[]): Promise<void> {
  if (!services || paths.length === 0) return;
  const ids = await services.indexer.ingestFiles(paths);
  services.indexer.flushChanges();
  services.wm.focus();
  services.wm.win?.webContents.send('gravity:event:open-media', ids);
}

app.on('second-instance', (_e, argv) => {
  services?.wm.focus();
  void openFiles(mediaPathsFrom(argv));
});
app.on('open-file', (e, path) => {
  e.preventDefault();
  if (services) void openFiles([path]);
  else pendingOpen.push(path);
});

app.whenReady().then(async () => {
  services = createServices();
  const s = services;
  const rendererDir = devUrl ? null : join(app.getAppPath(), 'dist/renderer');
  installProtocol({ repo: s.repo, playback: s.playback, art: s.art, sprites: s.sprites, comics: s.comics, zips: s.zips, rendererDir });

  // The app never needs sensor/camera access; only full screen is granted.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'fullscreen'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen' || permission === 'media');

  registerIpc(s);
  const win = s.wm.create();
  const rebuild = () => buildMenu(s.settings, s.wm, !!devUrl || testMode || process.env.GRAVITY_DEBUG === '1', s.paths.logs);
  rebuild();
  let menuTimer: NodeJS.Timeout | null = null;
  s.settings.on('changed', () => { if (menuTimer) clearTimeout(menuTimer); menuTimer = setTimeout(rebuild, 300); });

  win.webContents.once('did-finish-load', () => {
    // Startup work happens after the window is up, so the UI is never waiting on the disk.
    setTimeout(() => {
      void s.ffmpeg.resolve();
      void s.watcher.sync(s.repo.listRoots(), s.settings.get().library.watch);
      if (s.settings.get().library.scanOnStartup && !testMode) void s.indexer.scanAll();
      void s.art.prune();
      void openFiles([...pendingOpen.splice(0), ...mediaPathsFrom(process.argv)]);
    }, 600);
  });

  powerMonitor.on('resume', () => {
    // Drives may have been unmounted/remounted while asleep.
    win.webContents.send('gravity:event:system:resume', null);
    if (s.settings.get().library.scanOnStartup) setTimeout(() => void s.indexer.scanAll(), 3000);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) s.wm.create();
  });
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => {
  if (!services) return;
  const s = services;
  s.settings.flush();
  s.playback.closeAll();
  s.zips.clear();
  void s.watcher.stopAll();
  try { s.db.close(); } catch (err) { log.warn('DB close failed', err); }
});

process.on('uncaughtException', (err) => log.error('Uncaught exception', err));
process.on('unhandledRejection', (err) => log.error('Unhandled rejection', err));
