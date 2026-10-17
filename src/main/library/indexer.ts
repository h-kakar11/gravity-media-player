import { EventEmitter } from 'node:events';
import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, sep } from 'node:path';
import { IMAGE_EXTS, MIN_TS_BYTES, extOf, kindOfExt } from '@shared/formats';
import { looksLikeComicPages } from '@shared/parse-name';
import type { MediaKind, LibraryChange, ScanProgress } from '@shared/types';
import type { SettingsStore } from '../settings-store';
import type { AppPaths } from '../paths';
import type { LibraryRepo } from '../db/repo';
import type { Ffmpeg } from '../media/ffmpeg';
import { Mutex, globToRegExp, pool, yieldToEventLoop } from '../util';
import { logger } from '../log';
import { extract, extractComicFolder, type ExtractContext, type FileInfo } from './extract';
import type { MediaFields } from './types';

const log = logger('indexer');

const SYSTEM_NAMES = new Set(['$recycle.bin', 'system volume information', '@eadir', '.spotlight-v100', '.trashes', '.fseventsd', 'lost+found']);
const ARTWORK_STEMS = /^(cover|folder|poster|front|thumb|albumart.*|fanart|backdrop|banner|landscape|clearart|logo|disc|cdart|movie|show|season.*-poster|.*-poster|.*-thumb|.*-fanart)$/i;

interface Ctx {
  root: { id: number; path: string; type: 'auto' | 'video' | 'music' | 'photos' | 'comics' | 'books' };
  quick: boolean;
  deep: boolean;
  knownDirs: Map<string, number>;
  ignore: RegExp[];
  ignoreHidden: boolean;
  followSymlinks: boolean;
  stats: { scanned: number; added: number; updated: number; removed: number; kinds: Set<MediaKind> };
  concurrency: number;
  lastProgress: number;
}

const bi = (v: bigint | number) => (typeof v === 'bigint' ? v.toString() : String(v));

/**
 * Walks library folders and keeps the database in sync with the file system.
 *
 * Designed to be gentle on spinning disks:
 *  - Directories are read in sorted order, one at a time, so reads stay sequential.
 *  - A "quick" scan stats only directories and descends into a directory's entries only if
 *    its modification time changed since the last scan; unchanged trees cost almost nothing.
 *  - Extraction concurrency is capped (1 in HDD mode).
 *  - Only one scan runs at a time across all roots.
 */
