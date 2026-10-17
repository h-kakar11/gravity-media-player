import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { logger } from '../log';
import { runMigrations } from './migrations';

const log = logger('db');

export type SqlValue = string | number | bigint | null | Uint8Array;
export type Params = SqlValue[] | Record<string, SqlValue>;

/** Coerce JS values to something SQLite accepts (booleans, undefined). */
export function sv(v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v as SqlValue;
}

const SCHEMA_VERSION = 2;

/** v2: online metadata. `meta_match` is one row per show/movie/album; `locked` rows are never rewritten by auto-match. */
const V2 = `
CREATE TABLE meta_match (
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  provider TEXT NOT NULL,
  ext_id TEXT NOT NULL,
  title TEXT NOT NULL,
  year INTEGER,
  plot TEXT,
  genres TEXT,
  poster TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  matched_at INTEGER NOT NULL,
  PRIMARY KEY (kind, key)
);
CREATE TABLE meta_cache (
  key TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
`;

const SCHEMA = `
CREATE TABLE roots (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'auto',
  enabled INTEGER NOT NULL DEFAULT 1,
  watch INTEGER NOT NULL DEFAULT 1,
  adhoc INTEGER NOT NULL DEFAULT 0,
  last_scan_at INTEGER
);

CREATE TABLE dirs (
  path TEXT PRIMARY KEY,
  parent TEXT,
  root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
  mtime_ms REAL NOT NULL
);
CREATE INDEX dirs_parent ON dirs(parent);
CREATE INDEX dirs_root ON dirs(root_id);

CREATE TABLE media (
  id INTEGER PRIMARY KEY,
  root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
  path TEXT NOT NULL UNIQUE,
  dir TEXT NOT NULL,
  file_name TEXT NOT NULL,
  ext TEXT NOT NULL,
  kind TEXT NOT NULL,
  vclass TEXT,
  title TEXT NOT NULL,
  sort_title TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  mtime_ms REAL NOT NULL DEFAULT 0,
  ino TEXT,
  dev TEXT,
  added_at INTEGER NOT NULL,
  scanned_at INTEGER NOT NULL,
  duration REAL NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  fps REAL NOT NULL DEFAULT 0,
  bitrate INTEGER NOT NULL DEFAULT 0,
  container TEXT NOT NULL DEFAULT '',
  vcodec TEXT NOT NULL DEFAULT '',
  acodec TEXT NOT NULL DEFAULT '',
  channels INTEGER NOT NULL DEFAULT 0,
  sample_rate INTEGER NOT NULL DEFAULT 0,
  bit_depth INTEGER NOT NULL DEFAULT 0,
  hdr INTEGER NOT NULL DEFAULT 0,
  audio_tracks INTEGER NOT NULL DEFAULT 0,
  sub_tracks INTEGER NOT NULL DEFAULT 0,
  year INTEGER,
  genre TEXT,
  artist TEXT,
  album_artist TEXT,
  album TEXT,
  track_no INTEGER,
  disc_no INTEGER,
  series TEXT,
  season INTEGER,
  episode INTEGER,
  plot TEXT,
  pages INTEGER NOT NULL DEFAULT 0,
  art_key TEXT,
  art_src TEXT,
  replay_gain REAL,
  missing INTEGER NOT NULL DEFAULT 0,
  artist_key TEXT GENERATED ALWAYS AS (lower(COALESCE(NULLIF(album_artist,''), NULLIF(artist,''), ''))) VIRTUAL,
  album_key TEXT GENERATED ALWAYS AS (lower(COALESCE(NULLIF(album_artist,''), NULLIF(artist,''), '')) || char(1) || lower(COALESCE(album,''))) VIRTUAL,
  series_key TEXT GENERATED ALWAYS AS (lower(series)) VIRTUAL
);
CREATE INDEX media_dir ON media(dir);
CREATE INDEX media_kind_added ON media(kind, missing, added_at DESC);
CREATE INDEX media_root ON media(root_id);
CREATE INDEX media_album ON media(kind, album_key);
CREATE INDEX media_artist ON media(kind, artist_key);
CREATE INDEX media_series ON media(kind, series_key, season, episode);
CREATE INDEX media_inode ON media(ino, dev);
CREATE INDEX media_size_mtime ON media(size, mtime_ms);

CREATE TABLE probe (
  media_id INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  json TEXT NOT NULL
);

CREATE TABLE state (
  media_id INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  favorite INTEGER NOT NULL DEFAULT 0,
  rating INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  play_count INTEGER NOT NULL DEFAULT 0,
  last_played_at INTEGER,
  position REAL NOT NULL DEFAULT 0,
  progress REAL NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
  location TEXT,
  speed REAL,
  audio_index INTEGER,
  subtitle_id TEXT,
  subtitle_delay REAL
);
CREATE INDEX state_fav ON state(favorite) WHERE favorite = 1;
CREATE INDEX state_played ON state(last_played_at DESC) WHERE last_played_at IS NOT NULL;

CREATE TABLE history (
  id INTEGER PRIMARY KEY,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  watched_sec REAL NOT NULL,
  media_sec REAL NOT NULL,
  from_sec REAL NOT NULL DEFAULT 0,
  to_sec REAL NOT NULL DEFAULT 0,
  speed REAL NOT NULL DEFAULT 1
);
CREATE INDEX history_time ON history(started_at);
CREATE INDEX history_media ON history(media_id, started_at);

CREATE TABLE playlists (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE playlist_items (
  id INTEGER PRIMARY KEY,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  added_at INTEGER NOT NULL
);
CREATE INDEX playlist_items_pl ON playlist_items(playlist_id, position);

CREATE TABLE collection_state (
  type TEXT NOT NULL,
  key TEXT NOT NULL,
  favorite INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (type, key)
);

CREATE VIRTUAL TABLE media_fts USING fts5(
  title, artist, album, series, genre, file_name, plot,
  content='media', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2', prefix='2 3'
);
CREATE TRIGGER media_ai AFTER INSERT ON media BEGIN
  INSERT INTO media_fts(rowid, title, artist, album, series, genre, file_name, plot)
  VALUES (new.id, new.title, COALESCE(new.artist,'') || ' ' || COALESCE(new.album_artist,''), new.album, new.series, new.genre, new.file_name, new.plot);
END;
CREATE TRIGGER media_ad AFTER DELETE ON media BEGIN
  INSERT INTO media_fts(media_fts, rowid, title, artist, album, series, genre, file_name, plot)
  VALUES ('delete', old.id, old.title, COALESCE(old.artist,'') || ' ' || COALESCE(old.album_artist,''), old.album, old.series, old.genre, old.file_name, old.plot);
END;
CREATE TRIGGER media_au AFTER UPDATE OF title, artist, album_artist, album, series, genre, file_name, plot ON media BEGIN
  INSERT INTO media_fts(media_fts, rowid, title, artist, album, series, genre, file_name, plot)
  VALUES ('delete', old.id, old.title, COALESCE(old.artist,'') || ' ' || COALESCE(old.album_artist,''), old.album, old.series, old.genre, old.file_name, old.plot);
  INSERT INTO media_fts(rowid, title, artist, album, series, genre, file_name, plot)
  VALUES (new.id, new.title, COALESCE(new.artist,'') || ' ' || COALESCE(new.album_artist,''), new.album, new.series, new.genre, new.file_name, new.plot);
END;
`;

