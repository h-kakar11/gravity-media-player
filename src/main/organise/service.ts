import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { BIN_NAME, buildPlan, type BinItem, type OrgRow, type OrganiseJournalInfo, type OrganiseOptions, type OrganisePlan, type OrganiseResult } from '@shared/organise';
import type { Db } from '../db/database';
import type { Indexer } from '../library/indexer';
import type { LibraryRepo } from '../db/repo';
import type { AppPaths } from '../paths';

interface Journal {
  id: string; at: number; rootId: number; rootName: string; rootPath: string;
  moves: { from: string; to: string }[]; createdDirs: string[]; removedDirs: string[]; undone: boolean; binned?: number;
}

/** One entry of a library folder's `Gravity Bin/.gravity-bin.json`: where a binned file came from and where it sits now (paths relative to the library folder). */
interface BinRecord { id: string; from: string; bin: string; reason: string; at: number; extras: { from: string; bin: string }[] }

const MAX_JOURNALS = 20;
const toNative = (rel: string) => rel.split('/').join(sep);

/**
 * Renames and moves files inside a library folder into a tidy layout.
 * It never deletes a file: duplicates and leftovers go to the folder's Gravity Bin, from where the user restores or deletes them,
 * empty folders left behind are removed with rmdir (which refuses non-empty ones), and nothing is overwritten.
 * Every apply is journaled so it can be undone.
 */
export class OrganiseService {
  private file: string;
  constructor(private db: Db, private repo: LibraryRepo, private indexer: Indexer, paths: AppPaths) {
    this.file = join(paths.userData, 'organise-journal.json');
  }

