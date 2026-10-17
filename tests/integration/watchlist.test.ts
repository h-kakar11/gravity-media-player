import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { watchKey, type WatchAction } from '@shared/watch';
import { Db } from '../../src/main/db/database';
import { LibraryRepo } from '../../src/main/db/repo';
import { emptyFields } from '../../src/main/library/types';
import { WatchService } from '../../src/main/watch/service';
import { makeApp } from './helpers';

type App = ReturnType<typeof makeApp>;

let app: App;
let libDir: string;
let rootId: number;
let seq = 0;
let clock = 1_000_000;
let svc: WatchService;

/** Library arrival time of the episodes most tests use; everything the viewer did happens later. */
const OLD = 500;
const PLAY = 2_000;
const LATER = 3_000;

function addFile(kind: 'video' | 'audio', vclass: 'movie' | 'episode' | null, title: string, fill?: (f: ReturnType<typeof emptyFields>) => void): number {
  const n = ++seq;
  const name = `${title.replace(/[^\w ]/g, '')}-${n}.${kind === 'audio' ? 'mp3' : 'mkv'}`;
  const f = emptyFields({ rootId, path: join(libDir, name), dir: libDir, fileName: name, ext: kind === 'audio' ? 'mp3' : 'mkv', kind, title, size: 1_000 + n, mtimeMs: 1 });
  f.vclass = vclass;
  f.durationSec = 1800;
  f.ino = String(n);
  f.dev = '1';
  fill?.(f);
  const id = app.repo.upsertMedia(f).id;
  app.db.run('UPDATE media SET added_at = ? WHERE id = ?', [OLD, id]);
  return id;
}

const movie = (title: string) => addFile('video', 'movie', title);

function episode(series: string, season: number | null, ep: number | null, addedAt = OLD): number {
  const id = addFile('video', 'episode', `${series} ${season}x${ep}`, (f) => { f.series = series; f.season = season; f.episode = ep; });
  app.db.run('UPDATE media SET added_at = ? WHERE id = ?', [addedAt, id]);
  return id;
}

/** A season of a show; returns the ids in episode order. */
const season = (series: string, s: number, n: number, addedAt = OLD) => Array.from({ length: n }, (_, i) => episode(series, s, i + 1, addedAt));

/** Write playback state directly so tests control `last_played_at`. */
function play(id: number, state: 'done' | 'partial', at = PLAY): void {
  app.db.run(
    `INSERT INTO state (media_id, completed, completed_at, position, progress, last_played_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(media_id) DO UPDATE SET completed = excluded.completed, completed_at = excluded.completed_at, position = excluded.position,
       progress = excluded.progress, last_played_at = excluded.last_played_at`,
    [id, state === 'done' ? 1 : 0, state === 'done' ? at : null, state === 'done' ? 0 : 300, state === 'done' ? 1 : 0.2, at]
  );
}

const keyOf = (id: number) => app.db.get<{ series_key: string }>('SELECT series_key FROM media WHERE id = ?', [id])!.series_key;
const act = (action: WatchAction) => svc.update(action);
const addShow = (key: string) => act({ type: 'add', target: { kind: 'show', key } });
const addMovie = (id: number) => act({ type: 'add', target: { kind: 'movie', id } });
const upNext = () => svc.overview().upNext;
const list = () => svc.overview().watchlist;
const titles = () => list().map((e) => e.title);
const rowCount = (table: string) => app.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n;

beforeEach(() => {
  app = makeApp();
  libDir = join(app.base, 'lib');
  mkdirSync(libDir, { recursive: true });
  rootId = app.repo.addRoot(libDir, 'Lib', 'auto');
  clock = 1_000_000;
  svc = new WatchService(app.db, app.repo, () => ++clock);
});

afterEach(() => {
  app.settings.flush();
  app.db.raw.close();
  rmSync(app.base, { recursive: true, force: true });
});

