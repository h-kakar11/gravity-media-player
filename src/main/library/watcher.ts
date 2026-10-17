import { dirname } from 'node:path';
import watcher, { type AsyncSubscription } from '@parcel/watcher';
import type { LibraryRoot } from '@shared/types';
import type { Indexer } from './indexer';
import { logger } from '../log';

const log = logger('watcher');

interface Watch {
  sub: AsyncSubscription;
  dirs: Set<string>;
  timer: NodeJS.Timeout | null;
}

/**
 * Event-driven change detection: the OS tells us when something changes (inotify, FSEvents,
 * ReadDirectoryChangesW), so an idle library causes zero disk activity. Events are debounced
 * so copying a season of episodes triggers one rescan after the copy settles, not hundreds.
 */
export class LibraryWatcher {
  private readonly watches = new Map<number, Watch>();
  /** Roots we couldn't watch (network drive, inotify limit) fall back to a periodic quick scan. */
  private readonly polling = new Map<number, NodeJS.Timeout>();

  constructor(private readonly indexer: Indexer, private readonly quietMs = 1500, private readonly pollMs = 15 * 60_000) {}

  async sync(roots: LibraryRoot[], enabled: boolean): Promise<void> {
    const want = new Map(roots.filter((r) => enabled && r.enabled && r.watch).map((r) => [r.id, r]));
    for (const id of [...this.watches.keys()]) if (!want.has(id)) await this.stop(id);
    for (const id of [...this.polling.keys()]) if (!want.has(id)) this.stopPolling(id);
    for (const r of want.values()) if (!this.watches.has(r.id) && !this.polling.has(r.id)) await this.start(r);
  }

  private async start(root: LibraryRoot): Promise<void> {
    try {
      const w: Watch = { dirs: new Set(), timer: null, sub: undefined as unknown as AsyncSubscription };
      w.sub = await watcher.subscribe(
        root.path,
        (err, events) => {
          if (err) { log.warn(`Watch error on ${root.path}:`, err.message); return; }
          for (const e of events) {
            // A file change dirties its folder; a folder change dirties itself and its parent.
            w.dirs.add(dirname(e.path));
            if (e.type !== 'update') w.dirs.add(e.path);
          }
          if (w.timer) clearTimeout(w.timer);
          w.timer = setTimeout(() => {
            const dirs = [...w.dirs];
            w.dirs.clear();
            w.timer = null;
            void this.indexer.scanDirs(root.id, dirs);
          }, this.quietMs);
        },
        { ignore: ['**/.*', '**/@eaDir/**', '**/$RECYCLE.BIN/**', '**/System Volume Information/**', '**/*.part', '**/*.partial', '**/*.crdownload', '**/*.tmp'] }
      );
      this.watches.set(root.id, w);
      log.info(`Watching ${root.path}`);
    } catch (err) {
      log.warn(`Cannot watch ${root.path} (${(err as Error).message}); falling back to periodic scans`);
      const t = setInterval(() => void this.indexer.scanRoot(root.id), this.pollMs);
      t.unref();
      this.polling.set(root.id, t);
    }
  }

  private async stop(id: number): Promise<void> {
    const w = this.watches.get(id);
    if (!w) return;
    if (w.timer) clearTimeout(w.timer);
    this.watches.delete(id);
    try { await w.sub.unsubscribe(); } catch { /* already gone */ }
  }

  private stopPolling(id: number): void {
    const t = this.polling.get(id);
    if (t) clearInterval(t);
    this.polling.delete(id);
  }

  async stopAll(): Promise<void> {
    for (const id of [...this.watches.keys()]) await this.stop(id);
    for (const id of [...this.polling.keys()]) this.stopPolling(id);
  }
}
