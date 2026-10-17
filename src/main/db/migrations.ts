import type { DatabaseSync } from 'node:sqlite';
import { logger } from '../log';

const log = logger('db');

/**
 * A named, additive schema change applied on top of the v2 baseline in `database.ts`.
 *
 * Features that land independently cannot agree on a shared `user_version` number, so each one registers a
 * uniquely named migration here instead. Applied names are recorded in `schema_migrations`; a database that has seen
 * none, some or all of them (in any merge order) converges on the same schema.
 */
export interface Migration {
  /** Unique and permanent, e.g. `01-episode-metadata`. Never rename a migration that has shipped. */
  name: string;
  /** Must be idempotent (`CREATE TABLE IF NOT EXISTS …`) and may only create objects this migration owns. */
  sql: string;
}

/**
 * One slot per feature, separated by blank lines so that independent branches add their entry without textual
 * conflicts. Add `{ name, sql }` under your marker; do not reorder or edit another feature's entry.
 */
export const MIGRATIONS: readonly Migration[] = [
  // [01] episode metadata

  // [03] smart playlists

  // [04] watchlist and Up Next
  {
    name: '04-watchlist',
    sql: `
      CREATE TABLE IF NOT EXISTS watchlist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('movie','show')),
        media_id INTEGER REFERENCES media(id) ON DELETE CASCADE,
        series_key TEXT,
        title TEXT NOT NULL DEFAULT '',
        added_at INTEGER NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        CHECK ((kind = 'movie' AND media_id IS NOT NULL AND series_key IS NULL)
            OR (kind = 'show' AND series_key IS NOT NULL AND media_id IS NULL))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS watchlist_movie ON watchlist(media_id) WHERE media_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS watchlist_show ON watchlist(series_key) WHERE series_key IS NOT NULL;
      CREATE TABLE IF NOT EXISTS show_tracking (
        series_key TEXT PRIMARY KEY,
        seen_at INTEGER,
        hidden_at INTEGER
      ) WITHOUT ROWID;
      -- Shows already watched when this feature first appears start with nothing "new": without this, every
      -- episode scanned after the user's first play would badge on the first launch.
      INSERT OR IGNORE INTO show_tracking (series_key, seen_at)
        SELECT DISTINCT m.series_key, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
        FROM media m JOIN state s ON s.media_id = m.id
        WHERE m.kind = 'video' AND m.vclass = 'episode' AND m.series_key IS NOT NULL
          AND (s.last_played_at IS NOT NULL OR s.completed = 1 OR s.position > 10);
    `
  }
];

const NAME = /^[a-z0-9][a-z0-9-]*$/;

/** Apply every migration in `migrations` that this database has not recorded yet. Returns the names applied. */
export function runMigrations(raw: DatabaseSync, migrations: readonly Migration[] = MIGRATIONS, now: () => number = Date.now): string[] {
  const names = new Set<string>();
  for (const m of migrations) {
    if (!NAME.test(m.name)) throw new Error(`Invalid migration name "${m.name}"`);
    if (names.has(m.name)) throw new Error(`Duplicate migration "${m.name}"`);
    names.add(m.name);
  }

  raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const done = new Set((raw.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map((r) => r.name));

  const applied: string[] = [];
  for (const m of migrations) {
    if (done.has(m.name)) continue;
    raw.exec('BEGIN');
    try {
      raw.exec(m.sql);
      raw.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(m.name, now());
      raw.exec('COMMIT');
    } catch (err) {
      raw.exec('ROLLBACK');
      throw new Error(`Migration ${m.name} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    applied.push(m.name);
    log.info(`Applied migration ${m.name}`);
  }
  return applied;
}
