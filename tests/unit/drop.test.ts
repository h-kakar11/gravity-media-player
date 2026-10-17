import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { canonicalPath, isWithin, planDrop, type DroppedPath } from '@shared/drop';
import { classifyPaths } from '../../src/main/library/drop';

const folder = (path: string): DroppedPath => ({ path, kind: 'folder' });
const file = (path: string): DroppedPath => ({ path, kind: 'file' });
const roots = [{ path: '/media/movies', name: 'movies' }];

describe('drop planning', () => {
  it('plays supported files and ignores the rest', () => {
    const plan = planDrop([file('/x/a.mkv'), file('/x/notes.txt'), { path: '/x/gone.mp4', kind: 'missing' }], roots);
    expect(plan.play).toEqual(['/x/a.mkv']);
    expect(plan.ignored).toEqual(['/x/notes.txt', '/x/gone.mp4']);
    expect(plan.add).toEqual([]);
  });

  it('offers new folders and reports ones already in the library', () => {
    const plan = planDrop([folder('/media/music'), folder('/media/movies'), folder('/media/movies/Action')], roots);
    expect(plan.add).toEqual(['/media/music']);
    // The sub-folder is folded into the outer one that was dropped with it.
    expect(plan.covered).toEqual([{ path: '/media/movies', root: '/media/movies' }]);
    expect(planDrop([folder('/media/movies/Action')], roots).covered).toEqual([{ path: '/media/movies/Action', root: '/media/movies' }]);
  });

  it('handles a mixed drop of files and folders', () => {
    const plan = planDrop([file('/x/a.mp3'), folder('/media/new')], roots);
    expect(plan.play).toEqual(['/x/a.mp3']);
    expect(plan.add).toEqual(['/media/new']);
  });

  it('adds only the outer folder when a folder and its sub-folder are dropped together', () => {
    const plan = planDrop([folder('/a/b/c'), folder('/a/b'), folder('/a/b/')], []);
    expect(plan.add).toEqual(['/a/b']);
  });

  it('warns when a new folder contains an existing library folder', () => {
    const plan = planDrop([folder('/media')], roots);
    expect(plan.add).toEqual(['/media']);
    expect(plan.overlapping).toEqual(['/media']);
  });

  it('does not treat a sibling with a shared prefix as inside a root', () => {
    expect(isWithin('/media/movies-extra', '/media/movies')).toBe(false);
    expect(planDrop([folder('/media/movies-extra')], roots).add).toEqual(['/media/movies-extra']);
  });

  it('compares Windows paths case-insensitively across slash styles', () => {
    expect(canonicalPath('D:\\Media\\Movies\\')).toBe('d:/media/movies');
    expect(isWithin('d:\\media\\movies\\Action', 'D:\\Media\\Movies')).toBe(true);
    expect(isWithin('/Media/Movies', '/media/movies')).toBe(false);
  });
});

describe('classifying dropped paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gravity-drop-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('tells files, folders and missing paths apart', async () => {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'a.mp4'), 'x');
    const out = await classifyPaths([join(dir, 'sub'), join(dir, 'a.mp4'), join(dir, 'nope')]);
    expect(out.map((o) => o.kind)).toEqual(['folder', 'file', 'missing']);
  });
});