describe('schema and persistence', () => {
  it('registers the 04-watchlist migration with its tables and indexes', () => {
    const names = app.db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE name LIKE 'watchlist%' OR name = 'show_tracking'").map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['watchlist', 'watchlist_movie', 'watchlist_show', 'show_tracking']));
    expect(app.db.get('SELECT 1 AS x FROM schema_migrations WHERE name = ?', ['04-watchlist'])).toBeTruthy();
  });

  it('rejects rows that are neither a movie nor a show', () => {
    const m = movie('Heat');
    const bad = (sql: string, params: (string | number)[]) => expect(() => app.db.run(sql, params)).toThrow();
    bad("INSERT INTO watchlist (kind, added_at) VALUES ('movie', 1)", []);
    bad("INSERT INTO watchlist (kind, media_id, series_key, added_at) VALUES ('movie', ?, 'x', 1)", [m]);
    bad("INSERT INTO watchlist (kind, media_id, added_at) VALUES ('show', ?, 1)", [m]);
    bad("INSERT INTO watchlist (kind, series_key, added_at) VALUES ('film', 'x', 1)", []);
  });

  it('keeps the watchlist, its order and the show marks across a reopen', () => {
    const file = join(app.base, 'persist.db');
    let db = new Db(file);
    let repo = new LibraryRepo(db);
    const root = repo.addRoot(libDir, 'Lib', 'auto');
    const fields = (name: string, vclass: 'movie' | 'episode') => {
      const f = emptyFields({ rootId: root, path: join(libDir, name), dir: libDir, fileName: name, ext: 'mkv', kind: 'video', title: name, size: 5 + name.length, mtimeMs: 1 });
      f.vclass = vclass;
      if (vclass === 'episode') { f.series = 'Persisted'; f.season = 1; f.episode = 1; }
      return f;
    };
    const m = repo.upsertMedia(fields('movie.mkv', 'movie')).id;
    repo.upsertMedia(fields('show.mkv', 'episode'));
    let w = new WatchService(db, repo, () => 42);
    w.update({ type: 'add', target: { kind: 'show', key: 'persisted' } });
    w.update({ type: 'add', target: { kind: 'movie', id: m } });
    const [first, second] = w.overview().watchlist.map((e) => e.id);
    w.update({ type: 'reorder', ids: [second!, first!] });
    w.update({ type: 'hideUpNext', seriesKey: 'persisted' });
    db.close();

    db = new Db(file);
    repo = new LibraryRepo(db);
    w = new WatchService(db, repo);
    expect(w.overview().watchlist.map((e) => [e.kind, e.title])).toEqual([['movie', 'movie.mkv'], ['show', 'Persisted']]);
    expect(db.get<{ hidden_at: number }>('SELECT hidden_at FROM show_tracking WHERE series_key = ?', ['persisted'])?.hidden_at).toBe(42);
    db.close();
  });

  it('applies on a database that already has watchlist data without touching it', () => {
    const file = join(app.base, 'again.db');
    let db = new Db(file);
    db.run("INSERT INTO watchlist (kind, series_key, title, added_at, position) VALUES ('show', 'kept', 'Kept', 7, 0)");
    db.raw.exec("DELETE FROM schema_migrations WHERE name = '04-watchlist'"); // forces the migration to run again
    db.close();
    db = new Db(file);
    expect(db.all('SELECT * FROM watchlist')).toHaveLength(1);
    expect(db.get('SELECT 1 AS x FROM schema_migrations WHERE name = ?', ['04-watchlist'])).toBeTruthy();
    db.close();
  });

  it('seeds shows that were already watched so an upgrade does not flood the badges', () => {
    const file = join(app.base, 'upgrade.db');
    let db = new Db(file);
    let repo = new LibraryRepo(db);
    const root = repo.addRoot(libDir, 'Lib', 'auto');
    const ids = [1, 2, 3].map((n) => {
      const f = emptyFields({ rootId: root, path: join(libDir, `up${n}.mkv`), dir: libDir, fileName: `up${n}.mkv`, ext: 'mkv', kind: 'video', title: `Up ${n}`, size: 100 + n, mtimeMs: 1 });
      f.vclass = 'episode'; f.series = 'Upgraded'; f.season = 1; f.episode = n;
      return repo.upsertMedia(f).id;
    });
    const other = emptyFields({ rootId: root, path: join(libDir, 'other.mkv'), dir: libDir, fileName: 'other.mkv', ext: 'mkv', kind: 'video', title: 'Other', size: 999, mtimeMs: 1 });
    other.vclass = 'episode'; other.series = 'Untouched'; other.season = 1; other.episode = 1;
    repo.upsertMedia(other);
    db.run('UPDATE media SET added_at = ?', [3_000]);
    repo.updateState(ids[0]!, { completed: true });
    // Simulate a database from before this feature existed.
    db.raw.exec("DROP TABLE watchlist; DROP TABLE show_tracking; DELETE FROM schema_migrations WHERE name = '04-watchlist'");
    db.close();

    const before = Date.now();
    db = new Db(file);
    repo = new LibraryRepo(db);
    const marks = db.all<{ series_key: string; seen_at: number }>('SELECT series_key, seen_at FROM show_tracking');
    expect(marks.map((m) => m.series_key)).toEqual(['upgraded']); // only the show that had been played
    expect(marks[0]!.seen_at).toBeGreaterThanOrEqual(before);

    const w = new WatchService(db, repo);
    expect(w.badges()).toEqual({}); // episodes 2 and 3 predate the upgrade
    db.run('UPDATE media SET added_at = ? WHERE id = ?', [Date.now() + 60_000, ids[2]!]);
    expect(w.badges()).toEqual({ upgraded: 1 });
    db.close();
  });
});

