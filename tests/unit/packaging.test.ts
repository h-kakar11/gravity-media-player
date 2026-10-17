import { describe, expect, it } from 'vitest';
import { kindOfExt } from '../../src/shared/formats';
// @ts-expect-error plain JS config module without type declarations
import config, { ASSOCIATIONS } from '../../electron-builder.config.mjs';

describe('packaging config', () => {
  it('only associates file types the library can actually open', () => {
    const exts: string[] = ASSOCIATIONS.flatMap((a: { ext: string[] }) => a.ext);
    expect(exts.length).toBeGreaterThan(30);
    expect(exts.filter((e) => kindOfExt(e) == null)).toEqual([]);
    expect(new Set(exts).size).toBe(exts.length); // no extension claimed twice
    expect(exts).not.toContain('ts'); // would hijack TypeScript files
  });

  it('keeps native modules and bundled binaries outside the asar', () => {
    const unpack: string[] = config.asarUnpack;
    for (const pkg of ['sharp', '@parcel', '@ffmpeg-installer', '@ffprobe-installer']) expect(unpack.some((g) => g.includes(pkg))).toBe(true);
  });
});
