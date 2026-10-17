import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ORGANISE } from '../../src/shared/organise';
import { OrganiseService } from '../../src/main/organise/service';
import { makeApp, sampleLibrary } from './helpers';

let app: ReturnType<typeof makeApp>;
let lib: string;
let rootId: number;
let svc: OrganiseService;

beforeAll(async () => {
  lib = join(mkdtempSync(join(tmpdir(), 'gravity-org-')), 'library');
  cpSync(sampleLibrary(), lib, { recursive: true });
  app = makeApp();
  rootId = app.repo.addRoot(lib, 'Org Library', 'auto');
  await app.indexer.scanRoot(rootId);
  svc = new OrganiseService(app.db, app.repo, app.indexer, app.paths);
}, 180_000);

describe('organiser', () => {
  it('previews without touching disk, applies, keeps play state and undoes', async () => {
    const o = { rootId, ...DEFAULT_ORGANISE };
    const before = readdirSync(lib, { recursive: true }).map(String).sort();
    const plan = svc.plan(o);
    expect(readdirSync(lib, { recursive: true }).map(String).sort()).toEqual(before);

    const ep = plan.entries.find((e) => e.to === 'Signal Lost/Season 01/Signal Lost - S01E01 - Pilot.mkv' || e.to.startsWith('Signal Lost/Season 01/Signal Lost - S01E01'));
    expect(ep).toBeTruthy();
    const movable = plan.entries.filter((e) => e.status === 'move');
    expect(movable.length).toBeGreaterThan(0);

    const id = ep!.status === 'move' ? ep!.id : movable[0]!.id;
    app.repo.getRow(id); // exists
    const res = await svc.apply(o, [id]);
    expect(res).toMatchObject({ moved: 1, failed: 0 });
    const moved = plan.entries.find((e) => e.id === id)!;
    expect(existsSync(join(lib, ...moved.to.split('/')))).toBe(true);
    expect(existsSync(join(lib, ...moved.from.split('/')))).toBe(false);
    // The library follows the file (same id, new path) instead of making a duplicate.
    expect(app.repo.get(id)!.path).toContain(moved.to.split('/').pop()!);

    const hist = svc.history();
    expect(hist[0]).toMatchObject({ moved: expect.any(Number), undone: false });
    const undo = await svc.undo(hist[0]!.id);
    expect(undo.failed).toBe(0);
    expect(existsSync(join(lib, ...moved.from.split('/')))).toBe(true);
    expect(existsSync(join(lib, ...moved.to.split('/')))).toBe(false);
    expect(svc.history()[0]!.undone).toBe(true);
  });

  it('never overwrites an existing file', async () => {
    const o = { rootId, ...DEFAULT_ORGANISE };
    const plan = svc.plan(o);
    const e = plan.entries.find((x) => x.status === 'move')!;
    const target = join(lib, ...e.to.split('/'));
    cpSync(join(lib, ...e.from.split('/')), join(lib, 'blocker.tmp'));
    // Occupy the destination after planning is stale: apply re-plans, so it reports a conflict instead.
    mkdirSync(join(target, '..'), { recursive: true });
    cpSync(join(lib, 'blocker.tmp'), target);
    writeFileSync(join(lib, 'blocker.tmp'), '');
    const res = await svc.apply(o, [e.id]);
    expect(res.moved).toBe(0);
    expect(existsSync(join(lib, ...e.from.split('/')))).toBe(true);
  });
});
