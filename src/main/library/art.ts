import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { IMAGE_EXTS } from '@shared/formats';
import { naturalCompare } from '@shared/natural-sort';
import type { SettingsStore } from '../settings-store';
import type { AppPaths } from '../paths';
import type { LibraryRepo } from '../db/repo';
import type { Ffmpeg } from '../media/ffmpeg';
import { PdfReader } from '../readers/pdf';
import { ZipArchive } from '../readers/zip';
import { drives } from './drive';
import { isComicPageName } from './extract';
import { logger } from '../log';

const log = logger('art');

export type ArtSize = 'thumb' | 'large';
const DIMENSIONS: Record<ArtSize, number> = { thumb: 480, large: 1600 };

interface Job {
  run: () => Promise<void>;
  aborted: () => boolean;
}

/**
 * Generates and caches artwork lazily, the first time a view asks for it. Requests are served
 * newest-first (LIFO): when someone scrolls fast through a grid, the tiles currently on screen
 * win over the ones they've already scrolled past — which also keeps a spinning disk from
 * seeking for thumbnails nobody will see.
 */
export class ArtService {
  private stack: Job[] = [];
  private active = 0;
  private inflight = new Map<string, Promise<string | null>>();
  private zipPages = new Map<string, string>();

  constructor(
    private readonly repo: LibraryRepo,
    private readonly ffmpeg: Ffmpeg,
    private readonly paths: AppPaths,
    private readonly settings: SettingsStore
  ) {}

  private concurrency(): number {
    const mode = this.settings.get().library.hddMode;
    if (mode !== 'auto') return mode === 'on' ? 1 : 4;
    // Artwork is read from wherever the files are: be gentle if any library folder is a spinning disk.
    return drives.anyRotational() ? 1 : drives.allSolidState() ? 4 : 2;
  }

  cachePath(key: string, size: ArtSize): string {
    return join(this.paths.art, key.slice(0, 2), `${key}-${size}.jpg`);
  }

  async get(id: number, size: ArtSize, signal?: AbortSignal): Promise<string | null> {
    const row = this.repo.getRow(id);
    if (!row || row.art_src == null || row.art_key == null) return null;
    const key = String(row.art_key);
    const out = this.cachePath(key, size);
    if (existsSync(out)) return out;
    const flightKey = `${key}-${size}`;
    let p = this.inflight.get(flightKey);
    if (!p) {
      p = new Promise<string | null>((resolve) => {
        this.stack.push({
          aborted: () => false,
          run: async () => {
            try {
              resolve(await this.generate(id, row as Record<string, unknown>, size, out));
            } catch (err) {
              log.warn(`Artwork failed for #${id}:`, (err as Error).message);
              // Don't retry forever on a broken source; a rescan after the file changes re-enables it.
              this.repo.setArt(id, null, null);
              resolve(null);
            }
          }
        });
        this.pump();
      }).finally(() => this.inflight.delete(flightKey));
      this.inflight.set(flightKey, p);
    }
    void signal;
    return p;
  }