/** Thin wrapper over node:sqlite with a statement cache and transaction helper. */
export class Db {
  readonly raw: DatabaseSync;
  private stmts = new Map<string, StatementSync>();
  private depth = 0;
  isOpen = true;

  constructor(file: string) {
    this.raw = new DatabaseSync(file);
    // WAL + NORMAL sync: durable enough for a media library, and far fewer fsyncs (kind to HDDs).
    this.raw.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA temp_store = MEMORY;
      PRAGMA busy_timeout = 5000;
      PRAGMA cache_size = -65536;
      PRAGMA mmap_size = 268435456;
    `);
    try {
      this.migrate();
    } catch (err) {
      this.raw.close(); // don't leave the file locked when the schema is unusable
      throw err;
    }
  }

  private migrate(): void {
    this.migrateBaseline();
    runMigrations(this.raw);
  }

  /** The versioned part of the schema (v0 → v2). Everything after v2 is a named migration in `migrations.ts`. */
  private migrateBaseline(): void {
    const row = this.raw.prepare('PRAGMA user_version').get() as { user_version: number };
    if (row.user_version === SCHEMA_VERSION) return;
    if (row.user_version === 1) {
      this.raw.exec('BEGIN');
      try {
        this.raw.exec(V2);
        this.raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
        this.raw.exec('COMMIT');
      } catch (err) {
        this.raw.exec('ROLLBACK');
        throw err;
      }
      log.info('Upgraded library database to v2');
      return;
    }
    if (row.user_version === 0) {
      this.raw.exec('BEGIN');
      try {
        this.raw.exec(SCHEMA);
        this.raw.exec(V2);
        this.raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
        this.raw.exec('COMMIT');
      } catch (err) {
        this.raw.exec('ROLLBACK');
        throw err;
      }
      log.info('Created library database');
      return;
    }
    throw new Error(`Unsupported database version ${row.user_version}`);
  }

  private stmt(sql: string): StatementSync {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  run(sql: string, params: Params = []): { changes: number; lastId: number } {
    const r = Array.isArray(params) ? this.stmt(sql).run(...params) : this.stmt(sql).run(params);
    return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
  }

  get<T = Record<string, unknown>>(sql: string, params: Params = []): T | undefined {
    const r = Array.isArray(params) ? this.stmt(sql).get(...params) : this.stmt(sql).get(params);
    return r as T | undefined;
  }

  all<T = Record<string, unknown>>(sql: string, params: Params = []): T[] {
    const r = Array.isArray(params) ? this.stmt(sql).all(...params) : this.stmt(sql).all(params);
    return r as T[];
  }

  /** Run `fn` inside a transaction (nested calls join the outer transaction). */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.raw.exec('BEGIN IMMEDIATE');
    this.depth++;
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    } finally {
      this.depth--;
    }
  }

  checkpoint(): void {
    try { this.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.checkpoint();
    this.stmts.clear();
    this.raw.close();
  }
}