export class Indexer extends EventEmitter {
  private readonly mutex = new Mutex();
  readonly online = new Set<number>();
  readonly scanning = new Set<number>();
  private pending: LibraryChange = { added: 0, updated: 0, removed: 0, kinds: [] };
  private changeTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repo: LibraryRepo,
    private readonly settings: SettingsStore,
    private readonly ffmpeg: Ffmpeg,
    private readonly paths: AppPaths
  ) {
    super();
  }

  private concurrency(): number {
    const s = this.settings.get().library;
    if (s.scanConcurrency > 0) return s.scanConcurrency;
    return s.hddMode === 'on' ? 1 : s.hddMode === 'off' ? 6 : 3;
  }

  // -------------------------------------------------------------------------
  // Public API

  scanRoot(rootId: number, opts: { deep?: boolean } = {}): Promise<void> {
    return this.mutex.run(() => this.doScanRoot(rootId, opts));
  }

  /** Rescan specific directories (used by the file watcher). */
  scanDirs(rootId: number, dirs: string[]): Promise<void> {
    return this.mutex.run(() => this.doScanDirs(rootId, dirs));
  }

  async scanAll(opts: { deep?: boolean } = {}): Promise<void> {
    for (const r of this.repo.listRoots()) if (r.enabled) await this.scanRoot(r.id, opts);
  }

  /** Index individual files opened outside the library (drag & drop, "Open with…"). Returns media ids. */
  async ingestFiles(files: string[]): Promise<number[]> {
    return this.mutex.run(async () => {
      const ids: number[] = [];
      const roots = this.repo.listRoots();
      for (const file of files) {
        let st;
        try { st = await stat(file); } catch { continue; }
        if (!st.isFile()) continue;
        const ext = extOf(file);
        const kind = kindOfExt(ext);
        if (!kind) continue;
        const known = this.repo.getIdByPath(file);
        if (known != null) { ids.push(known); continue; }
        const root = roots.filter((r) => file.startsWith(r.path + sep)).sort((a, b) => b.path.length - a.path.length)[0];
        const rootId = root?.id ?? this.repo.adhocRootId();
        const dir = dirname(file);
        const siblings = await readdir(dir).catch(() => [] as string[]);
        const ctx = this.extractCtx({ id: rootId, path: root?.path ?? dir, type: root?.type ?? 'auto' }, siblings);
        const info: FileInfo = { path: file, dir, name: basename(file), ext, base: basename(file, extname(file)), size: st.size, mtimeMs: st.mtimeMs, ino: String(st.ino), dev: String(st.dev) };
        const fields = await extract(kind, info, ctx);
        const { id, created } = this.repo.upsertMedia(fields);
        ids.push(id);
        this.note(created ? { added: 1, updated: 0, removed: 0, kinds: [kind] } : { added: 0, updated: 1, removed: 0, kinds: [kind] });
      }
      return ids;
    });
  }

  // -------------------------------------------------------------------------

  private extractCtx(root: ExtractContext['root'], siblings: string[]): ExtractContext {
    return { root, settings: this.settings.get(), ffmpeg: this.ffmpeg, paths: this.paths, siblings };
  }

  private makeCtx(rootId: number, quick: boolean, deep: boolean): Ctx | null {
    const root = this.repo.getRoot(rootId);
    if (!root) return null;
    const s = this.settings.get().library;
    return {
      root: { id: root.id, path: root.path, type: root.type },
      quick,
      deep,
      knownDirs: this.repo.knownDirs(rootId),
      ignore: s.ignorePatterns.map(globToRegExp),
      ignoreHidden: s.ignoreHidden,
      followSymlinks: s.followSymlinks,
      stats: { scanned: 0, added: 0, updated: 0, removed: 0, kinds: new Set() },
      concurrency: this.concurrency(),
      lastProgress: 0
    };
  }

  /** The root folder is reachable and doesn't look like an empty, unmounted mount point. */
  private async checkOnline(rootId: number, path: string): Promise<boolean> {
    try {
      const st = await stat(path);
      if (!st.isDirectory()) return false;
      const entries = await readdir(path);
      if (entries.length === 0 && this.repo.getRoot(rootId)!.itemCount > 0) return false;
      return true;
    } catch {
      return false;
    }
  }

  private progress(rootId: number, ctx: Ctx, phase: ScanProgress['phase'], current = '', force = false): void {
    const now = Date.now();
    if (!force && now - ctx.lastProgress < 150) return;
    ctx.lastProgress = now;
    this.emit('progress', { rootId, phase, scanned: ctx.stats.scanned, total: 0, added: ctx.stats.added, updated: ctx.stats.updated, removed: ctx.stats.removed, current } satisfies ScanProgress);
  }

  private async doScanRoot(rootId: number, opts: { deep?: boolean }): Promise<void> {
    const settings = this.settings.get().library;
    const ctx = this.makeCtx(rootId, settings.quickScan && !opts.deep, !!opts.deep);
    if (!ctx) return;
    const online = await this.checkOnline(rootId, ctx.root.path);
    if (!online) {
      this.online.delete(rootId);
      log.warn(`Root offline, keeping library entries: ${ctx.root.path}`);
      this.emit('progress', { rootId, phase: 'offline', scanned: 0, total: 0, added: 0, updated: 0, removed: 0, current: ctx.root.path } satisfies ScanProgress);
      this.emit('roots');
      return;
    }
    this.online.add(rootId);
    this.scanning.add(rootId);
    this.emit('roots');
    const t0 = Date.now();
    try {
      await this.walk(ctx, [ctx.root.path]);
      this.repo.touchRootScan(rootId);
      this.purgeStale(rootId);
    } catch (err) {
      log.error(`Scan of ${ctx.root.path} failed`, err);
    } finally {
      this.scanning.delete(rootId);
      this.progress(rootId, ctx, 'done', '', true);
      this.emit('roots');
      this.note({ added: ctx.stats.added, updated: ctx.stats.updated, removed: ctx.stats.removed, kinds: [...ctx.stats.kinds] });
      log.info(`Scanned ${ctx.root.path}: ${ctx.stats.scanned} files, +${ctx.stats.added} ~${ctx.stats.updated} -${ctx.stats.removed} in ${Date.now() - t0} ms${ctx.quick ? ' (quick)' : ''}`);
    }
  }

  private async doScanDirs(rootId: number, dirs: string[]): Promise<void> {
    const ctx = this.makeCtx(rootId, false, true);
    if (!ctx) return;
    if (!(await this.checkOnline(rootId, ctx.root.path))) { this.online.delete(rootId); this.emit('roots'); return; }
    this.online.add(rootId);
    try {
      // Only the directories reported (not their subtrees) unless the directory is new.
      for (const d of [...new Set(dirs)].sort()) {
        if (!d.startsWith(ctx.root.path)) continue;
        await this.walk(ctx, [d], false);
      }
    } catch (err) {
      log.error('Directory rescan failed', err);
    } finally {
      this.note({ added: ctx.stats.added, updated: ctx.stats.updated, removed: ctx.stats.removed, kinds: [...ctx.stats.kinds] });
    }
  }

  /** Remove entries that have been missing for over 30 days from roots that are reachable. */
  private purgeStale(rootId: number): void {
    const cutoff = Date.now() - 30 * 86_400_000;
    this.repo.db.run('DELETE FROM media WHERE root_id = ? AND missing = 1 AND scanned_at < ?', [rootId, cutoff]);
  }

  // -------------------------------------------------------------------------

  private ignored(name: string, ctx: Ctx): boolean {
    if (SYSTEM_NAMES.has(name.toLowerCase())) return true;
    if (ctx.ignoreHidden && name.startsWith('.')) return true;
    return ctx.ignore.some((re) => re.test(name));
  }

  private async walk(ctx: Ctx, start: string[], recurse = true): Promise<void> {
    const stack = [...start].reverse();
    while (stack.length) {
      const dir = stack.pop()!;
      const children = await this.scanDir(dir, ctx);
      if (recurse || children.fresh) {
        // Reverse-sort so popping yields ascending order: sequential reads on rotational disks.
        const sorted = children.dirs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        for (let i = sorted.length - 1; i >= 0; i--) stack.push(sorted[i]!);
      }
      await yieldToEventLoop();
    }
  }

  private async scanDir(dir: string, ctx: Ctx): Promise<{ dirs: string[]; fresh: boolean }> {
    let dst;
    try {
      dst = await stat(dir, { bigint: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') this.handleVanishedDir(dir, ctx);
      else log.warn(`Cannot stat ${dir}:`, (err as Error).message);
      return { dirs: [], fresh: false };
    }
    const mtimeMs = Number(dst.mtimeNs / 1_000_000n) + Number(dst.mtimeNs % 1_000_000n) / 1e6;
    const known = ctx.knownDirs.get(dir);
    if (ctx.quick && !ctx.deep && known !== undefined && Math.abs(known - mtimeMs) < 1) {
      return { dirs: this.repo.childDirs(dir), fresh: false };
    }

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      log.warn(`Cannot read ${dir}:`, (err as Error).message);
      return { dirs: [], fresh: false };
    }

    const subdirs: string[] = [];
    const names: string[] = [];
    const candidates: { name: string; ext: string; kind: MediaKind }[] = [];
    for (const e of entries) {
      if (this.ignored(e.name, ctx)) continue;
      let isDir = e.isDirectory();
      let isFile = e.isFile();
      if (e.isSymbolicLink()) {
        try {
          const target = await stat(join(dir, e.name));
          isDir = target.isDirectory() && ctx.followSymlinks;
          isFile = target.isFile();
        } catch { continue; }
      }
      if (isDir) { subdirs.push(join(dir, e.name)); continue; }
      if (!isFile) continue;
      names.push(e.name);
      const ext = extOf(e.name);
      const kind = kindOfExt(ext);
      if (kind) candidates.push({ name: e.name, ext, kind });
    }

    const dirRows = this.repo.mediaInDir(dir);
    const byPath = new Map(dirRows.map((r) => [r.path, r]));
    const isFolderComic = (r: { kind: string; path: string }) => r.kind === 'comic' && !extOf(r.path) && dirname(r.path) === dir;

    // Decide what this directory contributes.
    const imageNames = candidates.filter((c) => c.kind === 'image').map((c) => c.name);
    const playable = candidates.filter((c) => c.kind !== 'image');
    const rootType = ctx.root.type;
    const comicFolder =
      imageNames.length > 0 &&
      playable.length === 0 &&
      subdirs.length === 0 &&
      (rootType === 'comics' || (rootType === 'auto' && dir !== ctx.root.path && looksLikeComicPages(imageNames)));

    const wanted = (c: { kind: MediaKind; name: string }): boolean => {
      switch (rootType) {
        case 'video': return c.kind === 'video';
        case 'music': return c.kind === 'audio';
        case 'photos': return c.kind === 'image';
        case 'comics': return c.kind === 'comic';
        case 'books': return c.kind === 'book';
        case 'auto':
        default:
          if (c.kind === 'image') {
            if (comicFolder) return false;
            // Pictures that sit beside media are artwork, not photos.
            if (playable.length > 0) return false;
            return !ARTWORK_STEMS.test(basename(c.name, extname(c.name)));
          }
          return true;
      }
    };

    const files: { info: FileInfo; kind: MediaKind; row?: (typeof dirRows)[number] }[] = [];
    const seen = new Set<string>();
    const wantedCandidates = comicFolder ? [] : candidates.filter(wanted);
    await pool(wantedCandidates, 8, async (c) => {
      const path = join(dir, c.name);
      let st;
      try { st = await stat(path, { bigint: true }); } catch { return; }
      if (c.ext === 'ts' && Number(st.size) < MIN_TS_BYTES) return; // TypeScript, not MPEG-TS
      seen.add(path);
      const size = Number(st.size);
      const fmtime = Number(st.mtimeNs / 1_000_000n) + Number(st.mtimeNs % 1_000_000n) / 1e6;
      const row = byPath.get(path);
      ctx.stats.scanned++;
      if (row && !row.missing && row.size === size && Math.abs(row.mtimeMs - fmtime) < 1) return; // unchanged
      files.push({
        kind: c.kind,
        row,
        info: { path, dir, name: c.name, ext: c.ext, base: basename(c.name, extname(c.name)), size, mtimeMs: fmtime, ino: bi(st.ino), dev: bi(st.dev) }
      });
    });

    // Rows whose files are gone (never folder-comics: those belong to the child directory).
    const vanished = dirRows.filter((r) => !r.missing && !isFolderComic(r) && !seen.has(r.path));
    const extractCtx = this.extractCtx(ctx.root, names);
    files.sort((a, b) => a.info.name.localeCompare(b.info.name, undefined, { numeric: true }));

    const results: { fields: MediaFields; relinkId?: number; kind: MediaKind }[] = [];
    await pool(files, ctx.concurrency, async (f) => {
      try {
        const relinkId = f.row ? undefined : await this.findMoved(f.info);
        const fields = await extract(f.kind, f.info, extractCtx);
        results.push({ fields, relinkId, kind: f.kind });
      } catch (err) {
        log.warn(`Extraction failed for ${f.info.path}:`, (err as Error).message);
      }
      this.progress(ctx.root.id, ctx, 'indexing', f.info.name);
    });

    if (comicFolder) {
      try {
        const sizes = await pool(imageNames, 8, async (n) => (await stat(join(dir, n))).size);
        const fields = await extractComicFolder(dir, imageNames, { mtimeMs, ino: bi(dst.ino), dev: bi(dst.dev) }, sizes.reduce((a, b) => a + b, 0), extractCtx);
        const existing = this.repo.getIdByPath(dir);
        results.push({ fields, relinkId: existing, kind: 'comic' });
        ctx.stats.scanned += imageNames.length;
      } catch (err) {
        log.warn(`Comic folder failed ${dir}:`, (err as Error).message);
      }
    }

    // Child directories that disappeared.
    const present = new Set(subdirs);
    const goneDirs = this.repo.childDirs(dir).filter((d) => !present.has(d));

    this.repo.db.tx(() => {
      for (const r of results) {
        const { created } = this.repo.upsertMedia(r.fields, r.relinkId);
        if (created) ctx.stats.added++;
        else ctx.stats.updated++;
        ctx.stats.kinds.add(r.kind);
      }
      if (vanished.length) {
        this.repo.markMissing(vanished.map((v) => v.id));
        ctx.stats.removed += vanished.length;
        for (const v of vanished) ctx.stats.kinds.add(v.kind);
      }
      for (const g of goneDirs) this.removeDirTree(g, ctx);
      this.repo.upsertDir(dir, dir === ctx.root.path ? null : dirname(dir), ctx.root.id, mtimeMs);
    });
    ctx.knownDirs.set(dir, mtimeMs);
    return { dirs: subdirs, fresh: known === undefined };
  }

  /** Detect a moved/renamed file so favourites and history follow it. */
  private async findMoved(info: FileInfo): Promise<number | undefined> {
    if (info.ino && info.ino !== '0') {
      const hit = this.repo.findByInode(info.ino, info.dev ?? '0', info.size);
      if (hit && hit.path !== info.path) {
        try {
          await stat(hit.path);
          return undefined; // old path still exists: a hard link or copy, not a move
        } catch {
          return hit.id;
        }
      }
    }
    return this.repo.findMissingTwin(info.size, info.mtimeMs)?.id;
  }

  private handleVanishedDir(dir: string, ctx: Ctx): void {
    this.repo.db.tx(() => this.removeDirTree(dir, ctx));
  }

  private removeDirTree(dir: string, ctx: Ctx): void {
    const lo = dir + sep;
    const hi = lo.slice(0, -1) + String.fromCharCode(lo.charCodeAt(lo.length - 1) + 1);
    const rows = this.repo.db.all<{ id: number }>('SELECT id FROM media WHERE (path = ? OR (path >= ? AND path < ?)) AND missing = 0 AND root_id = ?', [dir, lo, hi, ctx.root.id]);
    this.repo.markMissing(rows.map((r) => r.id));
    ctx.stats.removed += rows.length;
    this.repo.removeDirTree(dir);
  }

  // -------------------------------------------------------------------------
  // Change notifications are coalesced so a scan of 10k files produces a handful of UI refreshes.

  private note(c: LibraryChange): void {
    if (c.added + c.updated + c.removed === 0) return;
    this.pending.added += c.added;
    this.pending.updated += c.updated;
    this.pending.removed += c.removed;
    this.pending.kinds = [...new Set([...this.pending.kinds, ...c.kinds])];
    if (this.changeTimer) return;
    this.changeTimer = setTimeout(() => {
      const out = this.pending;
      this.pending = { added: 0, updated: 0, removed: 0, kinds: [] };
      this.changeTimer = null;
      this.emit('changed', out);
    }, 400);
  }

  flushChanges(): void {
    if (this.changeTimer) {
      clearTimeout(this.changeTimer);
      this.changeTimer = null;
      const out = this.pending;
      this.pending = { added: 0, updated: 0, removed: 0, kinds: [] };
      this.emit('changed', out);
    }
  }
}

export { IMAGE_EXTS };
