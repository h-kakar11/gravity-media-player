import yauzl from 'yauzl';

export interface ZipEntryInfo {
  name: string;
  size: number;
  compressedSize: number;
  entry: yauzl.Entry;
}

/**
 * Random-access reader for ZIP-based formats (CBZ, EPUB). yauzl reads only the central
 * directory up front, so opening a multi-hundred-MB archive on a spinning disk costs one
 * seek near the end of the file; individual pages are then read on demand.
 */
export class ZipArchive {
  private constructor(
    readonly path: string,
    private readonly zip: yauzl.ZipFile,
    readonly entries: ZipEntryInfo[],
    private readonly byName: Map<string, ZipEntryInfo>
  ) {}

  static open(path: string): Promise<ZipArchive> {
    return new Promise((resolve, reject) => {
      yauzl.open(path, { lazyEntries: true, autoClose: false, decodeStrings: true }, (err, zip) => {
        if (err || !zip) return reject(err ?? new Error('Cannot open archive'));
        const entries: ZipEntryInfo[] = [];
        const byName = new Map<string, ZipEntryInfo>();
        zip.on('entry', (entry: yauzl.Entry) => {
          if (!entry.fileName.endsWith('/')) {
            const info = { name: entry.fileName, size: entry.uncompressedSize, compressedSize: entry.compressedSize, entry };
            entries.push(info);
            byName.set(entry.fileName, info);
          }
          zip.readEntry();
        });
        zip.on('end', () => resolve(new ZipArchive(path, zip, entries, byName)));
        zip.on('error', reject);
        zip.readEntry();
      });
    });
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  /** Case-insensitive, slash-tolerant lookup. */
  find(name: string): ZipEntryInfo | undefined {
    const direct = this.byName.get(name);
    if (direct) return direct;
    const n = name.replace(/\\/g, '/').toLowerCase();
    return this.entries.find((e) => e.name.toLowerCase() === n);
  }

  read(name: string, maxBytes = 512 * 1024 * 1024): Promise<Buffer> {
    const info = this.find(name);
    if (!info) return Promise.reject(Object.assign(new Error(`Entry not found: ${name}`), { code: 'ENOENT' }));
    if (info.size > maxBytes) return Promise.reject(new Error('Entry too large'));
    return new Promise((resolve, reject) => {
      this.zip.openReadStream(info.entry, (err, stream) => {
        if (err || !stream) return reject(err ?? new Error('Cannot read entry'));
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
      });
    });
  }

  close(): void {
    try { this.zip.close(); } catch { /* ignore */ }
  }
}

/** Keeps a few archives open so paging through a comic doesn't re-read the central directory. */
export class ZipCache {
  private readonly map = new Map<string, { archive: Promise<ZipArchive>; mtime: number; timer: NodeJS.Timeout }>();

  constructor(private readonly max = 4, private readonly idleMs = 60_000) {}

  async get(path: string, mtimeMs: number): Promise<ZipArchive> {
    const hit = this.map.get(path);
    if (hit && hit.mtime === mtimeMs) {
      clearTimeout(hit.timer);
      hit.timer = this.schedule(path);
      this.map.delete(path);
      this.map.set(path, hit); // refresh LRU order
      return hit.archive;
    }
    if (hit) this.evict(path);
    const archive = ZipArchive.open(path);
    archive.catch(() => this.map.delete(path));
    this.map.set(path, { archive, mtime: mtimeMs, timer: this.schedule(path) });
    while (this.map.size > this.max) this.evict(this.map.keys().next().value!);
    return archive;
  }

  private schedule(path: string): NodeJS.Timeout {
    const t = setTimeout(() => this.evict(path), this.idleMs);
    t.unref();
    return t;
  }

  private evict(path: string): void {
    const e = this.map.get(path);
    if (!e) return;
    clearTimeout(e.timer);
    this.map.delete(path);
    e.archive.then((a) => a.close()).catch(() => {});
  }

  clear(): void {
    for (const k of [...this.map.keys()]) this.evict(k);
  }
}
