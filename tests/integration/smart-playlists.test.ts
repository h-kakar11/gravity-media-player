import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { emptyDefinition, type SmartDefinition } from '@shared/smart';
import { Db } from '../../src/main/db/database';
import { emptyFields } from '../../src/main/library/types';
import { SmartPlaylistService } from '../../src/main/smart/service';
import { SmartRuleError } from '../../src/main/smart/rules';
import { makeApp } from './helpers';

type App = ReturnType<typeof makeApp>;
let app: App;
let rootId: number;
let seq = 0;
let clock = 10 * 86_400_000;
let svc: SmartPlaylistService;
const DAY = 86_400_000;

interface Opts { kind?: 'video' | 'audio' | 'image'; genre?: string | null; year?: number | null; artist?: string | null; albumArtist?: string | null; addedDaysAgo?: number; fav?: boolean; rating?: number; plays?: number; missing?: boolean }

function add(title: string, o: Opts = {}): number {
  const n = ++seq;
  const kind = o.kind ?? 'audio';
  const name = `${title.replace(/[^\w ]/g, '')}-${n}.${kind === 'audio' ? 'mp3' : 'mkv'}`;
  const f = emptyFields({ rootId, path: join('/lib', name), dir: '/lib', fileName: name, ext: kind === 'audio' ? 'mp3' : 'mkv', kind, title, size: 100 + n, mtimeMs: 1 });
  f.genre = o.genre ?? null;
  f.year = o.year ?? null;
  f.artist = o.artist ?? null;
  f.albumArtist = o.albumArtist ?? null;
  f.durationSec = 60;
  f.ino = String(n);
  f.dev = '1';
  const id = app.repo.upsertMedia(f).id;
  app.db.run('UPDATE media SET added_at = ?, missing = ? WHERE id = ?', [clock - (o.addedDaysAgo ?? 100) * DAY, o.missing ? 1 : 0, id]);
  if (o.fav || o.rating || o.plays) {
    app.db.run('INSERT INTO state (media_id, favorite, rating, play_count, last_played_at, completed) VALUES (?, ?, ?, ?, ?, ?)', [id, o.fav ? 1 : 0, o.rating ?? 0, o.plays ?? 0, o.plays ? clock - DAY : null, o.plays ? 1 : 0]);
  }
  return id;
}

const def = (items: unknown[], match: 'all' | 'any' = 'all', extra: Partial<SmartDefinition> = {}): SmartDefinition => ({ ...emptyDefinition(), root: { match, items } as SmartDefinition['root'], ...extra });
const titles = (d: SmartDefinition) => svc.preview(d, 50).items.map((i) => i.title);
const sorted = (d: SmartDefinition) => titles(d).sort();

beforeEach(() => {
  app = makeApp();
  rootId = app.repo.addRoot('/lib', 'lib', 'mixed');
  svc = new SmartPlaylistService(app.db, () => clock);
});
afterEach(() => app.db.close());

