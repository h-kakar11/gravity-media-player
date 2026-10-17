#!/usr/bin/env node
// One-click launcher behind Gravity.cmd: installs dependencies and rebuilds only when they or the sources changed,
// starts Gravity detached so the console can close, and on Windows adds Start-menu/Desktop shortcuts to pin.
// Extra arguments (a file to open, say) go to Gravity; `--shortcuts` recreates the shortcuts.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, statSync, utimesSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
process.chdir(root);
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const mtime = (p) => (existsSync(p) ? statSync(p).mtimeMs : 0);
const newest = (p) => (statSync(p).isDirectory() ? Math.max(0, ...readdirSync(p).map((n) => newest(join(p, n)))) : statSync(p).mtimeMs);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // some terminals set it, which would make Electron behave as plain Node

function npm(...a) {
  if (spawnSync('npm', a, { stdio: 'inherit', shell: true }).status !== 0) {
    console.error(`\n"npm ${a.join(' ')}" failed.`);
    process.exit(1);
  }
}

// Dependencies: first run, or package-lock.json changed since the last install (a pull that added packages).
const installed = 'node_modules/.package-lock.json';
if (!existsSync('node_modules/electron/path.txt') || mtime('package-lock.json') > mtime(installed)) {
  console.log('Installing dependencies (first run, or they changed)...');
  npm('install');
  if (existsSync(installed)) utimesSync(installed, new Date(), new Date()); // npm leaves it alone when nothing needed changing
}

// Build: an output is missing, or a source is newer than the oldest output.
const built = Math.min(mtime('dist/main/index.cjs'), mtime('dist/preload/index.cjs'), mtime('dist/renderer/index.html'));
if (Math.max(newest('src'), mtime('package.json'), mtime('vite.config.ts'), mtime('scripts/build-main.mjs')) > built) {
  console.log('Building Gravity...');
  npm('run', 'build');
}

const electron = require('electron'); // path to the Electron binary
const startMenuLink = join(env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Gravity.lnk');
if (process.platform === 'win32' && (args.includes('--shortcuts') || !existsSync(startMenuLink))) {
  spawnSync(electron, ['scripts/make-shortcut.cjs', electron, root], { stdio: 'inherit', env, windowsHide: true, timeout: 20000 });
}

console.log('Starting Gravity...');
const child = spawn(electron, ['.', ...args.filter((a) => a !== '--shortcuts')], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true, env });
child.on('error', (e) => { console.error(`Could not start Gravity: ${e.message}`); process.exit(1); });
// A second launch exits cleanly (Gravity is single-instance); anything else this early is a crash worth showing.
child.on('exit', (code, signal) => {
  if (code || signal) console.error(`\nGravity stopped right after starting (${signal ?? `exit code ${code}`}). Run "npm run dev" to see why.`);
  process.exit(code || signal ? 1 : 0);
});
setTimeout(() => { child.unref(); process.exit(0); }, 3000);
