#!/usr/bin/env node
// Renders build/icon.svg to the PNG sizes electron-builder (and the Linux window) expect.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const svg = readFileSync(resolve('build/icon.svg'));
for (const size of [1024, 512, 256]) {
  writeFileSync(resolve(`build/icon${size === 1024 ? '' : `-${size}`}.png`), await sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer());
}
console.log('Wrote build/icon.png (1024), icon-512.png, icon-256.png');
