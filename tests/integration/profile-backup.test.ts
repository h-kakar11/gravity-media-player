import { describe, expect, it } from 'vitest';
import { PROFILE_FORMAT, PROFILE_VERSION, type ProfileFile } from '../../src/shared/backup';
import { exportProfile, parseProfile, ProfileError, relativeTo, safePoster } from '../../src/main/backup/profile';
import { runImport } from '../../src/main/backup/import';
import { emptyFields } from '../../src/main/library/types';
import { makeApp } from './helpers';

type App = ReturnType<typeof makeApp>;

/** A library at `root` with the given [relative path, size] files, all videos. */
function library(root: string, files: [string, number][], name = 'Movies') {
  const app = makeApp();
  const rootId = app.repo.addRoot(root, name, 'mixed');
  const ids: number[] = [];
  for (const [rel, size] of files) {
    const path = `${root}/${rel}`;
    const fileName = rel.split('/').pop()!;
    const dir = path.slice(0, path.length - fileName.length - 1);
    ids.push(app.repo.upsertMedia(emptyFields({ rootId, path, dir, fileName, ext: '.mkv', kind: 'video', title: fileName.replace(/\.mkv$/, ''), size, mtimeMs: 1 })).id);
  }
  return { app, rootId, ids };
}

function seed(app: App, ids: number[]) {
  const [a, b] = ids;
  app.db.run('INSERT INTO state (media_id, favorite, rating, notes, play_count, last_played_at, position, progress, completed) VALUES (?, 1, 4, ?, 3, 5000, 120, 0.4, 0)', [a!, 'great']);
  app.db.run('INSERT INTO state (media_id, rating, completed, completed_at, play_count, last_played_at) VALUES (?, 2, 1, 900, 1, 900)', [b!]);
  app.db.run('INSERT INTO history (media_id, kind, started_at, watched_sec, media_sec) VALUES (?, ?, ?, 60, 100)', [a!, 'video', 1000]);
  app.db.run('INSERT INTO history (media_id, kind, started_at, watched_sec, media_sec) VALUES (?, ?, ?, 30, 100)', [a!, 'video', 2000]);
  const pl = app.db.run("INSERT INTO playlists (name, description, created_at, updated_at) VALUES ('Faves', 'd', 1, 1)").lastId;
  app.db.run('INSERT INTO playlist_items (playlist_id, media_id, position, added_at) VALUES (?, ?, 0, 1)', [pl, b!]);
  app.db.run('INSERT INTO playlist_items (playlist_id, media_id, position, added_at) VALUES (?, ?, 1, 1)', [pl, a!]);
  app.db.run("INSERT INTO collection_state (type, key, favorite) VALUES ('series', 'show one', 1), ('folder', '/abs/folder', 1)");
  app.db.run(
    `INSERT INTO meta_match (kind, key, provider, ext_id, title, year, plot, genres, poster, locked, matched_at)
     VALUES ('movie', ?, 'tmdb', '42', 'Alpha', 1999, 'plot', '["Drama"]', 'https://img.example/p.jpg?api_key=SECRET123', 1, 77)`, [String(a!)]
  );
}

const FILES: [string, number][] = [['Action/alpha.mkv', 1000], ['Action/beta.mkv', 2000], ['gamma.mkv', 3000]];
const roundtrip = (f: ProfileFile) => parseProfile(JSON.parse(JSON.stringify(f)));

