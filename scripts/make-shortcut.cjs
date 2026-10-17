// Run by scripts/launch.mjs as `electron scripts/make-shortcut.cjs <electron.exe> <app folder>` on Windows.
// Writes the Start-menu and Desktop shortcuts. They carry the same AppUserModelID the app sets at startup, so once
// pinned to the taskbar the open window shares the pinned button instead of getting a second one.
const { app, shell } = require('electron');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

app.setPath('userData', join(tmpdir(), 'gravity-shortcut')); // keep clear of the real app's data
const [exe, root] = process.argv.slice(-2);

app.whenReady().then(() => {
  const link = {
    target: exe,
    args: `"${root}"`,
    cwd: root,
    icon: join(root, 'build', 'icon.ico'),
    iconIndex: 0,
    appUserModelId: 'app.gravity.mediaplayer',
    description: 'Gravity media player'
  };
  const folders = [join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'), app.getPath('desktop')];
  const write = (dir) => {
    try { return shell.writeShortcutLink(join(dir, 'Gravity.lnk'), 'create', link); } catch { return false; }
  };
  const ok = folders.map(write).every(Boolean);
  console.log(ok ? 'Created the Gravity shortcut in the Start menu and on the Desktop.' : 'Could not create every Gravity shortcut.');
  app.quit();
});
