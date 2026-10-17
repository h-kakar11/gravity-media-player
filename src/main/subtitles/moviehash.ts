import { open } from 'node:fs/promises';

const CHUNK = 64 * 1024;

/**
 * OpenSubtitles "moviehash": the file size plus the 64-bit little-endian words of the first and last 64 KiB,
 * modulo 2^64, as 16 hex digits. Files under 128 KiB have no hash.
 */
export async function movieHash(path: string): Promise<string | null> {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    if (size < CHUNK * 2) return null;
    let sum = BigInt(size);
    const buf = Buffer.alloc(CHUNK);
    for (const at of [0, size - CHUNK]) {
      await fh.read(buf, 0, CHUNK, at);
      for (let i = 0; i < CHUNK; i += 8) sum += buf.readBigUInt64LE(i);
    }
    return (sum & 0xffffffffffffffffn).toString(16).padStart(16, '0');
  } finally {
    await fh.close();
  }
}