describe('export', () => {
  it('captures user data keyed by relative path and size, with no absolute paths', () => {
    const { app, ids } = library('/lib/movies', FILES);
    seed(app, ids);
    const p = exportProfile(app.db, '1.2.3', 123);
    expect(p).toMatchObject({ format: PROFILE_FORMAT, version: PROFILE_VERSION, exportedAt: 123, appVersion: '1.2.3' });
    expect(p.media.map((m) => m.rel)).toEqual(['Action/alpha.mkv', 'Action/beta.mkv']); // gamma has no user data
    expect(p.media[0]!.history).toHaveLength(2);
    expect(p.playlists[0]).toMatchObject({ name: 'Faves', items: [1, 0] });
    expect(p.favorites).toEqual([{ type: 'series', key: 'show one' }]); // folder favourites hold absolute paths
    expect(p.matches[0]).toMatchObject({ kind: 'movie', media: 0, extId: '42' });
    expect(JSON.stringify(p)).not.toContain('/lib/movies');
  });

  it('never exports secrets: no settings, and credential-bearing poster URLs are dropped', () => {
    const { app, ids } = library('/lib/movies', FILES);
    seed(app, ids);
    const json = JSON.stringify(exportProfile(app.db, '1'));
    expect(json).not.toContain('SECRET123');
    expect(json).not.toMatch(/api[_-]?key|token|password|secret/i);
    expect(safePoster('https://user:pw@x.test/a.jpg')).toBeNull();
    expect(safePoster('http://x.test/a.jpg')).toBeNull();
    expect(safePoster('https://x.test/a.jpg')).toBe('https://x.test/a.jpg');
  });

  it('relativeTo only matches real children', () => {
    expect(relativeTo('/music', '/music2/x.mp3')).toBeNull();
    expect(relativeTo('C:\\Lib', 'C:\\Lib\\a\\b.mkv')).toBe('a/b.mkv');
  });
});

describe('validation', () => {
  const good = () => JSON.parse(JSON.stringify({ format: PROFILE_FORMAT, version: 1, exportedAt: 1, appVersion: '1', media: [], playlists: [], favorites: [], matches: [] }));
  it('accepts a minimal file', () => { expect(parseProfile(good()).media).toEqual([]); });
  it('rejects wrong format, bad version and non-objects', () => {
    for (const v of [null, 5, [], { ...good(), format: 'x' }, { ...good(), version: 0 }, { ...good(), version: 'a' }]) expect(() => parseProfile(v)).toThrow(ProfileError);
  });
  it('explains a newer version', () => {
    expect(() => parseProfile({ ...good(), version: 99 })).toThrow(/newer version/);
  });
  it('rejects out-of-range and malformed entries, and unsafe paths', () => {
    const entry = (extra: object) => ({ ...good(), media: [{ rel: 'a.mkv', root: 'r', size: 1, kind: 'video', title: 't', ...extra }] });
    const state = (s: object) => ({ favorite: false, rating: 3, notes: '', playCount: 0, lastPlayedAt: null, positionSec: 0, progress: 0.5, completed: false, completedAt: null, ...s });
    expect(parseProfile(entry({ state: state({}) })).media[0]!.state!.rating).toBe(3);
    expect(() => parseProfile(entry({ state: state({ rating: 9 }) }))).toThrow(ProfileError);
    expect(() => parseProfile(entry({ state: state({ progress: 2 }) }))).toThrow(ProfileError);
    expect(() => parseProfile(entry({ state: state({ playCount: -1 }) }))).toThrow(ProfileError);
    expect(() => parseProfile(entry({ rel: '../x.mkv' }))).toThrow(/unsafe/);
    expect(() => parseProfile(entry({ rel: '/etc/x' }))).toThrow(/unsafe/);
    expect(() => parseProfile({ ...good(), playlists: [{ name: 'p', description: '', createdAt: 0, items: [3] }] })).toThrow(/missing item/);
  });
  it('drops unknown keys', () => {
    const f = parseProfile({ ...good(), apiKey: 'zzz', media: [{ rel: 'a', root: '', size: 1, kind: 'video', title: '', token: 'q' }] });
    expect(JSON.stringify(f)).not.toMatch(/zzz|"q"/);
  });
});