describe('Up Next', () => {
  it('is empty for an empty library', () => {
    expect(svc.overview()).toEqual({ upNext: [], watchlist: [] });
  });

  it('suggests the next unplayed episode of each show that is in progress', () => {
    const a = season('Alpha', 1, 4);
    season('Untouched', 1, 3);
    play(a[0]!, 'done');
    play(a[1]!, 'done', PLAY + 1);
    const [entry, ...rest] = upNext();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ seriesKey: 'alpha', showTitle: 'Alpha', playedCount: 2, episodeCount: 4, lastPlayedAt: PLAY + 1, newEpisodes: 0, isNew: false });
    expect(entry!.episode).toMatchObject({ id: a[2], season: 1, episode: 3 });
  });

  it('orders shows by when they were last watched, newest first', () => {
    const alpha = season('Alpha', 1, 3);
    const beta = season('Beta', 1, 3);
    const gamma = season('Gamma', 1, 3);
    play(alpha[0]!, 'done', 3_000);
    play(beta[0]!, 'done', 5_000);
    play(gamma[0]!, 'done', 4_000);
    expect(upNext().map((e) => e.showTitle)).toEqual(['Beta', 'Gamma', 'Alpha']);
    play(alpha[1]!, 'done', 9_000); // watching Alpha again moves it to the front
    expect(upNext().map((e) => e.showTitle)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('breaks ties by title', () => {
    for (const name of ['Zulu', 'Alpha', 'Mike']) play(season(name, 1, 2)[0]!, 'done', 5_000);
    expect(upNext().map((e) => e.showTitle)).toEqual(['Alpha', 'Mike', 'Zulu']);
  });

  it('continues from the furthest episode reached when some were skipped', () => {
    const e = season('Skippy', 1, 6);
    play(e[0]!, 'done');
    play(e[3]!, 'done');
    expect(upNext()[0]!.episode.id).toBe(e[4]);
  });

  it('leaves a partly watched episode to Continue Watching and suggests the one after it', () => {
    const e = season('Partial', 1, 4);
    play(e[0]!, 'done');
    play(e[1]!, 'partial', PLAY + 1);
    expect(upNext()[0]!.episode.id).toBe(e[2]);
  });

  it('treats a barely started episode (10 seconds or less) as not started', () => {
    const e = season('Barely', 1, 3);
    app.db.run('INSERT INTO state (media_id, position, last_played_at) VALUES (?, 10, ?)', [e[0]!, PLAY]);
    expect(upNext()).toEqual([]);
    app.db.run('UPDATE state SET position = 10.5 WHERE media_id = ?', [e[0]!]);
    expect(upNext()[0]!.episode.id).toBe(e[1]);
  });

  it('drops a show once it has been finished or its last episode is in progress', () => {
    const e = season('Short', 1, 2);
    play(e[0]!, 'done');
    expect(upNext()).toHaveLength(1);
    play(e[1]!, 'partial');
    expect(upNext()).toEqual([]);
    play(e[1]!, 'done');
    expect(upNext()).toEqual([]);
  });

  it('rolls over to the next season', () => {
    const s1 = season('Seasons', 1, 2);
    const s2 = season('Seasons', 2, 2);
    play(s1[0]!, 'done');
    play(s1[1]!, 'done');
    expect(upNext()[0]!.episode.id).toBe(s2[0]);
  });

  it('follows the real playback code: finishing episodes advances it, un-marking retreats it', () => {
    const e = season('Live', 1, 3);
    app.repo.updateState(e[0]!, { completed: true });
    expect(upNext()[0]!.episode.id).toBe(e[1]);
    app.repo.setProgress({ mediaId: e[1]!, positionSec: 600, progress: 0.3 });
    expect(upNext()[0]!.episode.id).toBe(e[2]);
    app.repo.markMany([e[1]!, e[2]!], true);
    expect(upNext()).toEqual([]);
    app.repo.markMany(e, false);
    expect(upNext()).toEqual([]);
  });

  it('skips episodes whose files are missing and ones with no episode number', () => {
    const e = season('Gappy', 1, 4);
    const unnumbered = episode('Gappy', 1, null);
    play(e[0]!, 'done');
    app.db.run('UPDATE media SET missing = 1 WHERE id = ?', [e[1]!]);
    expect(upNext()[0]!.episode.id).toBe(e[2]);
    app.db.run('UPDATE media SET missing = 1 WHERE id IN (?, ?)', [e[2]!, e[3]!]);
    expect(upNext()).toEqual([]);
    expect(upNext().map((u) => u.episode.id)).not.toContain(unnumbered);
  });

  it('does not suggest another copy of an episode that was already played', () => {
    const e = season('Dupes', 1, 3);
    const copyOf2 = episode('Dupes', 1, 2);
    play(e[0]!, 'done');
    play(e[1]!, 'done');
    expect(upNext()[0]!.episode.id).toBe(e[2]);
    expect(upNext().map((u) => u.episode.id)).not.toContain(copyOf2);
    expect(list()).toEqual([]);
  });

  it('never suggests season 0 specials', () => {
    const e = season('Specials', 1, 2);
    const special = episode('Specials', 0, 1);
    play(e[0]!, 'done');
    expect(upNext()[0]!.episode.id).toBe(e[1]);
    play(e[1]!, 'done');
    expect(upNext()).toEqual([]);
    expect(special).toBeGreaterThan(0);
  });

  it('caps the list', () => {
    for (let i = 0; i < 35; i++) play(season(`Show ${String(i).padStart(2, '0')}`, 1, 2)[0]!, 'done', PLAY + i);
    const out = upNext();
    expect(out).toHaveLength(30);
    expect(out[0]!.showTitle).toBe('Show 34');
  });

  describe('hiding', () => {
    it('hides a show until it is watched again', () => {
      const e = season('Hidden', 1, 4);
      play(e[0]!, 'done');
      expect(act({ type: 'hideUpNext', seriesKey: 'hidden' }).changed).toBe(1);
      expect(upNext()).toEqual([]);
      play(e[1]!, 'done', 2_000_000); // later than the hide
      expect(upNext()[0]!.episode.id).toBe(e[2]);
    });

    it('keeps other shows visible and does not touch the watchlist or playback state', () => {
      const a = season('Hide Me', 1, 3);
      const b = season('Keep Me', 1, 3);
      play(a[0]!, 'done');
      play(b[0]!, 'done');
      addShow('hide me');
      act({ type: 'hideUpNext', seriesKey: 'hide me' });
      expect(upNext().map((u) => u.showTitle)).toEqual(['Keep Me']);
      expect(titles()).toEqual(['Hide Me']);
      expect(app.db.get<{ completed: number }>('SELECT completed FROM state WHERE media_id = ?', [a[0]!])!.completed).toBe(1);
    });

    it('can be hidden twice and still be one row', () => {
      season('Twice', 1, 2);
      act({ type: 'hideUpNext', seriesKey: 'twice' });
      act({ type: 'hideUpNext', seriesKey: 'twice' });
      expect(rowCount('show_tracking')).toBe(1);
    });
  });
});

describe('watchlist', () => {
  it('adds movies and shows in the order added, with their details', () => {
    const m = movie('Heat');
    const e = season('Severance', 1, 3);
    play(e[0]!, 'done');
    expect(addShow('severance').changed).toBe(1);
    expect(addMovie(m).changed).toBe(1);
    const [show, film] = list();
    expect(show).toMatchObject({ kind: 'show', title: 'Severance', available: true, watched: false, movie: null });
    expect(show!.show).toMatchObject({ key: 'severance', seasonCount: 1, episodeCount: 3, completedCount: 1, lastPlayedAt: PLAY });
    expect(film).toMatchObject({ kind: 'movie', title: 'Heat', available: true, watched: false, show: null });
    expect(film!.movie!.id).toBe(m);
    expect(show!.addedAt).toBeLessThan(film!.addedAt);
  });

  it('is idempotent', () => {
    const m = movie('Heat');
    season('Dup Show', 1, 2);
    expect(addMovie(m).changed).toBe(1);
    expect(addMovie(m).changed).toBe(0);
    expect(addShow('dup show').changed).toBe(1);
    expect(addShow('dup show').changed).toBe(0);
    expect(list()).toHaveLength(2);
  });

  it('adding an episode adds its show instead', () => {
    const e = season('From Episode', 1, 2);
    const res = act({ type: 'add', target: { kind: 'movie', id: e[1]! } });
    expect(res.changed).toBe(1);
    expect(list().map((x) => [x.kind, x.title])).toEqual([['show', 'From Episode']]);
    expect(act({ type: 'add', target: { kind: 'movie', id: e[0]! } }).changed).toBe(0);
  });

  it('refuses things that are not movies or shows', () => {
    const song = addFile('audio', null, 'A song');
    season('Real Show', 1, 1);
    expect(() => addMovie(song)).toThrow(/movies and shows/);
    expect(() => addMovie(987_654)).toThrow(/no longer in the library/);
    expect(() => addMovie(1.5)).toThrow(/Unknown movie/);
    expect(() => addShow('no such show')).toThrow(/not in the library/);
    expect(() => addShow('')).toThrow(/Unknown show/);
    expect(() => act({ type: 'add', target: { kind: 'album', id: 1 } as never })).toThrow(/Unknown watchlist item/);
    expect(() => act({ type: 'add', target: null as never })).toThrow(/Unknown watchlist item/);
    expect(() => act({ type: 'bogus' } as never)).toThrow(/Unknown watchlist action/);
    expect(list()).toEqual([]);
  });

  it('refuses a show whose files are all missing', () => {
    const e = season('Gone', 1, 2);
    app.db.run('UPDATE media SET missing = 1');
    expect(() => addShow('gone')).toThrow(/not in the library/);
    expect(e).toHaveLength(2);
  });

  it('treats hostile text as data', () => {
    const name = `O'Brien "Show"; DROP TABLE media;--`;
    const e = episode(name, 1, 1);
    expect(() => addShow(`x'; DROP TABLE watchlist;--`)).toThrow(/not in the library/);
    expect(() => act({ type: 'hideUpNext', seriesKey: `x'); DROP TABLE show_tracking;--` })).not.toThrow();
    expect(addShow(keyOf(e)).changed).toBe(1);
    expect(titles()).toEqual([name]);
    expect(rowCount('media')).toBe(1);
    expect(app.db.get("SELECT name FROM sqlite_master WHERE name = 'watchlist'")).toBeTruthy();
  });

  it('round-trips non-ASCII show keys exactly as the database holds them', () => {
    const e = episode('Élite', 1, 1);
    const key = keyOf(e); // whatever SQLite's lower() made of it; JavaScript's toLowerCase() may disagree
    expect(addShow(key).changed).toBe(1);
    expect(list()[0]).toMatchObject({ title: 'Élite', available: true });
    expect(svc.keys()).toEqual([`s:${key}`]);
    expect(act({ type: 'remove', target: { kind: 'show', key } }).changed).toBe(1);
  });

  it('removes entries by target, and removing a missing one changes nothing', () => {
    const m = movie('Heat');
    const e = season('Gone Soon', 1, 2);
    addMovie(m);
    addShow('gone soon');
    expect(act({ type: 'remove', target: { kind: 'movie', id: m } }).changed).toBe(1);
    expect(act({ type: 'remove', target: { kind: 'movie', id: m } }).changed).toBe(0);
    expect(act({ type: 'remove', target: { kind: 'movie', id: e[0]! } }).changed).toBe(1); // an episode stands for its show
    expect(list()).toEqual([]);
    expect(act({ type: 'remove', target: { kind: 'show', key: 'never added' } }).changed).toBe(0);
  });

  it('lets a stale entry be removed even after its file left the library', () => {
    const m = movie('Vanishing');
    addMovie(m);
    app.db.run('PRAGMA foreign_keys = OFF');
    app.db.run('DELETE FROM media WHERE id = ?', [m]);
    app.db.run('PRAGMA foreign_keys = ON');
    expect(act({ type: 'remove', target: { kind: 'movie', id: m } }).changed).toBe(1);
    expect(list()).toEqual([]);
  });

  it('drops a movie entry when its media row is deleted', () => {
    const m = movie('Cascade');
    addMovie(m);
    app.db.run('DELETE FROM media WHERE id = ?', [m]);
    expect(rowCount('watchlist')).toBe(0);
  });

  describe('order', () => {
    const three = () => {
      const a = movie('A');
      const b = movie('B');
      const c = movie('C');
      [a, b, c].forEach(addMovie);
      return list().map((e) => e.id);
    };

    it('reorders to the requested sequence', () => {
      const [x, y, z] = three();
      expect(act({ type: 'reorder', ids: [z!, x!, y!] }).changed).toBeGreaterThan(0);
      expect(titles()).toEqual(['C', 'A', 'B']);
    });

    it('keeps unlisted entries after the listed ones in their old order', () => {
      const [x, y, z] = three();
      act({ type: 'reorder', ids: [z!] });
      expect(titles()).toEqual(['C', 'A', 'B']);
      act({ type: 'reorder', ids: [y!] });
      expect(titles()).toEqual(['B', 'C', 'A']);
      expect(x).toBeDefined();
    });

    it('ignores unknown and repeated ids and reports no change when nothing moved', () => {
      const [x, y, z] = three();
      expect(act({ type: 'reorder', ids: [x!, y!, z!] }).changed).toBe(0);
      expect(act({ type: 'reorder', ids: [999, x!, x!, y!, 1234] }).changed).toBe(0);
      expect(act({ type: 'reorder', ids: [] }).changed).toBe(0);
      expect(titles()).toEqual(['A', 'B', 'C']);
      expect(() => act({ type: 'reorder', ids: 'nope' as never })).toThrow(/Invalid order/);
    });

    it('appends new entries after existing ones, even after a removal', () => {
      three();
      act({ type: 'remove', target: { kind: 'movie', id: list()[0]!.movie!.id } });
      addMovie(movie('D'));
      expect(titles()).toEqual(['B', 'C', 'D']);
    });
  });

  describe('availability and watched', () => {
    it('keeps an entry whose movie is offline, readable from its remembered title', () => {
      const m = movie('Offline Movie');
      addMovie(m);
      app.db.run('UPDATE media SET missing = 1 WHERE id = ?', [m]);
      expect(list()[0]).toMatchObject({ title: 'Offline Movie', available: false, watched: false });
      app.db.run('UPDATE media SET missing = 0 WHERE id = ?', [m]);
      expect(list()[0]!.available).toBe(true);
    });

    it('keeps an entry whose show is offline, with no show details', () => {
      season('Offline Show', 1, 2);
      addShow('offline show');
      app.db.run('UPDATE media SET missing = 1');
      expect(list()[0]).toMatchObject({ kind: 'show', title: 'Offline Show', available: false, watched: false, show: null });
    });

    it('hands every entry a target that removes it, even when it is offline', () => {
      const m = movie('Offline Movie');
      season('Offline Show', 1, 2);
      addMovie(m);
      addShow('offline show');
      expect(list().map((e) => e.target)).toEqual([{ kind: 'movie', id: m }, { kind: 'show', key: 'offline show' }]);
      app.db.run('UPDATE media SET missing = 1');
      expect(list().every((e) => !e.available)).toBe(true);
      for (const entry of list()) expect(act({ type: 'remove', target: entry.target }).changed).toBe(1);
      expect(list()).toEqual([]);
    });

    it('marks a movie watched from its playback state', () => {
      const m = movie('Seen');
      addMovie(m);
      expect(list()[0]!.watched).toBe(false);
      app.repo.updateState(m, { completed: true });
      expect(list()[0]!.watched).toBe(true);
      app.repo.updateState(m, { completed: false });
      expect(list()[0]!.watched).toBe(false);
    });

    it('marks a show watched only when every regular episode is played', () => {
      const e = season('Binge', 1, 3);
      const special = episode('Binge', 0, 1);
      addShow('binge');
      play(e[0]!, 'done');
      play(e[1]!, 'done');
      expect(list()[0]!.watched).toBe(false);
      play(e[2]!, 'done');
      expect(list()[0]!.watched).toBe(true); // the unplayed special does not count
      expect(special).toBeGreaterThan(0);
      episode('Binge', 1, 4);
      expect(list()[0]!.watched).toBe(false); // a new episode arrived
    });

    it('reports a show with the art of its first episode that has any', () => {
      const e = season('Arty', 1, 3);
      app.db.run("UPDATE media SET art_src = 'x' WHERE id = ?", [e[1]!]);
      addShow('arty');
      expect(list()[0]!.show!.artMediaId).toBe(e[1]);
    });
  });

  describe('clearWatched', () => {
    it('removes finished entries and keeps the rest', () => {
      const done = movie('Done');
      const todo = movie('Todo');
      const offlineDone = movie('Offline Done');
      const finished = season('Finished', 1, 2);
      const ongoing = season('Ongoing', 1, 2);
      [done, todo, offlineDone].forEach(addMovie);
      addShow('finished');
      addShow('ongoing');
      app.repo.updateState(done, { completed: true });
      app.repo.updateState(offlineDone, { completed: true });
      app.db.run('UPDATE media SET missing = 1 WHERE id = ?', [offlineDone]);
      app.repo.markMany(finished, true);
      play(ongoing[0]!, 'done');

      const r = act({ type: 'clearWatched' });
      expect(r.changed).toBe(2);
      expect(r.overview.watchlist.map((e) => e.title).sort()).toEqual(['Offline Done', 'Ongoing', 'Todo']);
      expect(act({ type: 'clearWatched' }).changed).toBe(0);
    });
  });

  it('lists membership as stable keys', () => {
    const m = movie('Heat');
    season('Keyed', 1, 1);
    addShow('keyed');
    addMovie(m);
    expect(svc.keys()).toEqual(['s:keyed', `m:${m}`]);
    expect(svc.keys()).toEqual([watchKey({ kind: 'show', key: 'keyed' }), watchKey({ kind: 'movie', id: m })]);
  });
});

describe('new episodes', () => {
  it('badges unplayed episodes that arrived after the viewer started a show', () => {
    const e = season('Ongoing', 1, 2);
    const fresh = [episode('Ongoing', 1, 3, LATER), episode('Ongoing', 1, 4, LATER)];
    play(e[0]!, 'done');
    expect(svc.badges()).toEqual({ ongoing: 2 });
    expect(upNext()[0]).toMatchObject({ newEpisodes: 2, isNew: false });
    play(fresh[0]!, 'done', PLAY + 10);
    expect(svc.badges()).toEqual({ ongoing: 1 });
  });

  it('flags the suggested episode when it is one of the new ones', () => {
    const e = season('Flagged', 1, 1);
    const fresh = episode('Flagged', 1, 2, LATER);
    play(e[0]!, 'done');
    expect(upNext()[0]).toMatchObject({ newEpisodes: 1, isNew: true });
    expect(upNext()[0]!.episode.id).toBe(fresh);
  });

  it('does not badge episodes that were already in the library when the viewer started', () => {
    const e = season('Settled', 1, 4);
    play(e[0]!, 'done');
    expect(svc.badges()).toEqual({});
  });

  it('does not badge a show the viewer does not follow, however recent its episodes', () => {
    season('Stranger', 1, 3, LATER);
    expect(svc.badges()).toEqual({});
  });

  it('uses the earliest sign of activity as the starting point', () => {
    const e = season('History', 1, 1);
    const fresh = episode('History', 1, 2, 2_500);
    app.repo.recordHistory({ mediaId: e[0]!, startedAt: 2_000, watchedSec: 60, mediaSec: 60, fromSec: 0, toSec: 60, speed: 1 });
    // recordHistory stamps last_played_at with the real clock; the earlier history row still wins.
    expect(svc.badges()).toEqual({ history: 1 });
    expect(fresh).toBeGreaterThan(0);
  });

  it('starts counting from the watchlist when the viewer has not played the show', () => {
    season('Planned', 1, 2); // arrived long before it was added
    addShow('planned');
    expect(svc.badges()).toEqual({});
    app.db.run("UPDATE watchlist SET added_at = 2000 WHERE series_key = 'planned'");
    episode('Planned', 1, 3, LATER);
    expect(svc.badges()).toEqual({ planned: 1 });
    expect(list()[0]!.show!.newEpisodes).toBe(1);
  });

  it('stops following a show that leaves the watchlist before it is played', () => {
    season('Dropped', 1, 1);
    addShow('dropped');
    app.db.run("UPDATE watchlist SET added_at = 2000");
    episode('Dropped', 1, 2, LATER);
    expect(svc.badges()).toEqual({ dropped: 1 });
    act({ type: 'remove', target: { kind: 'show', key: 'dropped' } });
    expect(svc.badges()).toEqual({});
  });

  it('can be dismissed with "mark seen" and returns for later arrivals only', () => {
    const e = season('Dismissed', 1, 1);
    episode('Dismissed', 1, 2, LATER);
    play(e[0]!, 'done');
    expect(svc.badges()).toEqual({ dismissed: 1 });
    expect(act({ type: 'markSeen', seriesKey: 'dismissed' }).changed).toBe(1);
    expect(svc.badges()).toEqual({});
    expect(upNext()[0]!.newEpisodes).toBe(0);
    episode('Dismissed', 1, 3, clock + 1_000_000);
    expect(svc.badges()).toEqual({ dismissed: 1 });
  });

  it('counts a new special in the badge but not in Up Next', () => {
    const e = season('Extras', 1, 2);
    episode('Extras', 0, 1, LATER);
    play(e[0]!, 'done');
    expect(svc.badges()).toEqual({ extras: 1 });
    expect(upNext()[0]!.episode.id).toBe(e[1]);
  });

  it('is not fooled by a late duplicate of an old episode', () => {
    const e = season('Copies', 1, 2);
    episode('Copies', 1, 2, LATER);
    play(e[0]!, 'done');
    expect(svc.badges()).toEqual({});
  });

  it('ignores episodes whose files are missing', () => {
    const e = season('Absent', 1, 1);
    const fresh = episode('Absent', 1, 2, LATER);
    play(e[0]!, 'done');
    app.db.run('UPDATE media SET missing = 1 WHERE id = ?', [fresh]);
    expect(svc.badges()).toEqual({});
  });

  it('rejects mark-seen / hide with no show', () => {
    expect(() => act({ type: 'markSeen', seriesKey: '' })).toThrow(/Unknown show/);
    expect(() => act({ type: 'hideUpNext', seriesKey: 5 as never })).toThrow(/Unknown show/);
  });
});

describe('failure handling', () => {
  it('rolls an action back completely when it fails part-way', () => {
    addMovie(movie('Heat'));
    addMovie(movie('A'));
    const ids = list().map((e) => e.id);
    // The first reordered row is written, then the second one fails.
    app.db.raw.exec("CREATE TRIGGER boom BEFORE UPDATE ON watchlist WHEN NEW.position = 1 BEGIN SELECT RAISE(ABORT, 'boom'); END");
    expect(() => act({ type: 'reorder', ids: [ids[1]!, ids[0]!] })).toThrow(/boom/);
    app.db.raw.exec('DROP TRIGGER boom');
    expect(titles()).toEqual(['Heat', 'A']);
    expect(act({ type: 'reorder', ids: [ids[1]!, ids[0]!] }).changed).toBe(2); // and the service still works afterwards
  });
});
