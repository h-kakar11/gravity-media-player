import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { IMAGE_EXTS } from '@shared/formats';
import { naturalCompare } from '@shared/natural-sort';
import type { ComicInfo } from '@shared/types';
import { isComicPageName } from '../library/extract';
import type { PdfReader } from './pdf';
import type { ZipCache } from './zip';

export interface ComicSource {
  path: string;
  isFolder: boolean;
  mtimeMs: number;
}

const isPdf = (src: ComicSource) => !src.isFolder && src.path.toLowerCase().endsWith('.pdf');

const isImg = (n: string) => (IMAGE_EXTS as readonly string[]).includes(n.split('.').pop()!.toLowerCase());

export class ComicReader {
  private pageLists = new Map<string, string[]>();
  private resized = new Map<string, Buffer>();

  constructor(private readonly zips: ZipCache, private readonly pdfs: PdfReader) {}

  async pages(src: ComicSource): Promise<string[]> {
    const key = `${src.path}|${src.mtimeMs}`;
    const hit = this.pageLists.get(key);
    if (hit) return hit;
    let names: string[];
    if (isPdf(src)) {
      const n = await this.pdfs.pageCount(src.path, src.mtimeMs);
      names = Array.from({ length: n }, (_, i) => `page-${String(i + 1).padStart(4, '0')}.jpg`);
    } else if (src.isFolder) names = (await readdir(src.path)).filter(isImg);
    else names = (await this.zips.get(src.path, src.mtimeMs)).entries.map((e) => e.name).filter(isComicPageName);
    if (!isPdf(src)) names.sort(naturalCompare);
    if (this.pageLists.size > 50) this.pageLists.clear();
    this.pageLists.set(key, names);
    return names;
  }

  async info(src: ComicSource): Promise<ComicInfo> {
    const names = await this.pages(src);
    return { pages: names.map((name, index) => ({ index, name })) };
  }

  async page(src: ComicSource, index: number, maxWidth = 0): Promise<{ data: Buffer; ext: string }> {
    const names = await this.pages(src);
    const name = names[index];
    if (!name) throw Object.assign(new Error('Page not found'), { code: 'ENOENT' });
    if (isPdf(src)) {
      const key = `${src.path}|${src.mtimeMs}|pdf|${index}|${maxWidth}`;
      let out = this.resized.get(key);
      if (!out) {
        out = await this.pdfs.render(src.path, src.mtimeMs, index, maxWidth);
        if (this.resized.size > 24) this.resized.delete(this.resized.keys().next().value!);
        this.resized.set(key, out);
      }
      return { data: out, ext: 'jpg' };
    }
    const ext = name.split('.').pop()!.toLowerCase();
    const data = src.isFolder ? await readFile(join(src.path, name)) : await (await this.zips.get(src.path, src.mtimeMs)).read(name);
    if (maxWidth > 0 && ext !== 'gif') {
      const key = `${src.path}|${index}|${maxWidth}`;
      const cached = this.resized.get(key);
      if (cached) return { data: cached, ext: 'jpg' };
      try {
        const meta = await sharp(data, { failOn: 'none' }).metadata();
        if ((meta.width ?? 0) > maxWidth * 1.1) {
          const out = await sharp(data, { failOn: 'none' }).rotate().resize({ width: maxWidth, withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
          if (this.resized.size > 24) this.resized.delete(this.resized.keys().next().value!);
          this.resized.set(key, out);
          return { data: out, ext: 'jpg' };
        }
      } catch { /* serve original */ }
    }
    return { data, ext };
  }
}
