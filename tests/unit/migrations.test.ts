import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Db } from '../../src/main/db/database';
import { MIGRATIONS, runMigrations, type Migration } from '../../src/main/db/migrations';

const tables = (raw: DatabaseSync) => (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
const version = (raw: DatabaseSync) => (raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

const A: Migration = { name: 'a-first', sql: 'CREATE TABLE IF NOT EXISTS mig_a (id INTEGER PRIMARY KEY, v TEXT);' };
const B: Migration = { name: 'b-second', sql: 'CREATE TABLE IF NOT EXISTS mig_b (id INTEGER PRIMARY KEY, v TEXT);' };

describe('database baseline', () => {
  let dir: string;
  let file: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'gravity-mig-')); file = join(dir, 'library.db'); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates a fresh database at v2 with the migration ledger', () => {
    const db = new Db(file);
    expect(version(db.raw)).toBe(2);
    expect(tables(db.raw)).toEqual(expect.arrayContaining(['roots', 'media', 'state', 'meta_match', 'meta_cache', 'schema_migrations']));
    db.close();
  });

  it('upgrades a v1 database in place and keeps its data', () => {
    let db = new Db(file);
    db.run("INSERT INTO roots (path, name) VALUES ('/lib', 'Lib')");
    db.raw.exec('DROP TABLE meta_match; DROP TABLE meta_cache; DROP TABLE schema_migrations; PRAGMA user_version = 1;');
    db.close();

    db = new Db(file);
    expect(version(db.raw)).toBe(2);
    expect(tables(db.raw)).toEqual(expect.arrayContaining(['meta_match', 'meta_cache', 'schema_migrations']));
    expect(db.get<{ name: string }>('SELECT name FROM roots')?.name).toBe('Lib');
    db.close();
  });

  it('opens an existing v2 database (pre-registry, no ledger) without touching its data', () => {
    let db = new Db(file);
    db.run("INSERT INTO roots (path, name) VALUES ('/lib', 'Lib')");
    db.run("INSERT INTO meta_match (kind, key, provider, ext_id, title, locked, matched_at) VALUES ('series', 'x', 'tmdb', '1', 'X', 1, 5)");
    db.raw.exec('DROP TABLE schema_migrations');
    db.close();

    db = new Db(file);
    expect(version(db.raw)).toBe(2);
    expect(db.get<{ title: string; locked: number }>('SELECT title, locked FROM meta_match')).toMatchObject({ title: 'X', locked: 1 });
    expect(db.all('SELECT * FROM roots')).toHaveLength(1);
    db.close();
  });

  it('rejects a database from a newer schema instead of guessing', () => {
    const db = new Db(file);
    db.raw.exec('PRAGMA user_version = 99');
    db.close();
    expect(() => new Db(file)).toThrow(/Unsupported database version 99/);
  });

  it('registers every shipped migration exactly once', () => {
    const names = MIGRATIONS.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
    const db = new Db(file);
    const recorded = db.all<{ name: string }>('SELECT name FROM schema_migrations').map((r) => r.name).sort();
    expect(recorded).toEqual([...names].sort());
    db.close();
  });
});

describe('runMigrations', () => {
  const open = () => new DatabaseSync(':memory:');

  it('applies migrations in order, records them, and is a no-op the second time', () => {
    const raw = open();
    expect(runMigrations(raw, [A, B], () => 1234)).toEqual(['a-first', 'b-second']);
    expect(tables(raw)).toEqual(expect.arrayContaining(['mig_a', 'mig_b']));
    expect(raw.prepare('SELECT name, applied_at FROM schema_migrations ORDER BY applied_at, name').all()).toEqual([
      { name: 'a-first', applied_at: 1234 },
      { name: 'b-second', applied_at: 1234 }
    ]);
    expect(runMigrations(raw, [A, B])).toEqual([]);
    raw.close();
  });

  it('converges on the same schema whatever order independent branches register migrations in', () => {
    const one = open();
    const two = open();
    runMigrations(one, [A, B]);
    runMigrations(two, [B, A]);
    expect(tables(one).sort()).toEqual(tables(two).sort());
    one.close();
    two.close();
  });

  it('applies only the migrations a database has not seen (a later release adds one)', () => {
    const raw = open();
    runMigrations(raw, [A]);
    raw.exec("INSERT INTO mig_a (v) VALUES ('keep')");
    expect(runMigrations(raw, [A, B])).toEqual(['b-second']);
    expect((raw.prepare('SELECT v FROM mig_a').get() as { v: string }).v).toBe('keep');
    raw.close();
  });

  it('rolls a failing migration back completely and does not record it', () => {
    const raw = open();
    const bad: Migration = { name: 'c-bad', sql: 'CREATE TABLE IF NOT EXISTS mig_c (id INTEGER); INSERT INTO no_such_table VALUES (1);' };
    expect(() => runMigrations(raw, [A, bad, B])).toThrow(/Migration c-bad failed/);
    expect(tables(raw)).toContain('mig_a');
    expect(tables(raw)).not.toContain('mig_c');
    expect(tables(raw)).not.toContain('mig_b');
    expect((raw.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map((r) => r.name)).toEqual(['a-first']);
    // A fixed release picks up where the failed one stopped.
    expect(runMigrations(raw, [A, { name: 'c-bad', sql: bad.sql.split(';')[0]! + ';' }, B])).toEqual(['c-bad', 'b-second']);
    raw.close();
  });

  it('adopts a table that already exists rather than failing (idempotent SQL)', () => {
    const raw = open();
    raw.exec('CREATE TABLE mig_a (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO mig_a (v) VALUES (\'old\');');
    expect(runMigrations(raw, [A])).toEqual(['a-first']);
    expect((raw.prepare('SELECT v FROM mig_a').get() as { v: string }).v).toBe('old');
    raw.close();
  });

  it('ignores ledger entries from a newer build', () => {
    const raw = open();
    runMigrations(raw, [A]);
    raw.exec("INSERT INTO schema_migrations (name, applied_at) VALUES ('99-from-the-future', 1)");
    expect(runMigrations(raw, [A])).toEqual([]);
    raw.close();
  });

  it('refuses duplicate and malformed names before touching the database', () => {
    const raw = open();
    expect(() => runMigrations(raw, [A, A])).toThrow(/Duplicate migration "a-first"/);
    expect(() => runMigrations(raw, [{ name: 'Bad Name', sql: '' }])).toThrow(/Invalid migration name/);
    expect(tables(raw)).not.toContain('mig_a');
    raw.close();
  });
});