describe('rules against a real database', () => {
  beforeEach(() => {
    add('Rock Old', { genre: 'Rock', year: 1975, artist: 'The Band', rating: 5, fav: true, plays: 3, addedDaysAgo: 400 });
    add('Rock New', { genre: 'Rock', year: 2021, artist: 'The Band', rating: 3, addedDaysAgo: 2 });
    add('Pop Hit', { genre: 'Pop', year: 1999, artist: 'Star', albumArtist: 'Various', addedDaysAgo: 5, plays: 1 });
    add('Multi', { genre: 'Rock; Indie', year: 2010, artist: 'Duo', rating: 4, addedDaysAgo: 50 });
    add('No Meta', {});
    add('Movie', { kind: 'video', genre: 'Rock', year: 1999, addedDaysAgo: 1 });
    add('Gone', { genre: 'Rock', year: 1999, missing: true });
    add('Photo', { kind: 'image', genre: 'Rock' });
  });

  it('matches genre exactly, as a list token, and as a substring (case-insensitive)', () => {
    expect(sorted(def([{ field: 'genre', op: 'is', value: 'rock' }]))).toEqual(['Movie', 'Multi', 'Rock New', 'Rock Old']);
    expect(sorted(def([{ field: 'genre', op: 'is', value: 'indie' }]))).toEqual(['Multi']);
    expect(sorted(def([{ field: 'genre', op: 'contains', value: 'ndi' }]))).toEqual(['Multi']);
    expect(sorted(def([{ field: 'genre', op: 'isNot', value: 'Rock' }]))).toEqual(['No Meta', 'Pop Hit']);
  });

  it('never returns missing files or non-playable kinds', () => {
    expect(titles(def([{ field: 'genre', op: 'contains', value: 'rock' }]))).not.toEqual(expect.arrayContaining(['Gone', 'Photo']));
  });

  it('handles year ranges and treats unknown years as non-matching', () => {
    expect(sorted(def([{ field: 'year', op: 'between', value: 1990, value2: 2010 }]))).toEqual(['Movie', 'Multi', 'Pop Hit']);
    expect(sorted(def([{ field: 'year', op: 'lt', value: 1980 }]))).toEqual(['Rock Old']);
    expect(sorted(def([{ field: 'year', op: 'gte', value: 2021 }]))).toEqual(['Rock New']);
    expect(titles(def([{ field: 'year', op: 'lte', value: 3000 }]))).not.toContain('No Meta');
  });

  it('handles ratings, with unrated counted as 0', () => {
    expect(sorted(def([{ field: 'rating', op: 'gte', value: 4 }]))).toEqual(['Multi', 'Rock Old']);
    expect(sorted(def([{ field: 'rating', op: 'eq', value: 0 }]))).toEqual(['Movie', 'No Meta', 'Pop Hit']);
  });

  it('handles unplayed, favourites and artist (artist or album artist)', () => {
    expect(sorted(def([{ field: 'unplayed', value: true }]))).toEqual(['Movie', 'Multi', 'No Meta', 'Rock New']);
    expect(sorted(def([{ field: 'unplayed', value: false }]))).toEqual(['Pop Hit', 'Rock Old']);
    expect(sorted(def([{ field: 'favorite', value: true }]))).toEqual(['Rock Old']);
    expect(sorted(def([{ field: 'favorite', value: false }]))).toHaveLength(5);
    expect(sorted(def([{ field: 'artist', op: 'is', value: 'the band' }]))).toEqual(['Rock New', 'Rock Old']);
    expect(sorted(def([{ field: 'artist', op: 'is', value: 'various' }]))).toEqual(['Pop Hit']);
    expect(sorted(def([{ field: 'artist', op: 'contains', value: 'du' }]))).toEqual(['Multi']);
    expect(sorted(def([{ field: 'artist', op: 'isNot', value: 'The Band' }]))).toEqual(['Movie', 'Multi', 'No Meta', 'Pop Hit']);
  });

  it('handles recently added relative to the clock', () => {
    expect(sorted(def([{ field: 'addedWithin', days: 7 }]))).toEqual(['Movie', 'Pop Hit', 'Rock New']);
    clock += 30 * DAY;
    expect(titles(def([{ field: 'addedWithin', days: 7 }]))).toEqual([]);
  });

  it('combines AND, OR and nested groups', () => {
    expect(sorted(def([{ field: 'genre', op: 'is', value: 'Rock' }, { field: 'unplayed', value: true }]))).toEqual(['Movie', 'Multi', 'Rock New']);
    expect(sorted(def([{ field: 'favorite', value: true }, { field: 'addedWithin', days: 3 }], 'any'))).toEqual(['Movie', 'Rock New', 'Rock Old']);
    const nested = def([
      { field: 'genre', op: 'is', value: 'Rock' },
      { match: 'any', items: [{ field: 'year', op: 'lt', value: 1980 }, { match: 'all', items: [{ field: 'rating', op: 'gte', value: 4 }, { field: 'unplayed', value: true }] }] }
    ]);
    expect(sorted(nested)).toEqual(['Multi', 'Rock Old']);
    // an empty nested OR group contributes nothing instead of matching everything
    expect(sorted(def([{ field: 'favorite', value: true }, { match: 'any', items: [] }]))).toEqual([]);
    expect(sorted(def([{ field: 'favorite', value: true }, { match: 'all', items: [] }]))).toEqual(['Rock Old']);
  });

  it('sorts, limits and counts the limited set', () => {
    const d = def([{ field: 'genre', op: 'is', value: 'Rock' }], 'all', { sort: 'year', desc: true, limit: 2 });
    expect(titles(d)).toEqual(['Rock New', 'Multi']);
    const p = svc.preview(d);
    expect(p.count).toBe(2);
    expect(p.durationSec).toBe(120);
    expect(titles(def([{ field: 'genre', op: 'is', value: 'Rock' }], 'all', { sort: 'rating', desc: true }))[0]).toBe('Rock Old');
    expect(titles(def([{ field: 'genre', op: 'is', value: 'Rock' }], 'all', { sort: 'random' }))).toHaveLength(4);
  });
});

