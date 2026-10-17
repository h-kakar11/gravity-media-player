/** Small async helpers. */

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function yieldToEventLoop(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

/** Serialises async tasks (one at a time, FIFO). */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.tail.then(fn, fn);
    this.tail = p.catch(() => {});
    return p;
  }
}

/** Trailing debounce that collects values until quiet for `ms`. */
export function collectDebounced<T>(ms: number, flush: (items: T[]) => void): (item: T) => void {
  let buf: T[] = [];
  let timer: NodeJS.Timeout | null = null;
  return (item) => {
    buf.push(item);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const items = buf;
      buf = [];
      timer = null;
      flush(items);
    }, ms);
  };
}

/** Simple glob → RegExp ("*" and "?" only), case-insensitive, anchored. */
export function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`, 'i');
}