describe('import', () => {
  function source() {
    const s = library('/old/place', FILES, 'Old');
    seed(s.app, s.ids);
    return roundtrip(exportProfile(s.app.db, '1'));
  }

  it('round-trips into a library at a different location', () => {
    const profile = source();
    const t = library('/new/drive/films', FILES, 'Films');
    const r = runImport(t.app.db, profile, { conflicts: 'keep' }, false);
    expect(r.media).toMatchObject({ total: 2, matched: 2, unmatched: 0, ambiguous: 0 });
    const st = t.app.db.get<Record<string, number | string>>('SELECT * FROM state WHERE media_id = ?', [t.ids[0]!]);
    expect(st).toMatchObject({ favorite: 1, rating: 4, notes: 'great', play_count: 3, progress: 0.4 });
    expect(t.app.db.all('SELECT * FROM history WHERE media_id = ?', [t.ids[0]!])).toHaveLength(2);
    expect(t.app.db.all('SELECT * FROM playlist_items ORDER BY position')).toHaveLength(2);
    expect(t.app.db.get('SELECT * FROM collection_state WHERE key = ?', ['show one'])).toBeTruthy();
    expect(t.app.db.get<Record<string, unknown>>('SELECT * FROM meta_match WHERE kind = ? AND key = ?', ['movie', String(t.ids[0])])).toMatchObject({ ext_id: '42', locked: 1 });
    expect(t.app.db.get<Record<string, unknown>>('SELECT year, plot FROM media WHERE id = ?', [t.ids[0]!])).toMatchObject({ year: 1999, plot: 'plot' });
  });

  it('preview writes nothing and reports the same numbers as apply', () => {
    const profile = source();
    const t = library('/x', FILES);
    const preview = runImport(t.app.db, profile, { conflicts: 'keep' }, true);
    expect(preview.dryRun).toBe(true);
    expect(t.app.db.all('SELECT * FROM state')).toHaveLength(0);
    expect(t.app.db.all('SELECT * FROM playlists')).toHaveLength(0);
    expect(t.app.db.all('SELECT * FROM history')).toHaveLength(0);
    const applied = runImport(t.app.db, profile, { conflicts: 'keep' }, false);
    expect({ ...applied, dryRun: true }).toEqual(preview);
  });

  it('is idempotent: importing twice changes nothing the second time', () => {
    const profile = source();
    const t = library('/x', FILES);
    runImport(t.app.db, profile, { conflicts: 'keep' }, false);
    const r = runImport(t.app.db, profile, { conflicts: 'keep' }, false);
    expect(r.state).toEqual({ added: 0, updated: 0, unchanged: 2 });
    expect(r.history).toEqual({ added: 0, duplicate: 2 });
    expect(r.playlists).toMatchObject({ created: 0, merged: 1, itemsAdded: 0 });
    expect(r.matches).toEqual({ added: 0, unchanged: 1, replaced: 0 });
    expect(t.app.db.all('SELECT * FROM playlist_items')).toHaveLength(2);
    expect(r.conflictCount).toBe(0);
  });

  it('finds moved/renamed-folder files by file name + size, and skips what it cannot place', () => {
    const profile = source();
    const t = library('/x', [['Sorted/alpha.mkv', 1000], ['beta.mkv', 9999]]); // beta has a different size
    const r = runImport(t.app.db, profile, { conflicts: 'keep' }, false);
    expect(r.media).toMatchObject({ matched: 1, relocated: 1, unmatched: 1 });
    expect(r.unmatchedSamples).toEqual(['beta']);
    expect(t.app.db.get<Record<string, unknown>>('SELECT rating FROM state WHERE media_id = ?', [t.ids[0]!])).toMatchObject({ rating: 4 });
    expect(r.playlists.itemsSkipped).toBe(1);
  });

  it('refuses ambiguous matches instead of guessing', () => {
    const profile = source();
    const t = library('/x', [['one/alpha.mkv', 1000], ['two/alpha.mkv', 1000]]);
    const r = runImport(t.app.db, profile, { conflicts: 'keep' }, false);
    expect(r.media.ambiguous).toBe(1);
    expect(t.app.db.all('SELECT * FROM state')).toHaveLength(0);
  });

  it('merges with existing data and resolves conflicts per policy', () => {
    const profile = source();
    const make = () => {
      const t = library('/x', FILES);
      t.app.db.run("INSERT INTO state (media_id, rating, notes, play_count, last_played_at, favorite) VALUES (?, 5, 'mine', 10, 9000, 0)", [t.ids[0]!]);
      return t;
    };
    const keep = make();
    const rk = runImport(keep.app.db, profile, { conflicts: 'keep' }, false);
    expect(rk.conflicts.map((c) => c.what).sort()).toEqual(['notes', 'rating']);
    expect(keep.app.db.get<Record<string, unknown>>('SELECT * FROM state WHERE media_id = ?', [keep.ids[0]!])).toMatchObject({ rating: 5, notes: 'mine', play_count: 10, favorite: 1, last_played_at: 9000, progress: 0 });

    const take = make();
    runImport(take.app.db, profile, { conflicts: 'backup' }, false);
    expect(take.app.db.get<Record<string, unknown>>('SELECT * FROM state WHERE media_id = ?', [take.ids[0]!])).toMatchObject({ rating: 4, notes: 'great', play_count: 10 });
  });

  it('keeps a differing local metadata match unless told otherwise', () => {
    const profile = source();
    const make = () => {
      const t = library('/x', FILES);
      t.app.db.run("INSERT INTO meta_match (kind, key, provider, ext_id, title, genres, locked, matched_at) VALUES ('movie', ?, 'tmdb', '7', 'Other', '[]', 1, 1)", [String(t.ids[0]!)]);
      return t;
    };
    const a = make();
    const ra = runImport(a.app.db, profile, { conflicts: 'keep' }, false);
    expect(ra.conflicts.find((c) => c.what === 'match')).toMatchObject({ mine: 'Other', backup: 'Alpha' });
    expect(a.app.db.get<Record<string, unknown>>('SELECT ext_id FROM meta_match WHERE kind = ?', ['movie'])).toMatchObject({ ext_id: '7' });
    const b = make();
    runImport(b.app.db, profile, { conflicts: 'backup' }, false);
    expect(b.app.db.get<Record<string, unknown>>('SELECT ext_id FROM meta_match WHERE kind = ?', ['movie'])).toMatchObject({ ext_id: '42' });
  });

  it('merges playlists by name without duplicating or deleting items', () => {
    const profile = source();
    const t = library('/x', FILES);
    const pl = t.app.db.run("INSERT INTO playlists (name, description, created_at, updated_at) VALUES ('faves', '', 1, 1)").lastId;
    t.app.db.run('INSERT INTO playlist_items (playlist_id, media_id, position, added_at) VALUES (?, ?, 0, 1)', [pl, t.ids[2]!]);
    runImport(t.app.db, profile, { conflicts: 'keep' }, false);
    expect(t.app.db.all('SELECT * FROM playlists')).toHaveLength(1);
    expect(t.app.db.all<{ media_id: number }>('SELECT media_id FROM playlist_items ORDER BY position').map((x) => x.media_id)).toEqual([t.ids[2], t.ids[1], t.ids[0]]);
  });

  it('is atomic: a failure mid-import leaves nothing behind', () => {
    const profile = source();
    const t = library('/x', FILES);
    t.app.db.raw.exec('CREATE TRIGGER boom BEFORE INSERT ON playlist_items BEGIN SELECT RAISE(ABORT, \'boom\'); END');
    expect(() => runImport(t.app.db, profile, { conflicts: 'keep' }, false)).toThrow();
    expect(t.app.db.all('SELECT * FROM state')).toHaveLength(0);
    expect(t.app.db.all('SELECT * FROM history')).toHaveLength(0);
  });
});
