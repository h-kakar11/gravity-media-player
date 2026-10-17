#!/usr/bin/env node
// Renders build/icon.svg to the PNG sizes electron-builder (and the Linux window) expect.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const svg = readFileSync(resolve('build/icon.svg'));
for (const size of [1024, 512, 256]) {
  writeFileSync(resolve(`build/icon${size === 1024 ? '' : `-${size}`}.png`), await sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer());
}
// Windows shortcuts want an .ico; Vista and later accept a 256px PNG inside the ICO container.
const png = readFileSync(resolve('build/icon-256.png'));
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2); // type: icon
ico.writeUInt16LE(1, 4); // one image
ico.writeUInt16LE(1, 10); // colour planes (width and height bytes stay 0, meaning 256)
ico.writeUInt16LE(32, 12); // bits per pixel
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18); // image data starts right after the header
writeFileSync(resolve('build/icon.ico'), Buffer.concat([ico, png]));
console.log('Wrote build/icon.png (1024), icon-512.png, icon-256.png, icon.ico');
