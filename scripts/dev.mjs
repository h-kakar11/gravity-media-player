#!/usr/bin/env node
// Development runner: Vite dev server for the renderer, esbuild watch for main/preload, and Electron
// restarted whenever the main bundle changes.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { watch as fsWatch, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
process.chdir(root);
const require = createRequire(import.meta.url);

const build = spawn(process.execPath, ['scripts/build-main.mjs', '--watch'], { stdio: 'inherit' });
const server = await createServer({ configFile: resolve(root, 'vite.config.ts') });
await server.listen();
const url = server.resolvedUrls?.local[0]?.replace(/\/$/, '') ?? 'http://127.0.0.1:5173';

let electron = null;
let restarting = false;
function launch() {
  const bin = require('electron');
  electron = spawn(bin, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, GRAVITY_DEV_URL: url } });
  electron.on('exit', (code) => {
    if (restarting) { restarting = false; launch(); return; }
    cleanup(code ?? 0);
  });
}
function cleanup(code) {
  build.kill();
  server.close().finally(() => process.exit(code));
}
while (!existsSync(resolve(root, 'dist/main/index.cjs'))) await new Promise((r) => setTimeout(r, 200));
launch();

let timer = null;
fsWatch(resolve(root, 'dist/main'), () => {
  clearTimeout(timer);
  timer = setTimeout(() => { if (electron) { restarting = true; electron.kill(); } }, 400);
});
process.on('SIGINT', () => cleanup(0));
