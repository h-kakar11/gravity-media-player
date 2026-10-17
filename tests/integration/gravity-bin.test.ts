import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BIN_NAME, DEFAULT_ORGANISE } from '../../src/shared/organise';
import { OrganiseService } from '../../src/main/organise/service';
import { makeApp, sampleLibrary } from './helpers';

const app = makeApp();
let lib: string;
let rootId: number;
let svc: OrganiseService;
const source = () => join(sampleLibrary(), 'TV', 'Signal Lost', 'Season 1', 'Signal Lost - S01E01 - Pilot.mp4');
const KEEP = 'Signal Lost S01 1080p/s01e01.mp4';
const DUP = 'Signal Lost S01 720p/s01e01.mp4';
const kept = () => join(lib, 'Signal Lost', 'Season 01', 'Signal Lost - S01E01.mp4');
const o = () => ({ rootId, ...DEFAULT_ORGANISE });

/** Two byte-identical copies of one episode in differently named folders, a thumbnail and an unfinished download beside the duplicate. */
async function messy() {
  lib = join(mkdtempSync(join(tmpdir(), 'gravity-bin-')), 'library');
  for (const rel of [KEEP, DUP]) {
    mkdirSync(join(lib, rel, '..'), { recursive: true });
    copyFileSync(source(), join(lib, rel));
  }
  writeFileSync(join(lib, 'Signal Lost S01 720p', 's01e01-thumb.jpg'), 'thumb');
  writeFileSync(join(lib, 'Signal Lost S01 720p', 'other.f401.mp4.part'), 'half');
  const id = app.repo.addRoot(lib, `Bin Library ${Math.random()}`, 'auto');
  await app.indexer.scanRoot(id);
  rootId = id;
  svc = new OrganiseService(app.db, app.repo, app.indexer, app.paths);
}

beforeAll(() => { sampleLibrary(); }, 180_000);
beforeEach(messy, 60_000);

describe('Gravity Bin', () => {
  it('plans one keeper and sends the identical copy, its thumbnail and the partial download to the bin', () => {
    const plan = svc.plan(o());
    const bin = plan.entries.filter((e) => e.status === 'bin');
    expect(plan.entries.filter((e) => e.status === 'move')).toHaveLength(1);
    expect(bin.map((e) => e.from).sort()).toEqual([DUP, 'Signal Lost S01 720p/other.f401.mp4.part'].sort());
    expect(bin.find((e) => e.from === DUP)!.sidecars.map((s) => s.from)).toEqual(['Signal Lost S01 720p/s01e01-thumb.jpg']);
  });

  it('applies, lists the bin, keeps the bin out of the library and undoes', async () => {
    const plan = svc.plan(o());
    const res = await svc.apply(o(), plan.entries.filter((e) => e.status === 'move' || e.status === 'bin').map((e) => e.id));
    expect(res).toMatchObject({ moved: 1, binned: 2, failed: 0 });
    expect(existsSync(kept())).toBe(true);
    expect(existsSync(join(lib, BIN_NAME, DUP))).toBe(true);
    expect(existsSync(join(lib, BIN_NAME, 'Signal Lost S01 720p', 's01e01-thumb.jpg'))).toBe(true);
    expect(existsSync(join(lib, 'Signal Lost S01 720p'))).toBe(false);
    expect(existsSync(join(lib, 'Signal Lost S01 1080p'))).toBe(false);

    const items = svc.bin(rootId);
    expect(items.map((i) => i.from).sort()).toEqual([DUP, 'Signal Lost S01 720p/other.f401.mp4.part'].sort());
    expect(items.find((i) => i.from === DUP)).toMatchObject({ extras: 1, name: 's01e01.mp4' });
    expect(items.find((i) => i.from === DUP)!.size).toBeGreaterThan(0);

    // The library never lists what is in the bin, even after another scan.
    await app.indexer.scanRoot(rootId);
    const live = app.db.all<{ path: string }>('SELECT path FROM media WHERE root_id = ? AND missing = 0', [rootId]).map((r) => r.path);
    expect(live).toHaveLength(1);
    expect(live.some((p) => p.includes(BIN_NAME))).toBe(false);

    const undo = await svc.undo(res.journalId!);
    expect(undo.failed).toBe(0);
    expect(existsSync(join(lib, DUP))).toBe(true);
    expect(existsSync(join(lib, KEEP))).toBe(true);
    expect(existsSync(join(lib, 'Signal Lost S01 720p', 's01e01-thumb.jpg'))).toBe(true);
    expect(existsSync(join(lib, BIN_NAME))).toBe(false);
    expect(svc.bin(rootId)).toEqual([]);
  });

  it('restores a binned file to where it was', async () => {
    const plan = svc.plan(o());
    await svc.apply(o(), plan.entries.filter((e) => e.status === 'move' || e.status === 'bin').map((e) => e.id));
    const item = svc.bin(rootId).find((i) => i.from === DUP)!;
    const r = await svc.binRestore(rootId, [item.id]);
    expect(r).toMatchObject({ moved: 1, failed: 0 });
    expect(existsSync(join(lib, DUP))).toBe(true);
    expect(existsSync(join(lib, 'Signal Lost S01 720p', 's01e01-thumb.jpg'))).toBe(true);
    expect(existsSync(join(lib, BIN_NAME, DUP))).toBe(false);
    expect(svc.bin(rootId).map((i) => i.from)).toEqual(['Signal Lost S01 720p/other.f401.mp4.part']);
  });

  it('deletes only what the user chooses, and only from inside the bin', async () => {
    const plan = svc.plan(o());
    await svc.apply(o(), plan.entries.filter((e) => e.status === 'move' || e.status === 'bin').map((e) => e.id));
    const item = svc.bin(rootId).find((i) => i.from === DUP)!;
    const r = await svc.binDelete(rootId, [item.id]);
    expect(r).toMatchObject({ moved: 1, failed: 0 });
    expect(existsSync(join(lib, BIN_NAME, DUP))).toBe(false);
    expect(existsSync(kept())).toBe(true);
    expect(svc.bin(rootId)).toHaveLength(1);
    // Ids that are not in the bin are ignored rather than trusted.
    await svc.binDelete(rootId, ['../../' + KEEP, 'nope']);
    expect(existsSync(kept())).toBe(true);
    const rest = await svc.binDelete(rootId, svc.bin(rootId).map((i) => i.id));
    expect(rest.failed).toBe(0);
    expect(svc.bin(rootId)).toEqual([]);
    expect(readdirSync(lib).includes(BIN_NAME) ? readdirSync(join(lib, BIN_NAME)).filter((n) => n !== '.gravity-bin.json') : []).toEqual([]);
  });

  it('undo tolerates a file the user already restored or deleted from the bin', async () => {
    const plan = svc.plan(o());
    const res = await svc.apply(o(), plan.entries.filter((e) => e.status === 'move' || e.status === 'bin').map((e) => e.id));
    const items = svc.bin(rootId);
    await svc.binRestore(rootId, [items.find((i) => i.from === DUP)!.id]);
    await svc.binDelete(rootId, [items.find((i) => i.from !== DUP)!.id]);
    const undo = await svc.undo(res.journalId!);
    expect(undo.failed).toBe(0);
    expect(existsSync(join(lib, KEEP))).toBe(true);
    expect(existsSync(join(lib, DUP))).toBe(true);
  });
});
