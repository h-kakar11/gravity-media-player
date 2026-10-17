import { BrowserWindow, globalShortcut, nativeTheme, screen, type Rectangle } from 'electron';
import { join } from 'node:path';
import type { WindowMode, WindowState } from '@shared/types';
import type { SettingsStore } from './settings-store';
import { logger } from './log';

const log = logger('window');
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

const MIN_NORMAL = { width: 900, height: 580 };
const MIN_MINI = { width: 300, height: 96 };

export interface WindowOptions {
  preload: string;
  devUrl: string | null;
  testMode: boolean;
}

/**
 * Owns the single app window and its three presentation modes:
 *  - normal:  the full library window
 *  - mini:    compact always-on-top player (music mini-player / small video)
 *  - overlay: frameless, aspect-locked, always-on-top video with adjustable opacity and optional click-through
 * Switching modes keeps the same renderer (and therefore playback) alive; only the window geometry changes.
 */
export class WindowManager {
  win: BrowserWindow | null = null;
  private mode: WindowMode = 'normal';
  private savedNormal: Rectangle | null = null;
  private savedMaximized = false;
  private alwaysOnTop = false;
  private clickThrough = false;
  private saveTimer: NodeJS.Timeout | null = null;
  readonly nativeMaterial = isMac || isWin;

  constructor(private readonly settings: SettingsStore, private readonly opts: WindowOptions) {
    nativeTheme.on('updated', () => this.applyTheme());
    settings.on('changed', () => this.applyTheme());
  }

