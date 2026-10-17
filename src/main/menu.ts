import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { ACTION_BY_ID, effectiveKeymap, normalizeCombo, toAccelerator } from '@shared/hotkeys';
import type { SettingsStore } from './settings-store';
import type { WindowManager } from './window';

const isMac = process.platform === 'darwin';

/**
 * Native menu bar. Every command is reachable here (Apple HIG: "use the menu bar to give people
 * easy access to all the commands"). Shortcuts shown come from the user's keymap. The renderer
 * handles the key events itself, so on Windows/Linux the accelerators are display-only; on macOS
 * only combinations with a modifier are registered, so single keys (Space, arrows) still reach
 * text fields.
 */
export function buildMenu(settings: SettingsStore, wm: WindowManager, devTools: boolean, logsPath: string): void {
  const keymap = effectiveKeymap(settings.get().hotkeys);
  const send = (id: string) => wm.win?.webContents.send('gravity:event:menu:action', id);

  const item = (id: string, label?: string, extra: Partial<MenuItemConstructorOptions> = {}): MenuItemConstructorOptions => {
    const def = ACTION_BY_ID.get(id);
    const combo = keymap[id]?.map(normalizeCombo).find((c) => toAccelerator(c)) ?? null;
    return {
      label: label ?? def?.label ?? id,
      accelerator: combo ? toAccelerator(combo)! : undefined,
      registerAccelerator: isMac ? undefined : false,
      click: () => send(id),
      ...extra
    };
  };
  const plain = (label: string, id: string, extra: Partial<MenuItemConstructorOptions> = {}): MenuItemConstructorOptions => ({ label, click: () => send(id), ...extra });

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            item('app.settings', 'Settings…'),
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const }, { role: 'hideOthers' as const }, { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const }
          ]
        }]
      : []),
    {
      label: 'File',
      submenu: [
        item('library.addFolder', 'Add Library Folder…'),
        plain('Open File…', 'file.open', { accelerator: undefined }),
        { type: 'separator' },
        item('library.rescan', 'Rescan Library'),
        plain('Deep Rescan (Check Every File)', 'library.deepRescan'),
        { type: 'separator' },
        plain('Show in Folder', 'file.reveal'),
        ...(isMac ? [{ role: 'close' as const }] : [item('app.settings', 'Settings…'), { type: 'separator' as const }, { role: 'quit' as const }])
      ]
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' }, item('nav.search', 'Find…')] },
    {
      label: 'View',
      submenu: [
        item('view.sidebar'),
        { type: 'separator' },
        item('view.grid', 'as Grid'), item('view.list', 'as List'), item('view.columns', 'as Columns'),
        { type: 'separator' },
        item('view.info', 'Show Info Panel'),
        item('view.zoomIn'), item('view.zoomOut'),
        { type: 'separator' },
        item('window.fullscreen', 'Enter Full Screen'),
        ...(devTools ? [{ type: 'separator' as const }, { role: 'reload' as const }, { role: 'toggleDevTools' as const }] : [])
      ]
    },
    {
      label: 'Go',
      submenu: [
        item('nav.back'), item('nav.forward'), { type: 'separator' },
        item('nav.home'), item('nav.videos'), item('nav.music'), item('nav.comics'), item('nav.books'), item('nav.photos'),
        { type: 'separator' },
        item('nav.browse'), item('nav.favorites'), item('nav.history'), item('nav.stats')
      ]
    },
    {
      label: 'Playback',
      submenu: [
        item('media.playPause', 'Play / Pause'), item('media.stop'),
        { type: 'separator' },
        item('media.seekBack', 'Skip Back'), item('media.seekForward', 'Skip Forward'),
        item('media.previous'), item('media.next'),
        { type: 'separator' },
        item('media.speedUp'), item('media.speedDown'), item('media.speedReset'),
        { type: 'separator' },
        item('media.volumeUp'), item('media.volumeDown'), item('media.mute'),
        { type: 'separator' },
        item('video.subtitles', 'Toggle Subtitles'), item('video.audioNext', 'Next Audio Track'), item('video.pip'), item('video.stats'),
        { type: 'separator' },
        item('music.shuffle'), item('music.repeat'), item('music.lyrics', 'Show Lyrics'), item('music.queue', 'Show Queue')
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' }, ...(isMac ? [{ role: 'zoom' as const }] : [{ role: 'togglefullscreen' as const, visible: false }]),
        { type: 'separator' },
        item('window.mini', 'Mini Player'), item('window.overlay', 'Overlay (Always on Top)'),
        ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const }] : [])
      ]
    },
    {
      role: 'help',
      submenu: [
        item('app.shortcuts', 'Keyboard Shortcuts'),
        { label: 'Open Log Folder', click: () => void shell.openPath(logsPath) }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