  plan(o: OrganiseOptions): OrganisePlan {
    const root = this.repo.getRoot(o.rootId);
    if (!root) throw new Error('That folder is not in your library.');
    if (!root.online) throw new Error(`${root.name} is offline.`);
    const rows = this.db.all<Record<string, unknown>>(
      `SELECT m.*, mm.title AS ot, mm.year AS oy, sm.title AS os FROM media m
         LEFT JOIN meta_match mm ON mm.kind = 'movie' AND mm.key = CAST(m.id AS TEXT)
         LEFT JOIN meta_match sm ON sm.kind = 'series' AND sm.key = m.series_key
        WHERE m.root_id = ? AND m.missing = 0 AND m.kind IN ('video','audio')`, [root.id]);
    const s = (v: unknown) => (typeof v === 'string' && v ? v : null);
    const n = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : null);
    const orgRows: OrgRow[] = [];
    for (const r of rows) {
      const p = s(r.path);
      if (!p) continue;
      const rel = relative(root.path, p).split(sep).join('/');
      if (rel.startsWith('..')) continue;
      orgRows.push({
        id: n(r.id)!, rel, kind: String(r.kind), vclass: s(r.vclass), ext: String(r.ext ?? ''),
        title: s(r.title), series: s(r.series), season: n(r.season), episode: n(r.episode), year: n(r.year),
        artist: s(r.artist), albumArtist: s(r.album_artist), album: s(r.album), trackNo: n(r.track_no), discNo: n(r.disc_no),
        onlineTitle: s(r.ot), onlineYear: n(r.oy), onlineSeries: s(r.os),
        size: n(r.size), durationSec: n(r.duration), height: n(r.height), audioTracks: n(r.audio_tracks)
      });
    }
    const dirs = new Set(orgRows.map((r) => r.rel.includes('/') ? r.rel.slice(0, r.rel.lastIndexOf('/')) : ''));
    const siblings: string[] = [];
    for (const d of dirs) {
      try {
        for (const e of readdirSync(join(root.path, toNative(d)), { withFileTypes: true })) if (e.isFile()) siblings.push(d ? `${d}/${e.name}` : e.name);
      } catch { /* folder vanished; its files are skipped */ }
    }
    // Case-insensitive volumes treat "A.mkv" and "a.mkv" as one file, so compare names that way everywhere.
    return buildPlan(orgRows, o, root.path, siblings, (rel) => existsSync(join(root.path, toNative(rel))));
  }

  /** Apply the chosen entries (by media id). Anything that went stale since planning is skipped, never forced. */
  async apply(o: OrganiseOptions, ids: number[]): Promise<OrganiseResult> {
    const plan = this.plan(o);
    const root = this.repo.getRoot(o.rootId)!;
    const want = new Set(ids);
    const journal: Journal = { id: `${Date.now().toString(36)}`, at: Date.now(), rootId: root.id, rootName: root.name, rootPath: root.path, moves: [], createdDirs: [], removedDirs: [], undone: false, binned: 0 };
    const errors: string[] = [];
    const records: BinRecord[] = [];
    let moved = 0;
    let failed = 0;
    const touchedDirs = new Set<string>();

    const mkdirs = (dir: string) => {
      const missing: string[] = [];
      for (let d = dir; d.length > root.path.length && !existsSync(d); d = dirname(d)) missing.push(d);
      mkdirSync(dir, { recursive: true });
      journal.createdDirs.push(...missing.reverse());
    };

    // Bin first: a duplicate may be sitting on the name its better twin is about to take.
    const todo = plan.entries.filter((e) => (e.status === 'move' || e.status === 'bin') && want.has(e.id)).sort((a, b) => Number(b.status === 'bin') - Number(a.status === 'bin'));
    for (const e of todo) {
      const bin = e.status === 'bin';
      const done: { from: string; to: string }[] = [];
      try {
        for (const p of [{ from: e.from, to: e.to }, ...e.sidecars]) {
          const src = join(root.path, toNative(p.from));
          const to = bin ? this.freeName(root.path, p.to) : p.to;
          const dst = join(root.path, toNative(to));
          if (!existsSync(src)) throw new Error(`${p.from} is gone`);
          if (existsSync(dst) && dst.toLowerCase() !== src.toLowerCase()) throw new Error(`${p.to} already exists`);
          mkdirs(dirname(dst));
          renameSync(src, dst);
          done.push({ from: p.from, to });
          touchedDirs.add(dirname(src));
        }
        journal.moves.push(...done);
        if (bin) {
          journal.binned! += 1;
          records.push({ id: randomUUID(), from: e.from, bin: done[0]!.to, reason: e.reason ?? '', at: journal.at, extras: done.slice(1).map((d) => ({ from: d.from, bin: d.to })) });
        } else moved++;
      } catch (err) {
        for (const p of done.reverse()) { try { renameSync(join(root.path, toNative(p.to)), join(root.path, toNative(p.from))); } catch { /* best effort */ } }
        failed++;
        errors.push(`${e.from}: ${(err as Error).message}`);
      }
    }
    if (records.length > 0) this.saveBin(root.path, [...this.loadBin(root.path), ...records]);
    journal.removedDirs = this.pruneEmpty(root.path, touchedDirs);
    if (journal.moves.length === 0) return { moved, binned: 0, failed, errors, journalId: null };
    this.saveJournal(journal);
    await this.indexer.scanRoot(root.id);
    return { moved, binned: records.length, failed, errors, journalId: journal.id };
  }

  history(): OrganiseJournalInfo[] {
    return this.load().map((j) => ({ id: j.id, at: j.at, rootId: j.rootId, rootName: j.rootName, moved: j.moves.length, binned: j.binned ?? 0, undone: j.undone })).reverse();
  }

  async undo(id: string): Promise<OrganiseResult> {
    const all = this.load();
    const j = all.find((x) => x.id === id);
    if (!j) throw new Error('That tidy-up is no longer in the history.');
    if (j.undone) throw new Error('That tidy-up was already undone.');
    const errors: string[] = [];
    let moved = 0;
    let failed = 0;
    const settled = new Set<string>();
    for (const d of j.removedDirs) { try { mkdirSync(d, { recursive: true }); } catch { /* recreated below if needed */ } }
    for (const m of [...j.moves].reverse()) {
      const cur = join(j.rootPath, toNative(m.to));
      const orig = join(j.rootPath, toNative(m.from));
      const fromBin = m.to.startsWith(`${BIN_NAME}/`);
      try {
        if (!existsSync(cur)) {
          // Already put back by hand, or deleted from the bin on purpose: nothing left to undo.
          if (fromBin || existsSync(orig)) { settled.add(m.to); continue; }
          throw new Error(`${m.to} is no longer there`);
        }
        if (existsSync(orig) && orig.toLowerCase() !== cur.toLowerCase()) throw new Error(`${m.from} is occupied`);
        mkdirSync(dirname(orig), { recursive: true });
        renameSync(cur, orig);
        settled.add(m.to);
        moved++;
      } catch (err) { failed++; errors.push((err as Error).message); }
    }
    if (settled.size > 0) this.saveBin(j.rootPath, this.loadBin(j.rootPath).filter((r) => !settled.has(r.bin)));
    this.pruneEmpty(j.rootPath, new Set(j.createdDirs));
    j.undone = failed === 0;
    this.write(all);
    if (this.repo.getRoot(j.rootId)) await this.indexer.scanRoot(j.rootId);
    return { moved, binned: 0, failed, errors, journalId: j.id };
  }

  // ---- Gravity Bin -------------------------------------------------------

  /** Everything the tidy-up has put in this folder's Gravity Bin, newest first. */
  bin(rootId: number): BinItem[] {
    const root = this.repo.getRoot(rootId);
    if (!root || !root.online) return [];
    const size = (rel: string) => { try { return statSync(join(root.path, toNative(rel))).size; } catch { return -1; } };
    const items: BinItem[] = [];
    for (const r of this.loadBin(root.path)) {
      const own = size(r.bin);
      if (own < 0) continue; // taken out of the folder by hand
      items.push({ id: r.id, name: basename(r.from), from: r.from, reason: r.reason, at: r.at, size: own + r.extras.reduce((t, x) => t + Math.max(0, size(x.bin)), 0), extras: r.extras.length });
    }
    return items.sort((a, b) => b.at - a.at || a.name.localeCompare(b.name));
  }

  /** Put binned items back where they came from (next to the original name if that spot is taken now). */
  async binRestore(rootId: number, ids: string[]): Promise<OrganiseResult> {
    const root = this.binRoot(rootId);
    const want = new Set(ids);
    const keep: BinRecord[] = [];
    const touched = new Set<string>();
    const errors: string[] = [];
    let moved = 0;
    let failed = 0;
    for (const r of this.loadBin(root.path)) {
      if (!want.has(r.id)) { keep.push(r); continue; }
      try {
        for (const p of [{ from: r.from, bin: r.bin }, ...r.extras]) {
          const src = this.inBin(root.path, p.bin);
          if (!existsSync(src)) continue;
          const dst = join(root.path, toNative(this.freeName(root.path, p.from)));
          mkdirSync(dirname(dst), { recursive: true });
          renameSync(src, dst);
          touched.add(dirname(src));
        }
        moved++;
      } catch (err) { failed++; errors.push(`${r.from}: ${(err as Error).message}`); keep.push(r); }
    }
    this.saveBin(root.path, keep);
    this.pruneEmpty(root.path, touched);
    if (moved > 0) await this.indexer.scanRoot(root.id);
    return { moved, binned: 0, failed, errors, journalId: null };
  }

  /** Delete binned items for good. This is the only place the tidy-up removes a file, and only when asked to. */
  binDelete(rootId: number, ids: string[]): OrganiseResult {
    const root = this.binRoot(rootId);
    const want = new Set(ids);
    const keep: BinRecord[] = [];
    const touched = new Set<string>();
    const errors: string[] = [];
    let moved = 0;
    let failed = 0;
    for (const r of this.loadBin(root.path)) {
      if (!want.has(r.id)) { keep.push(r); continue; }
      try {
        for (const p of [r, ...r.extras]) {
          const abs = this.inBin(root.path, p.bin);
          rmSync(abs, { force: true });
          touched.add(dirname(abs));
        }
        moved++;
      } catch (err) { failed++; errors.push(`${r.from}: ${(err as Error).message}`); keep.push(r); }
    }
    this.saveBin(root.path, keep);
    this.pruneEmpty(root.path, touched);
    return { moved, binned: 0, failed, errors, journalId: null };
  }

  private binRoot(rootId: number) {
    const root = this.repo.getRoot(rootId);
    if (!root) throw new Error('That folder is not in your library.');
    if (!root.online) throw new Error(`${root.name} is offline.`);
    return root;
  }

  /** Absolute path of something inside the bin. Refuses anything that points elsewhere, since this is what deletes. */
  private inBin(rootPath: string, rel: string): string {
    if (!rel.startsWith(`${BIN_NAME}/`) || rel.split('/').includes('..')) throw new Error(`${rel} is not inside the Gravity Bin`);
    return join(rootPath, toNative(rel));
  }

  /** `rel`, or `name (2).ext`, `name (3).ext`… when that path is taken. */
  private freeName(rootPath: string, rel: string): string {
    if (!existsSync(join(rootPath, toNative(rel)))) return rel;
    const dot = rel.lastIndexOf('.');
    const [base, ext] = dot > rel.lastIndexOf('/') + 1 ? [rel.slice(0, dot), rel.slice(dot)] : [rel, ''];
    for (let i = 2; ; i++) {
      const cand = `${base} (${i})${ext}`;
      if (!existsSync(join(rootPath, toNative(cand)))) return cand;
    }
  }

  private binFile(rootPath: string) { return join(rootPath, BIN_NAME, '.gravity-bin.json'); }
  private loadBin(rootPath: string): BinRecord[] {
    try { const v = JSON.parse(readFileSync(this.binFile(rootPath), 'utf8')) as unknown; return Array.isArray(v) ? (v as BinRecord[]) : []; } catch { return []; }
  }
  /** An empty list removes the file so an empty Gravity Bin folder can go too. */
  private saveBin(rootPath: string, list: BinRecord[]) {
    try {
      if (list.length === 0) { unlinkSync(this.binFile(rootPath)); return; }
      mkdirSync(join(rootPath, BIN_NAME), { recursive: true });
      writeFileSync(this.binFile(rootPath), JSON.stringify(list));
    } catch { /* the files themselves are safe in the bin either way */ }
  }

  /** Remove directories that are now empty, deepest first, never above the library folder. rmdir fails on non-empty ones, which is the point. */
  private pruneEmpty(rootPath: string, dirs: Set<string>): string[] {
    const removed: string[] = [];
    const queue = [...dirs].filter((d) => d.startsWith(rootPath + sep)).sort((a, b) => b.length - a.length);
    for (const start of queue) {
      for (let d = start; d.startsWith(rootPath + sep); d = dirname(d)) {
        try { if (readdirSync(d).length > 0) break; rmdirSync(d); removed.push(d); } catch { break; }
      }
    }
    return removed;
  }

  private load(): Journal[] {
    try { const v = JSON.parse(readFileSync(this.file, 'utf8')) as unknown; return Array.isArray(v) ? (v as Journal[]) : []; } catch { return []; }
  }
  private write(list: Journal[]) { try { writeFileSync(this.file, JSON.stringify(list.slice(-MAX_JOURNALS))); } catch { /* history is a convenience */ } }
  private saveJournal(j: Journal) { this.write([...this.load(), j]); }
}
