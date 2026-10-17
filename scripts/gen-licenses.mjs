#!/usr/bin/env node
/**
 * Writes THIRD_PARTY_LICENSES.md: the licences of everything that ships inside the app.
 *
 * It walks the dependency tree from the packages that end up in the bundles (the renderer and main
 * bundles inline their libraries, so build-time packages count too) and groups identical licence
 * texts together. Run `npm run licenses` after changing dependencies.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const root = resolve('.');
const require = createRequire(join(root, 'package.json'));

// Packages whose code is inlined into dist/ or loaded at runtime (everything else is build/test tooling).
const SHIPPED = [
  'react', 'react-dom', 'zustand', 'lucide-react', '@tanstack/react-virtual', '@fontsource-variable/inter',
  'music-metadata', 'fast-xml-parser', 'yauzl', 'sharp', '@parcel/watcher', '@ffmpeg-installer/ffmpeg', '@ffprobe-installer/ffprobe'
];

function packageDir(name, from) {
  let dir = from;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

const seen = new Map();
function visit(name, from) {
  const dir = packageDir(name, from);
  if (!dir) return;
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) return;
  seen.set(key, { pkg, dir });
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) visit(dep, dir);
}
for (const name of SHIPPED) visit(name, root);

const licenseName = (pkg) => (typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? pkg.licenses?.map((l) => l.type).join(' OR ') ?? 'UNKNOWN');
function licenseText(dir) {
  const file = readdirSync(dir).find((f) => /^(licen[sc]e|copying)(\.|$)/i.test(f));
  return file ? readFileSync(join(dir, file), 'utf8').trim() : null;
}

const groups = new Map();
const rows = [];
for (const { pkg, dir } of [...seen.values()].sort((a, b) => a.pkg.name.localeCompare(b.pkg.name))) {
  const text = licenseText(dir);
  const lic = licenseName(pkg);
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? pkg.homepage ?? '';
  rows.push({ id: `${pkg.name}@${pkg.version}`, lic, repo: repo.replace(/^git\+/, '').replace(/\.git$/, '') });
  const h = createHash('sha1').update(text ?? `spdx:${lic}`).digest('hex');
  const g = groups.get(h) ?? { text: text ?? `Licensed under ${lic}. See the package's repository for the full text.`, lic, pkgs: [] };
  g.pkgs.push(`${pkg.name}@${pkg.version}`);
  groups.set(h, g);
}

const out = [];
out.push('# Third-party licences\n');
out.push('Gravity is built on open-source software. This file lists what ships inside the app and the terms it comes with. Regenerate it with `npm run licenses`.\n');
out.push('## Platform and tools\n');
out.push('- **Electron** (MIT) and **Chromium** (BSD-3-Clause and others). Electron’s own distribution carries `LICENSE` and `LICENSES.chromium.html` with the complete Chromium and Node.js notices; they ship alongside the application binary.');
out.push('- **Node.js** (MIT) is embedded in Electron.');
out.push('- **SQLite** (public domain) is embedded in Node.js and used through `node:sqlite`.');
out.push('- **Inter** typeface by Rasmus Andersson — SIL Open Font License 1.1 (text below under `@fontsource-variable/inter`).');
out.push('- **ffmpeg / ffprobe** are *separate programs*, started as child processes — Gravity does not link against them. The build in `@ffmpeg-installer/ffmpeg` is a static GPL-licensed build; its source is available from https://ffmpeg.org/ and from the packagers listed below. You can replace it with your own build in Settings → Performance → ffmpeg, or remove it and rely on a system installation. Gravity’s own code is not a derivative work of ffmpeg.');
out.push('- **libvips** (LGPL-3.0-or-later) is the image library inside `sharp`. It ships as a separate shared library (`@img/sharp-libvips-*`) next to the app rather than being statically linked, so it can be replaced with another build of the same version.\n');
out.push('## Packages\n');
out.push('| Package | Licence | Source |\n|---|---|---|');
for (const r of rows) out.push(`| ${r.id} | ${r.lic} | ${r.repo} |`);
out.push('\n## Licence texts\n');
for (const g of [...groups.values()].sort((a, b) => a.lic.localeCompare(b.lic) || a.pkgs[0].localeCompare(b.pkgs[0]))) {
  out.push(`### ${g.lic}\n`);
  out.push(`Applies to: ${g.pkgs.join(', ')}\n`);
  out.push('```text\n' + g.text.replace(/```/g, "'''") + '\n```\n');
}
writeFileSync('THIRD_PARTY_LICENSES.md', out.join('\n'));
console.log(`THIRD_PARTY_LICENSES.md: ${rows.length} packages, ${groups.size} distinct licence texts`);
const unknown = rows.filter((r) => r.lic === 'UNKNOWN');
if (unknown.length) console.warn('No licence declared:', unknown.map((r) => r.id).join(', '));