describe('storage and lifecycle', () => {
  it('creates, lists, updates and deletes; membership follows the library live', () => {
    const a = add('Alpha', { genre: 'Jazz' });
    const pl = svc.create('  Jazz  ', def([{ field: 'genre', op: 'is', value: 'Jazz' }]));
    expect(pl).toMatchObject({ name: 'Jazz', itemCount: 1, error: null });
    expect(svc.items(pl.id).map((e) => e.item.id)).toEqual([a]);

    const b = add('Beta', { genre: 'Jazz' });
    expect(svc.get(pl.id).itemCount).toBe(2);
    expect(svc.items(pl.id).map((e) => e.item.id)).toEqual([a, b]);
    expect(svc.items(pl.id).map((e) => e.entryId)).toEqual([a, b]);

    app.db.run('UPDATE state SET favorite = 1 WHERE media_id = ?', [b]); // no row yet → no-op
    app.db.run('INSERT INTO state (media_id, favorite) VALUES (?, 1)', [b]);
    const upd = svc.update(pl.id, { name: 'Fav Jazz', definition: def([{ field: 'genre', op: 'is', value: 'Jazz' }, { field: 'favorite', value: true }]) });
    expect(upd.name).toBe('Fav Jazz');
    expect(svc.items(pl.id).map((e) => e.item.id)).toEqual([b]);

    svc.delete(pl.id);
    expect(svc.list()).toEqual([]);
    expect(() => svc.items(pl.id)).toThrow(SmartRuleError);
    expect(app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM media')!.n).toBe(2); // media untouched
  });

  it('lists by name and survives a media file being removed from the library', () => {
    const x = add('X', { genre: 'Zed' });
    svc.create('b list', def([{ field: 'genre', op: 'is', value: 'Zed' }]));
    svc.create('A list', def([{ field: 'genre', op: 'is', value: 'Zed' }]));
    expect(svc.list().map((p) => p.name)).toEqual(['A list', 'b list']);
    app.db.run('DELETE FROM media WHERE id = ?', [x]);
    expect(svc.list().map((p) => p.itemCount)).toEqual([0, 0]);
  });

  it('rejects bad names and bad rules without writing', () => {
    expect(() => svc.create('   ', def([{ field: 'favorite', value: true }]))).toThrow(/name/);
    expect(() => svc.create('x'.repeat(500), def([{ field: 'favorite', value: true }]))).toThrow(/too long/);
    expect(() => svc.create('ok', def([]))).toThrow(/at least one rule/);
    expect(() => svc.create('ok', { nope: true })).toThrow(SmartRuleError);
    expect(svc.list()).toEqual([]);
    const pl = svc.create('ok', def([{ field: 'favorite', value: true }]));
    expect(() => svc.update(pl.id, { definition: def([{ field: 'year', op: 'eq', value: 'x' }]) })).toThrow(SmartRuleError);
    expect(svc.get(pl.id).definition.root.items).toHaveLength(1);
    expect(() => svc.update(9999, { name: 'x' })).toThrow(/no longer exists/);
  });

  it('shows an unreadable stored definition as an empty playlist with an error, not a crash', () => {
    add('Alpha', { genre: 'Jazz' });
    const good = svc.create('good', def([{ field: 'genre', op: 'is', value: 'Jazz' }]));
    const bad = app.db.run('INSERT INTO smart_playlists (name, definition, created_at, updated_at) VALUES (?, ?, 1, 1)', ['bad', '{"root":{"match":"all","items":[{"field":"path","op":"is","value":"x"}]}}']).lastId;
    const notJson = app.db.run("INSERT INTO smart_playlists (name, definition, created_at, updated_at) VALUES ('worse', '\"str\"', 1, 1)").lastId;
    const list = svc.list();
    expect(list.find((p) => p.id === good.id)!.itemCount).toBe(1);
    expect(list.find((p) => p.id === bad)).toMatchObject({ itemCount: 0, error: expect.stringContaining('Unknown rule') });
    expect(list.find((p) => p.id === notJson)!.error).toBeTruthy();
    expect(svc.items(bad)).toEqual([]);
  });

  it('refuses non-JSON in the database itself', () => {
    expect(() => app.db.run("INSERT INTO smart_playlists (name, definition, created_at, updated_at) VALUES ('n', 'not json', 1, 1)")).toThrow();
  });

  it('keeps the table across a reopen of the database file', () => {
    const file = join(app.base, 'persist.db');
    const db1 = new Db(file);
    db1.run("INSERT INTO smart_playlists (name, definition, created_at, updated_at) VALUES ('p', '{}', 1, 1)");
    db1.close();
    const db2 = new Db(file);
    expect(db2.get<{ n: number }>('SELECT COUNT(*) AS n FROM smart_playlists')!.n).toBe(1);
    expect(db2.get("SELECT name FROM schema_migrations WHERE name = '03-smart-playlists'")).toBeTruthy();
    db2.close();
  });
});

describe('SQL injection resistance', () => {
  const hostile = ["'; DROP TABLE media; --", '" OR 1=1 --', "%' OR '1'='1", 'Robert\'); DELETE FROM state;--', '\\', '%', '_', '\0', 'x\u0000y'];

  it.each(hostile)('treats %j as plain text in every text rule', (value) => {
    add('Real', { genre: 'Rock', artist: 'Someone' });
    for (const field of ['genre', 'artist'] as const) {
      for (const op of ['is', 'isNot', 'contains'] as const) {
        const d = def([{ field, op, value }]);
        const names = titles(d);
        // wildcard characters are literal: nothing matches the hostile value, so "isNot" returns the whole library
        expect(names).toEqual(op === 'isNot' ? ['Real'] : []);
      }
    }
    expect(app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM media')!.n).toBe(1);
    expect(app.db.get("SELECT name FROM sqlite_master WHERE name = 'state'")).toBeTruthy();
  });

  it('rejects hostile field, operator and sort names before they can reach SQL', () => {
    const rule = (patch: Record<string, unknown>) => def([{ field: 'genre', op: 'is', value: 'x', ...patch }]);
    for (const bad of [
      rule({ field: 'genre) OR 1=1 --' }), rule({ field: 'm.path' }), rule({ op: 'is OR 1=1' }), rule({ op: '; DROP TABLE media' }),
      { ...rule({}), sort: 'title; DROP TABLE media' }, { ...rule({}), limit: '1; DROP TABLE media' }
    ]) {
      expect(() => svc.create('evil', bad as SmartDefinition)).toThrow(SmartRuleError);
      expect(() => svc.preview(bad as SmartDefinition)).toThrow(SmartRuleError);
    }
    expect(app.db.get("SELECT name FROM sqlite_master WHERE name = 'media'")).toBeTruthy();
  });

  it('stores hostile playlist names and descriptions verbatim without executing them', () => {
    const pl = svc.create("'); DROP TABLE smart_playlists; --", def([{ field: 'favorite', value: true }]), "'); DELETE FROM media; --");
    expect(svc.get(pl.id).name).toBe("'); DROP TABLE smart_playlists; --");
    expect(svc.list()).toHaveLength(1);
  });

  it('does not let a stored definition smuggle extra keys into queries', () => {
    add('Real', { genre: 'Rock' });
    const sneaky = { ...def([{ field: 'genre', op: 'is', value: 'Rock', where: '1=1; DROP TABLE media' }]), orderBy: 'id; DROP TABLE media', sql: 'DROP TABLE media' };
    const pl = svc.create('sneaky', sneaky as SmartDefinition);
    expect(JSON.stringify(svc.get(pl.id).definition)).not.toContain('DROP');
    expect(svc.items(pl.id)).toHaveLength(1);
  });
});
