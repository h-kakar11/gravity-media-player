import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { emptyFields } from '../../src/main/library/types';
import { makeApp } from './helpers';

const app = makeApp();
const rootId = app.repo.addRoot('/lib', 'Lib', 'auto');
let n = 0;

function ep(series: string, season: number | null, episode: number, art = false) {
  const name = `${series}-${++n}.mkv`;
  const f = emptyFields({ rootId, path: join('/lib', name), dir: '/lib', fileName: name, ext: 'mkv', kind: 'video', title: name, size: 1000 + n, mtimeMs: 1 });
  f.vclass = 'episode';
  f.series = series;
  f.season = season;
  f.episode = episode;
  f.ino = String(n);
  f.dev = '1';
  if (art) f.artSrc = 'embedded';
  return app.repo.upsertMedia(f).id;
}

beforeAll(() => {
  for (let i = 1; i <= 3; i++) ep('Black Clover', 1, i, i === 1);
  for (let i = 1; i <= 2; i++) ep('Black Clover', 2, i);
  ep('Black Clover', 0, 1);
  ep('Death Note', 1, 1);
  ep('Death Note', null, 2);
});

describe('series by season', () => {
  it('lists one card per season, specials last, with whole-show season counts', () => {
    const items = app.repo.series({ type: 'show', bySeason: true }).items;
    expect(items.map((s) => [s.title, s.season, s.episodeCount, s.seasonCount])).toEqual([
      ['Black Clover', 1, 3, 3], ['Black Clover', 2, 2, 3], ['Black Clover', 0, 1, 3],
      ['Death Note', 1, 2, 1]
    ]);
  });

  it('still lists one card per show by default', () => {
    const items = app.repo.series({ type: 'show' }).items;
    expect(items.map((s) => [s.title, s.season, s.episodeCount])).toEqual([['Black Clover', null, 6], ['Death Note', null, 2]]);
  });

  it('borrows the show art for a season that has none', () => {
    const items = app.repo.series({ type: 'show', bySeason: true }).items.filter((s) => s.title === 'Black Clover');
    expect(items.every((s) => s.artMediaId != null)).toBe(true);
  });
});