  create(): BrowserWindow {
    const saved = this.settings.get().window.bounds;
    const display = screen.getPrimaryDisplay().workArea;
    const width = Math.min(saved?.width ?? 1360, display.width);
    const height = Math.min(saved?.height ?? 860, display.height);
    const dark = nativeTheme.shouldUseDarkColors;
    const win = new BrowserWindow({
      width,
      height,
      x: saved?.x,
      y: saved?.y,
      minWidth: MIN_NORMAL.width,
      minHeight: MIN_NORMAL.height,
      show: false,
      title: 'Gravity',
      backgroundColor: this.nativeMaterial ? '#00000000' : dark ? '#1c1c1e' : '#f5f5f7',
      ...(isMac
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 19 }, vibrancy: 'sidebar' as const, visualEffectState: 'followWindow' as const }
        : { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#f2f2f7' : '#1c1c1e', height: 44 } }),
      ...(isWin ? { backgroundMaterial: 'mica' as const } : {}),
      webPreferences: {
        preload: this.opts.preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
        autoplayPolicy: 'no-user-gesture-required',
        // Keep timers (crossfade, progress saving) and audio running while minimised or covered.
        backgroundThrottling: false,
        webSecurity: true
      }
    });
    this.win = win;
    if (saved?.maximized) win.maximize();

    win.once('ready-to-show', () => win.show());
    const emit = () => this.emitState();
    for (const ev of ['enter-full-screen', 'leave-full-screen', 'maximize', 'unmaximize', 'focus', 'blur', 'restore'] as const) win.on(ev as 'focus', emit);
    win.on('resize', () => this.scheduleSave());
    win.on('move', () => this.scheduleSave());
    win.on('close', () => this.saveBounds());
    win.on('closed', () => {
      this.win = null;
      globalShortcut.unregister('CommandOrControl+Alt+L');
    });

    // Lock navigation: the window only ever shows our own app.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith('gravity://app') && !(this.opts.devUrl && url.startsWith(this.opts.devUrl))) e.preventDefault();
    });

    const url = this.opts.devUrl ?? 'gravity://app/index.html';
    void win.loadURL(url).catch((err) => log.error('Failed to load renderer', err));
    this.applyTheme();
    return win;
  }

  private applyTheme(): void {
    const t = this.settings.get().appearance.theme;
    nativeTheme.themeSource = t === 'light' || t === 'paper' ? 'light' : t === 'dark' || t === 'midnight' || t === 'contrast' ? 'dark' : 'system';
    if (!this.win || this.win.isDestroyed()) return;
    const dark = nativeTheme.shouldUseDarkColors;
    if (!isMac) {
      try { this.win.setTitleBarOverlay({ color: '#00000000', symbolColor: dark ? '#f2f2f7' : '#1c1c1e', height: this.mode === 'normal' ? 44 : 28 }); } catch { /* unsupported */ }
    }
    if (!this.nativeMaterial) this.win.setBackgroundColor(dark ? '#1c1c1e' : '#f5f5f7');
  }

  getState(): WindowState {
    const w = this.win;
    return {
      fullscreen: !!w?.isFullScreen(),
      maximized: !!w?.isMaximized(),
      mode: this.mode,
      alwaysOnTop: this.alwaysOnTop,
      focused: !!w?.isFocused()
    };
  }

  private emitState(): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('gravity:event:window:state', this.getState());
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveBounds(), 600);
  }

  private saveBounds(): void {
    const w = this.win;
    if (!w || w.isDestroyed() || w.isFullScreen() || w.isMinimized()) return;
    if (this.mode === 'normal') {
      const b = w.isMaximized() ? this.savedNormal ?? w.getNormalBounds() : w.getBounds();
      this.settings.set({ window: { bounds: { x: b.x, y: b.y, width: b.width, height: b.height, maximized: w.isMaximized() } } });
    } else {
      const b = w.getBounds();
      this.settings.set({ window: this.mode === 'mini' ? { miniBounds: { x: b.x, y: b.y, width: b.width, height: b.height } } : { overlayBounds: { x: b.x, y: b.y, width: b.width, height: b.height } } });
    }
  }

  setMode(mode: WindowMode): WindowState {
    const w = this.win;
    if (!w || w.isDestroyed() || mode === this.mode) return this.getState();
    if (w.isFullScreen()) w.setFullScreen(false);
    if (this.mode === 'normal') {
      this.savedMaximized = w.isMaximized();
      this.savedNormal = this.savedMaximized ? w.getNormalBounds() : w.getBounds();
    } else {
      this.saveBounds();
    }
    const previous = this.mode;
    this.mode = mode;

    if (mode === 'normal') {
      w.setAlwaysOnTop(false);
      this.alwaysOnTop = false;
      this.setClickThrough(false);
      w.setOpacity(1);
      w.setAspectRatio(0);
      w.setMinimumSize(MIN_NORMAL.width, MIN_NORMAL.height);
      w.setResizable(true);
      if (isMac) w.setWindowButtonVisibility(true);
      const b = this.savedNormal ?? undefined;
      if (b) w.setBounds(this.onScreen(b));
      if (this.savedMaximized) w.maximize();
    } else {
      w.unmaximize();
      w.setMinimumSize(MIN_MINI.width, MIN_MINI.height);
      const s = this.settings.get().window;
      const saved = mode === 'mini' ? s.miniBounds : s.overlayBounds;
      const fallback = mode === 'mini' ? { width: 380, height: 132 } : { width: 520, height: 292 };
      w.setBounds(this.onScreen(saved ? { x: saved.x ?? 0, y: saved.y ?? 0, width: saved.width, height: saved.height } : this.cornerBounds(fallback.width, fallback.height)));
      this.alwaysOnTop = true;
      w.setAlwaysOnTop(true, mode === 'overlay' ? 'screen-saver' : 'floating');
      if (isMac) w.setWindowButtonVisibility(mode === 'mini' ? false : false);
      if (mode === 'overlay') w.setAspectRatio(16 / 9);
      else w.setAspectRatio(0);
    }
    log.info(`Window mode ${previous} → ${mode}`);
    this.applyTheme();
    this.emitState();
    return this.getState();
  }

  private cornerBounds(width: number, height: number): Rectangle {
    const area = screen.getDisplayMatching(this.win!.getBounds()).workArea;
    return { x: area.x + area.width - width - 24, y: area.y + area.height - height - 24, width, height };
  }

  /** Keep restored geometry inside a connected display (a monitor may have been unplugged). */
  private onScreen(b: Rectangle): Rectangle {
    const display = screen.getDisplayMatching(b).workArea;
    const width = Math.min(b.width, display.width);
    const height = Math.min(b.height, display.height);
    const x = Math.min(Math.max(b.x, display.x), display.x + display.width - width);
    const y = Math.min(Math.max(b.y, display.y), display.y + display.height - height);
    return { x, y, width, height };
  }

  setAspect(ratio: number): void {
    if (!this.win || this.win.isDestroyed()) return;
    if (this.mode === 'normal') return;
    // 0 releases the lock (the video closed while the mini window stays up for music).
    if (ratio === 0) { this.win.setAspectRatio(0); return; }
    if (ratio > 0.2 && ratio < 6) {
      this.win.setAspectRatio(ratio);
      const b = this.win.getBounds();
      // Resizing from the top-left corner can push a corner-docked window off the bottom of the screen.
      this.win.setBounds(this.onScreen({ x: b.x, y: b.y, width: b.width, height: Math.round(b.width / ratio) }));
    }
  }

  setFullscreen(on?: boolean): WindowState {
    const w = this.win;
    if (!w || w.isDestroyed()) return this.getState();
    if (this.mode !== 'normal') this.setMode('normal');
    w.setFullScreen(on ?? !w.isFullScreen());
    return this.getState();
  }

  setAlwaysOnTop(on: boolean): WindowState {
    if (this.win && !this.win.isDestroyed() && this.mode === 'normal') {
      this.alwaysOnTop = on;
      this.win.setAlwaysOnTop(on);
      this.emitState();
    }
    return this.getState();
  }

  setOverlayOptions(o: { opacity?: number; clickThrough?: boolean }): void {
    if (!this.win || this.win.isDestroyed()) return;
    if (o.opacity != null) this.win.setOpacity(Math.min(1, Math.max(0.25, o.opacity)));
    if (o.clickThrough != null) this.setClickThrough(o.clickThrough);
  }

  /**
   * Click-through lets the overlay float over other apps without intercepting the mouse. Since the
   * window can no longer be clicked, a global shortcut is the way back.
   */
  private setClickThrough(on: boolean): void {
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    if (on === this.clickThrough) return;
    this.clickThrough = on;
    w.setIgnoreMouseEvents(on, { forward: true });
    if (on) {
      const ok = globalShortcut.register('CommandOrControl+Alt+L', () => { this.setClickThrough(false); w.webContents.send('gravity:event:toast', { kind: 'info', message: 'Overlay is interactive again' }); });
      if (!ok) { this.clickThrough = false; w.setIgnoreMouseEvents(false); }
    } else {
      globalShortcut.unregister('CommandOrControl+Alt+L');
    }
  }

  control(action: 'minimize' | 'maximize' | 'close'): void {
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    if (action === 'minimize') w.minimize();
    else if (action === 'close') w.close();
    else if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  }

  focus(): void {
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    if (w.isMinimized()) w.restore();
    w.focus();
  }
}

export const preloadPath = (dir: string): string => join(dir, '../preload/index.cjs');
