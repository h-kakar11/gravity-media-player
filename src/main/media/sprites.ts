import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { SpriteSheet } from '@shared/types';
import type { LibraryRepo } from '../db/repo';
import type { SettingsStore } from '../settings-store';
import type { AppPaths } from '../paths';
import { logger } from '../log';
import { pool } from '../util';
import type { Ffmpeg } from './ffmpeg';
import { buildThumbArgs } from './ffmpeg-args';

const log = logger('sprites');

export const SPRITE_COLS = 6;
export const SPRITE_ROWS = 5;
const PER_SHEET = SPRITE_COLS * SPRITE_ROWS;
const THUMB_W = 240;

/**
 * Seek-bar preview thumbnails ("trickplay"). Instead of decoding the whole movie, each thumbnail
 * is a keyframe-only decode after an indexed seek, so generating previews for a 2-hour film
 * reads a few hundred KB per frame rather than the entire file — gentle on spinning disks.
 * Frames are packed into sheets of 6×5 so the player can fetch just the sheet it needs.
 */
export class SpriteService {
  private building = new Map<string, Promise<string>>();

  constructor(
    private readonly repo: LibraryRepo,
    private readonly ffmpeg: Ffmpeg,
    private readonly paths: AppPaths,
    private readonly settings: SettingsStore
  ) {}

  layout(mediaId: number): SpriteSheet | null {
    const row = this.repo.getRow(mediaId);
    if (!row || String(row.kind) !== 'video') return null;
    const duration = Number(row.duration);
    if (!duration || duration < 8) return null;
    const interval = Math.max(5, Math.ceil(duration / 600));
    const count = Math.floor(duration / interval) + 1;
    const ar = Number(row.width) > 0 && Number(row.height) > 0 ? Number(row.width) / Number(row.height) : 16 / 9;
    const thumbH = Math.max(2, Math.round(THUMB_W / ar / 2) * 2);
    return {
      url: `gravity://app/sprite/${mediaId}/{n}.jpg`,
      cols: SPRITE_COLS,
      rows: SPRITE_ROWS,
      thumbWidth: THUMB_W,
      thumbHeight: thumbH,
      intervalSec: interval,
      count
    };
  }

  private fileFor(row: Record<string, unknown>, n: number): string {
    const key = `${row.id}-${Math.round(Number(row.mtime_ms))}-${row.size}`;
    return join(this.paths.sprites, key.slice(0, 40), `${n}.jpg`);
  }

  /** Path of sheet `n`, generating it if needed. */
  sheet(mediaId: number, n: number): Promise<string> {
    const row = this.repo.getRow(mediaId);
    const layout = this.layout(mediaId);
    if (!row || !layout) return Promise.reject(new Error('No preview available'));
    const total = Math.ceil(layout.count / PER_SHEET);
    if (n < 0 || n >= total) return Promise.reject(new Error('Sheet out of range'));
    const out = this.fileFor(row, n);
    if (existsSync(out)) return Promise.resolve(out);
    let p = this.building.get(out);
    if (!p) {
      p = this.build(row, layout, n, out).finally(() => this.building.delete(out));
      this.building.set(out, p);
    }
    return p;
  }

  private async build(row: Record<string, unknown>, layout: SpriteSheet, n: number, out: string): Promise<string> {
    const file = String(row.path);
    const first = n * PER_SHEET;
    const last = Math.min(layout.count, first + PER_SHEET);
    const concurrency = this.settings.get().library.hddMode === 'off' ? 4 : this.settings.get().library.hddMode === 'on' ? 1 : 2;
    const idx = Array.from({ length: last - first }, (_, i) => first + i);
    const duration = Number(row.duration);
    const thumbs = await pool(idx, concurrency, async (i) => {
      try {
        const t = Math.min(i * layout.intervalSec, Math.max(0, duration - 1));
        return await this.ffmpeg.runBuffer(buildThumbArgs(file, t, layout.thumbWidth), 30_000);
      } catch {
        return null;
      }
    });
    const rows = Math.ceil(thumbs.length / layout.cols);
    const composites = thumbs
      .map((buf, i) => (buf ? { input: buf, left: (i % layout.cols) * layout.thumbWidth, top: Math.floor(i / layout.cols) * layout.thumbHeight } : null))
      .filter((c): c is { input: Buffer; left: number; top: number } => !!c);
    // Normalise each tile to the exact cell size so uneven aspect ratios can't bleed into neighbours.
    const tiles = await Promise.all(composites.map(async (c) => ({ ...c, input: await sharp(c.input).resize(layout.thumbWidth, layout.thumbHeight, { fit: 'cover' }).toBuffer() })));
    const buf = await sharp({ create: { width: layout.cols * layout.thumbWidth, height: rows * layout.thumbHeight, channels: 3, background: '#000' } })
      .composite(tiles)
      .jpeg({ quality: 70 })
      .toBuffer();
    await mkdir(join(out, '..'), { recursive: true });
    const tmp = `${out}.tmp`;
    await writeFile(tmp, buf);
    await rename(tmp, out);
    log.debug(`Built preview sheet ${n} for #${row.id} (${tiles.length} frames)`);
    return out;
  }

  /** Generate every sheet in the background, starting near `startAt`. Safe to call repeatedly. */
  warm(mediaId: number, startAt = 0): void {
    const layout = this.layout(mediaId);
    if (!layout) return;
    const total = Math.ceil(layout.count / PER_SHEET);
    const mid = Math.min(total - 1, Math.floor(startAt / layout.intervalSec / PER_SHEET));
    const order = [...Array(total).keys()].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
    void (async () => {
      for (const n of order) {
        try { await this.sheet(mediaId, n); } catch { return; }
      }
    })();
  }
}