  private pump(): void {
    while (this.active < this.concurrency() && this.stack.length) {
      const job = this.stack.pop()!;
      this.active++;
      job.run().finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async generate(id: number, row: Record<string, unknown>, size: ArtSize, out: string): Promise<string | null> {
    const src = String(row.art_src);
    let input: string | Buffer;
    if (src.startsWith('file:')) input = src.slice(5);
    else if (src === 'self') input = String(row.path);
    else if (src === 'frame') input = await this.extractFrame(row);
    else if (src.startsWith('apic:')) input = await this.extractAttachedPic(row, Number(src.slice(5)));
    else if (src === 'comic') input = await this.comicCover(row);
    else return null;

    await mkdir(join(out, '..'), { recursive: true });
    const tmp = `${out}.${process.pid}.tmp`;
    const dim = DIMENSIONS[size];
    try {
      await sharp(input, { failOn: 'none', limitInputPixels: 1_000_000_000 })
        .rotate()
        .resize({ width: dim, height: dim, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#1c1c1e' })
        .jpeg({ quality: size === 'thumb' ? 80 : 88, mozjpeg: false })
        .toFile(tmp);
    } catch (err) {
      // sharp can't decode every format (BMP, ICO, animated oddities) — ffmpeg can.
      if (typeof input !== 'string' || !(await this.ffmpeg.available())) throw err;
      const buf = await this.ffmpeg.runBuffer(['-i', input, '-frames:v', '1', '-vf', `scale='min(${dim},iw)':-2`, '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '3', 'pipe:1']);
      await sharp(buf).jpeg({ quality: 82 }).toFile(tmp);
    }
    await rename(tmp, out);
    return out;
  }

  private async extractFrame(row: Record<string, unknown>): Promise<Buffer> {
    const dur = Number(row.duration) || 0;
    const t = dur < 8 ? dur / 2 : Math.min(Math.max(dur * 0.1, 4), 900);
    // Seek before -i so only the needed part of the file is read (important on HDDs).
    return this.ffmpeg.runBuffer(['-ss', t.toFixed(2), '-i', String(row.path), '-frames:v', '1', '-an', '-sn', '-vf', "scale='min(1280,iw)':-2", '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '3', 'pipe:1'], 45_000);
  }

  private async extractAttachedPic(row: Record<string, unknown>, streamIndex: number): Promise<Buffer> {
    return this.ffmpeg.runBuffer(['-i', String(row.path), '-map', `0:${streamIndex}`, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '2', 'pipe:1'], 30_000);
  }

  private async comicCover(row: Record<string, unknown>): Promise<string | Buffer> {
    const path = String(row.path);
    if (String(row.ext) === '') {
      const names = (await readdir(path)).filter((n) => (IMAGE_EXTS as readonly string[]).includes(n.split('.').pop()!.toLowerCase())).sort(naturalCompare);
      if (!names[0]) throw new Error('Empty comic folder');
      return join(path, names[0]);
    }
    if (path.toLowerCase().endsWith('.pdf')) {
      const pdf = new PdfReader();
      try { return await pdf.render(path, Number(row.mtime_ms), 0, 640); } finally { pdf.close(); }
    }
    const zip = await ZipArchive.open(path);
    try {
      const pages = zip.entries.filter((e) => isComicPageName(e.name)).map((e) => e.name).sort(naturalCompare);
      if (!pages[0]) throw new Error('No pages in archive');
      return await zip.read(pages[0]);
    } finally {
      zip.close();
    }
  }

  /** Delete least-recently-used cached files until the cache fits within the configured budget. */
  async prune(): Promise<void> {
    const budget = this.settings.get().performance.thumbnailCacheMb * 1024 * 1024;
    const files: { path: string; size: number; at: number }[] = [];
    let total = 0;
    for (const dir of [this.paths.art, this.paths.sprites]) {
      let subs: string[] = [];
      try { subs = await readdir(dir); } catch { continue; }
      for (const sub of subs) {
        const sd = join(dir, sub);
        let names: string[] = [];
        try { names = await readdir(sd); } catch { names = [sub]; }
        for (const n of names) {
          const p = names[0] === sub && n === sub ? join(dir, sub) : join(sd, n);
          try {
            const st = await stat(p);
            if (!st.isFile()) continue;
            files.push({ path: p, size: st.size, at: Math.max(st.atimeMs, st.mtimeMs) });
            total += st.size;
          } catch { /* vanished */ }
        }
      }
    }
    if (total <= budget) return;
    const { unlink } = await import('node:fs/promises');
    files.sort((a, b) => a.at - b.at);
    for (const f of files) {
      if (total <= budget * 0.8) break;
      try { await unlink(f.path); total -= f.size; } catch { /* ignore */ }
    }
    log.info('Pruned artwork cache');
  }
}
