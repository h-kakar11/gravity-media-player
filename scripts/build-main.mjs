#!/usr/bin/env node
// Bundles the Electron main process and preload script with esbuild.
import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const watch = process.argv.includes('--watch');

// Native or binary-bearing packages stay external and ship in node_modules.
const external = ['electron', 'sharp', '@parcel/watcher', '@ffmpeg-installer/ffmpeg', '@ffprobe-installer/ffprobe'];

const common = {
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  bundle: true,
  sourcemap: true,
  logLevel: 'info',
  alias: { '@shared': resolve(root, 'src/shared') },
  absWorkingDir: root
};

const targets = [
  {
    ...common,
    entryPoints: ['src/main/index.ts'],
    outfile: 'dist/main/index.cjs',
    external,
    // ESM-style `import.meta.url` is used in a few modules; map it for the CJS bundle.
    define: { 'import.meta.url': '__importMetaUrl' },
    banner: { js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;" }
  },
  { ...common, entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.cjs', external: ['electron'] }
];

if (watch) {
  const ctxs = await Promise.all(targets.map((t) => context(t)));
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log('Watching main + preload…');
} else {
  await Promise.all(targets.map((t) => build(t)));
}
