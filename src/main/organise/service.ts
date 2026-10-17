import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { buildPlan, type OrgRow, type OrganiseJournalInfo, type OrganiseOptions, type OrganisePlan, type OrganiseResult } from '@shared/organise';
import type { Db } from '../db/database';
import type { Indexer } from '../library/indexer';
import type { LibraryRepo } from '../db/repo';
import type { AppPaths } from '../paths';

interface Journal {
  id: string; at: number; rootId: number; rootName: string; rootPath: string;
  moves: { from: string; to: string }[]; createdDirs: string[]; removedDirs: string[]; undone: boolean;
}

const MAX_JOURNALS = 20;
const toNative = (rel: string) => rel.split('/').join(sep);

/**
 * Renames and moves files inside a library folder into a tidy layout.
 * It never deletes a file: empty folders left behind are removed with rmdir (which refuses non-empty ones),
 * and nothing is overwritten. Every apply is journaled so it can be undone.
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
        onlineTitle: s(r.ot), onlineYear: n(r.oy), onlineSeries: s(r.os)
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
    const journal: Journal = { id: `${Date.now().toString(36)}`, at: Date.now(), rootId: root.id, rootName: root.name, rootPath: root.path, moves: [], createdDirs: [], removedDirs: [], undone: false };
    const errors: string[] = [];
    let moved = 0;
    let failed = 0;
    const touchedDirs = new Set<string>();

    const mkdirs = (dir: string) => {
      const missing: string[] = [];
      for (let d = dir; d.length > root.path.length && !existsSync(d); d = dirname(d)) missing.push(d);
      mkdirSync(dir, { recursive: true });
      journal.createdDirs.push(...missing.reverse());
    };

    for (const e of plan.entries) {
      if (e.status !== 'move' || !want.has(e.id)) continue;
      const pairs = [{ from: e.from, to: e.to }, ...e.sidecars];
      const done: { from: string; to: string }[] = [];
      try {
        for (const p of pairs) {
          const src = join(root.path, toNative(p.from));
          const dst = join(root.path, toNative(p.to));
          if (!existsSync(src)) throw new Error(`${p.from} is gone`);
          if (existsSync(dst) && dst.toLowerCase() !== src.toLowerCase()) throw new Error(`${p.to} already exists`);
          mkdirs(dirname(dst));
          renameSync(src, dst);
          done.push(p);
          touchedDirs.add(dirname(src));
        }
        journal.moves.push(...done);
        moved++;
      } catch (err) {
        for (const p of done.reverse()) { try { renameSync(join(root.path, toNative(p.to)), join(root.path, toNative(p.from))); } catch { /* best effort */ } }
        failed++;
        errors.push(`${e.from}: ${(err as Error).message}`);
      }
    }
    journal.removedDirs = this.pruneEmpty(root.path, touchedDirs);
    if (journal.moves.length === 0) return { moved, failed, errors, journalId: null };
    this.saveJournal(journal);
    await this.indexer.scanRoot(root.id);
    return { moved, failed, errors, journalId: journal.id };
  }

  history(): OrganiseJournalInfo[] {
    return this.load().map((j) => ({ id: j.id, at: j.at, rootId: j.rootId, rootName: j.rootName, moved: j.moves.length, undone: j.undone })).reverse();
  }

  async undo(id: string): Promise<OrganiseResult> {
    const all = this.load();
    const j = all.find((x) => x.id === id);
    if (!j) throw new Error('That tidy-up is no longer in the history.');
    if (j.undone) throw new Error('That tidy-up was already undone.');
    const errors: string[] = [];
    let moved = 0;
    let failed = 0;
    for (const d of j.removedDirs) { try { mkdirSync(d, { recursive: true }); } catch { /* recreated below if needed */ } }
    for (const m of [...j.moves].reverse()) {
      const cur = join(j.rootPath, toNative(m.to));
      const orig = join(j.rootPath, toNative(m.from));
      try {
        if (!existsSync(cur)) throw new Error(`${m.to} is no longer there`);
        if (existsSync(orig) && orig.toLowerCase() !== cur.toLowerCase()) throw new Error(`${m.from} is occupied`);
        mkdirSync(dirname(orig), { recursive: true });
        renameSync(cur, orig);
        moved++;
      } catch (err) { failed++; errors.push((err as Error).message); }
    }
    this.pruneEmpty(j.rootPath, new Set(j.createdDirs));
    j.undone = failed === 0;
    this.write(all);
    if (this.repo.getRoot(j.rootId)) await this.indexer.scanRoot(j.rootId);
    return { moved, failed, errors, journalId: j.id };
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
