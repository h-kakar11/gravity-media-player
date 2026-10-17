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
  {
    name: '01-episode-metadata',
    // One row per episode of a matched show. series_key is media.series_key / meta_match.key (lower-cased series name);
    // provider + ext_id say which match the row came from, so rows from a replaced match can be told apart and dropped.
    sql: `
      CREATE TABLE IF NOT EXISTS meta_episode (
        series_key TEXT NOT NULL,
        season INTEGER NOT NULL,
        episode INTEGER NOT NULL,
        provider TEXT NOT NULL,
        ext_id TEXT NOT NULL,
        title TEXT,
        plot TEXT,
        air_date TEXT,
        fetched_at INTEGER NOT NULL,
        PRIMARY KEY (series_key, season, episode)
      ) WITHOUT ROWID;
    `
  },

  // [03] smart playlists
  {
    name: '03-smart-playlists',
    sql: `
      CREATE TABLE IF NOT EXISTS smart_playlists (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        definition TEXT NOT NULL CHECK (json_valid(definition)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `
  },

  // [04] watchlist and Up Next
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
