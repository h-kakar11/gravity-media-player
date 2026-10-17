import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { ComicReader } from '../../src/main/readers/comic';
import { PdfReader } from '../../src/main/readers/pdf';
import { ZipCache } from '../../src/main/readers/zip';
import { makeApp } from './helpers';

/** Hand-built PDF: each page is a solid-colour rectangle of the given width x height. */
function makePdf(colours: [number, number, number][], w = 300, h = 450): Buffer {
  const objs: string[] = [];
  const kids = colours.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${kids}] /Count ${colours.length} >>`);
  colours.forEach(([r, g, b], i) => {
    const stream = `${r} ${g} ${b} rg 0 0 ${w} ${h} re f`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents ${4 + i * 2} 0 R >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

let app: ReturnType<typeof makeApp>;
let file: string;

beforeAll(async () => {
  const lib = mkdtempSync(join(tmpdir(), 'gravity-pdf-'));
  mkdirSync(join(lib, 'Manga'));
  file = join(lib, 'Manga', 'Tiny Hero v02.pdf');
  writeFileSync(file, makePdf([[1, 0, 0], [0, 1, 0], [0, 0, 1]]));
  app = makeApp();
  const id = app.repo.addRoot(lib, 'PDF Library', 'auto');
  await app.indexer.scanRoot(id);
}, 60_000);

describe('PDF manga', () => {
  it('indexes a PDF as a comic with its page count and volume', () => {
    const item = app.repo.query({ kind: 'comic' }).items[0]!;
    expect(item).toMatchObject({ kind: 'comic', container: 'pdf', pages: 3, series: 'Tiny Hero', season: 2 });
  });

  it('renders pages through the comic reader at the requested width', async () => {
    const row = app.repo.getRow(app.repo.query({ kind: 'comic' }).items[0]!.id)!;
    const comics = new ComicReader(new ZipCache(), new PdfReader());
    const src = { path: String(row.path), isFolder: false, mtimeMs: Number(row.mtime_ms) };
    expect((await comics.info(src)).pages).toHaveLength(3);
    const page = await comics.page(src, 0, 600);
    expect(page.ext).toBe('jpg');
    const meta = await sharp(page.data).metadata();
    expect(meta.width).toBe(600);
    expect(meta.height).toBe(900);
    const { data } = await sharp(page.data).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]!).toBeGreaterThan(200); // page 1 is red
    expect(data[1]!).toBeLessThan(60);
    await expect(comics.page(src, 3)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('generates a cover thumbnail from the first page', async () => {
    const item = app.repo.query({ kind: 'comic' }).items[0]!;
    expect(await app.art.get(item.id, 'thumb')).toMatch(/\.jpg$/);
  });

  it('survives a corrupt PDF without breaking the scan', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gravity-badpdf-'));
    writeFileSync(join(dir, 'Broken v01.pdf'), 'not a pdf');
    const id = app.repo.addRoot(dir, 'Bad', 'auto');
    await app.indexer.scanRoot(id);
    expect(app.repo.query({ text: 'Broken' }).items[0]).toMatchObject({ kind: 'comic', pages: 0 });
  });
});
