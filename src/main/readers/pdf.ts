import { readFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';

/** Minimal slice of pdf.js we use; the library is loaded lazily because it is large and ESM-only. */
interface PdfPage {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvasContext: unknown; viewport: unknown }): { promise: Promise<void> };
  cleanup(): void;
}
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

const DEFAULT_WIDTH = 1600;
const MAX_WIDTH = 4000;

async function loadDoc(path: string): Promise<PdfDoc> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await readFile(path));
  return (await pdfjs.getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise) as unknown as PdfDoc;
}

/** Page count and on-demand page rendering for PDF manga. Open documents are cached and closed LRU. */
export class PdfReader {
  private docs = new Map<string, Promise<PdfDoc>>();

  private open(path: string, mtimeMs: number): Promise<PdfDoc> {
    const key = `${path}|${mtimeMs}`;
    let doc = this.docs.get(key);
    if (!doc) {
      if (this.docs.size >= 3) {
        const [oldKey, old] = this.docs.entries().next().value!;
        this.docs.delete(oldKey);
        old.then((d) => d.destroy()).catch(() => {});
      }
      doc = loadDoc(path);
      doc.catch(() => this.docs.delete(key));
      this.docs.set(key, doc);
    }
    return doc;
  }

  async pageCount(path: string, mtimeMs = 0): Promise<number> {
    return (await this.open(path, mtimeMs)).numPages;
  }

  /** Render a zero-based page to a JPEG `width` pixels wide (default 1600). */
  async render(path: string, mtimeMs: number, index: number, width = 0): Promise<Buffer> {
    const doc = await this.open(path, mtimeMs);
    if (index < 0 || index >= doc.numPages) throw Object.assign(new Error('Page not found'), { code: 'ENOENT' });
    const page = await doc.getPage(index + 1);
    try {
      const base = page.getViewport({ scale: 1 });
      const target = Math.min(MAX_WIDTH, width > 0 ? width : DEFAULT_WIDTH);
      const viewport = page.getViewport({ scale: target / base.width });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      return canvas.toBuffer('image/jpeg', 88);
    } finally {
      page.cleanup();
    }
  }

  close(): void {
    for (const d of this.docs.values()) d.then((x) => x.destroy()).catch(() => {});
    this.docs.clear();
  }
}
