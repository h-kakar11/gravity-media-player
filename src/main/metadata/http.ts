import type { Db } from '../db/database';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const UA = 'Gravity/1.0 (+https://github.com/h-kakar11/gravity-media-player)';
const DAY = 86_400_000;
const RETRIES = 3;

/** A non-2xx answer. `status` lets callers treat "not found" as "no data" rather than as a failure. */
export class MetaHttpError extends Error {
  constructor(host: string, readonly status: number) {
    super(`${host} responded ${status}`);
  }
}

/**
 * Polite JSON client: one request at a time per host, a minimum gap between requests (MusicBrainz
 * allows 1/s), and responses cached in SQLite so repeat lookups never touch the network.
 */
export class MetaHttp {
  private last = new Map<string, number>();
  private chain = new Map<string, Promise<unknown>>();

  constructor(
    private readonly db: Db,
    private readonly fetchFn: FetchFn = (u, i) => fetch(u, i),
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
  ) {}

  async json<T>(url: string, opts: { init?: RequestInit; cacheKey?: string; ttlMs?: number; gapMs?: number } = {}): Promise<T> {
    const ck = opts.cacheKey ?? `${opts.init?.method ?? 'GET'} ${url}${typeof opts.init?.body === 'string' ? opts.init.body : ''}`;
    const hit = this.db.get<{ json: string; fetched_at: number }>('SELECT json, fetched_at FROM meta_cache WHERE key = ?', [ck]);
    const ttl = opts.ttlMs ?? 7 * DAY;
    if (hit && this.now() - Number(hit.fetched_at) < ttl) return JSON.parse(hit.json) as T;

    const host = new URL(url).host;
    const prev = this.chain.get(host) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(async () => {
      for (let attempt = 0; ; attempt++) {
        const wait = (this.last.get(host) ?? 0) + (opts.gapMs ?? 300) - this.now();
        if (wait > 0) await this.sleep(wait);
        this.last.set(host, this.now());
        const res = await this.fetchFn(url, { ...opts.init, headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.init?.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(15_000) });
        if (res.status === 429 && attempt < RETRIES) {
          // Rate limited: honour Retry-After (seconds), else back off 2s, 4s, 8s. The chain keeps other calls to this host waiting.
          const ra = Number(res.headers.get('retry-after'));
          await this.sleep(Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2000 * 2 ** attempt, 30_000));
          continue;
        }
        if (!res.ok) throw new MetaHttpError(host, res.status);
        return (await res.json()) as T;
      }
    });
    this.chain.set(host, run);
    const data = await run;
    this.db.run('INSERT OR REPLACE INTO meta_cache (key, json, fetched_at) VALUES (?, ?, ?)', [ck, JSON.stringify(data), this.now()]);
    return data;
  }
}
