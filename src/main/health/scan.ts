import { open, stat } from 'node:fs/promises';
import { episodeTag, formatBytes } from '../../shared/format';
import type {
  HealthFile, HealthFinding, HealthKind, HealthMissingEpisode, HealthReport, HealthScanOptions, HealthSeverity
} from '../../shared/health';
import type { Db } from '../db/database';
import { logger } from '../log';
import { compareQuality, describeQuality, effectiveBitrate, lowerQualityReasons } from './quality';

const log = logger('health');

/** Per-category cap so a pathological library cannot produce an unbounded report. */
export const MAX_FINDINGS = 1000;
/** How many gaps in one season are believable; beyond this the numbering scheme is probably different. */
const MAX_GAP = 100;
const CHECK_CONCURRENCY = 16;
const CHECK_TIMEOUT_MS = 15_000;
const ROOT_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// File checks (injectable so tests never depend on real permissions)

export type FileCheck =
  | { ok: true; size: number; isDir: boolean }
  | { ok: false; code: 'missing' | 'unreadable'; detail: string };

export type FileChecker = (path: string) => Promise<FileCheck>;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error(`${what} timed out`), { code: 'ETIMEDOUT' })), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** stat + a one-block read: catches missing files, permission errors and unreadable sectors without hashing anything. */
export const defaultFileChecker: FileChecker = async (path) => {
  try {
    const st = await withTimeout(stat(path), CHECK_TIMEOUT_MS, 'stat');
    if (st.isDirectory()) return { ok: true, size: 0, isDir: true };
    if (st.size > 0) {
      const fh = await withTimeout(open(path, 'r'), CHECK_TIMEOUT_MS, 'open');
      try { await withTimeout(fh.read(Buffer.alloc(512), 0, 512, 0), CHECK_TIMEOUT_MS, 'read'); } finally { await fh.close().catch(() => undefined); }
    }
    return { ok: true, size: st.size, isDir: false };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? '';
    if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: false, code: 'missing', detail: code };
    return { ok: false, code: 'unreadable', detail: code || (err as Error).message };
  }
};

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---------------------------------------------------------------------------
// Rows

type Row = Record<string, unknown>;
const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : d);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const nnum = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : null);

interface Entry {
  id: number;
  rootId: number;
  kind: string;
  vclass: string | null;
  path: string;
  fileName: string;
  title: string;
  size: number;
  durationSec: number;
  width: number;
  height: number;
  vcodec: string;
  bitrate: number;
  year: number | null;
  series: string | null;
  seriesKey: string | null;
  season: number | null;
  episode: number | null;
  /** `ino:dev` when the filesystem reported both, so hard links to one file are not counted as copies. */
  inode: string | null;
  missing: boolean;
}

const COLUMNS = `m.id, m.root_id, m.kind, m.vclass, m.path, m.file_name, m.title, m.size, m.duration, m.width, m.height,
  m.vcodec, m.bitrate, m.year, m.series, m.series_key, m.season, m.episode, m.ino, m.dev, m.missing`;

function toEntry(r: Row): Entry {
  const ino = str(r.ino), dev = str(r.dev);
  return {
    id: num(r.id), rootId: num(r.root_id), kind: str(r.kind), vclass: typeof r.vclass === 'string' ? r.vclass : null,
    path: str(r.path), fileName: str(r.file_name), title: str(r.title), size: num(r.size), durationSec: num(r.duration),
    width: num(r.width), height: num(r.height), vcodec: str(r.vcodec), bitrate: num(r.bitrate), year: nnum(r.year),
    series: typeof r.series === 'string' ? r.series : null, seriesKey: typeof r.series_key === 'string' ? r.series_key : null,
    season: nnum(r.season), episode: nnum(r.episode),
    inode: ino && ino !== '0' && dev ? `${ino}:${dev}` : null,
    missing: num(r.missing) === 1
  };
}

function toFile(e: Entry, extra: Partial<Pick<HealthFile, 'best' | 'lower' | 'reasons' | 'exists'>> = {}): HealthFile {
  const bitrate = effectiveBitrate(e);
  return {
    id: e.id, path: e.path, fileName: e.fileName, size: e.size, durationSec: e.durationSec, width: e.width, height: e.height,
    vcodec: e.vcodec, bitrate, quality: describeQuality(e), best: false, lower: false, reasons: [], exists: !e.missing, ...extra
  };
}

// ---------------------------------------------------------------------------
// Duplicates and lower-quality copies

/** Case-, accent- and punctuation-insensitive title key. */
export function titleKey(title: string): string {
  return title.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** "cd1", "part 2", "disc3": multi-part releases are not duplicates of each other. */
export function partMarker(fileName: string): string | null {
  const m = /(?:^|[\s._()[\-])(cd|disc|disk|part|pt)[\s._-]?(\d{1,2})(?=$|[\s._)\]\-])/i.exec(fileName.replace(/\.[^.]+$/, ''));
  return m ? `${m[1]!.toLowerCase().replace('disk', 'disc').replace('pt', 'part')}${Number(m[2])}` : null;
}

/**
 * Splits same-titled movies into per-year clusters. A file without a year joins the only year present,
 * but is never merged into a title that has several distinct years (it could be either film).
 */
function clusterByYear(items: Entry[]): { year: number | null; items: Entry[] }[] {
  const years = [...new Set(items.map((i) => i.year).filter((y): y is number => y != null))];
  const noYear = items.filter((i) => i.year == null);
  const clusters = years.map((year) => ({ year: year as number | null, items: items.filter((i) => i.year === year) }));
  if (noYear.length) {
    if (years.length === 1) clusters[0]!.items.push(...noYear);
    else clusters.push({ year: null, items: noYear });
  }
  return clusters;
}

interface DuplicateOut { findings: HealthFinding[]; truncated: boolean }

function duplicateFinding(id: string, kind: 'duplicate-movie' | 'duplicate-episode', title: string, items: Entry[], note: string): HealthFinding | null {
  // Hard links and other names for one inode are a single file on disk, not copies.
  if (items.every((i) => i.inode != null && i.inode === items[0]!.inode)) return null;
  const ranked = [...items].sort(compareQuality);
  const best = ranked[0]!;
  const seen = new Set<string>(best.inode ? [best.inode] : []);
  let reclaimable = 0;
  const files = ranked.map((e) => {
    if (e === best) return toFile(e, { best: true });
    const reasons = lowerQualityReasons(e, best);
    const lower = reasons.length > 0;
    if (!lower) reasons.push(e.size === best.size ? 'Same size and quality as the best copy' : 'Same resolution, codec and bitrate as the best copy');
    if (!e.inode || !seen.has(e.inode)) reclaimable += e.size;
    if (e.inode) seen.add(e.inode);
    return toFile(e, { reasons, lower });
  });
  const lowerCount = files.filter((f) => f.lower).length;
  const explanation = [
    `${items.length} files look like the same ${kind === 'duplicate-movie' ? 'movie' : 'episode'}.`,
    note,
    describeQuality(best) ? `Best copy: ${describeQuality(best)} (${best.fileName}).` : `Best copy: ${best.fileName}.`,
    lowerCount ? `${lowerCount} ${lowerCount === 1 ? 'copy is' : 'copies are'} lower quality.` : 'The copies are the same quality.',
    reclaimable > 0 ? `Keeping only the best copy would free ${formatBytes(reclaimable)}.` : ''
  ].filter(Boolean).join(' ');
  return {
    id, kind, category: 'duplicates', severity: reclaimable > 0 ? 'warning' : 'info', title, explanation, files, reclaimableBytes: reclaimable
  };
}

function findDuplicates(entries: Entry[]): DuplicateOut {
  const findings: HealthFinding[] = [];

  const movies = new Map<string, Entry[]>();
  for (const e of entries) {
    if (e.vclass !== 'movie') continue;
    const key = titleKey(e.title);
    if (!key) continue;
    const k = `${key}|${partMarker(e.fileName) ?? ''}`;
    (movies.get(k) ?? movies.set(k, []).get(k)!).push(e);
  }
  for (const [k, group] of movies) {
    if (group.length < 2) continue;
    for (const c of clusterByYear(group)) {
      if (c.items.length < 2) continue;
      const title = c.items.find((i) => i.year === c.year)?.title ?? c.items[0]!.title;
      const note = c.year == null
        ? 'Matched by title only — none of them has a year, so check they really are the same film.'
        : `Matched by title and year (${c.year}).`;
      const f = duplicateFinding(`dup-movie:${k}:${c.year ?? ''}`, 'duplicate-movie', c.year != null ? `${title} (${c.year})` : title, c.items, note);
      if (f) findings.push(f);
    }
  }

  const episodes = new Map<string, Entry[]>();
  for (const e of entries) {
    if (e.vclass !== 'episode' || !e.seriesKey || e.episode == null) continue;
    const k = `${e.seriesKey}|${e.season ?? 1}|${e.episode}|${partMarker(e.fileName) ?? ''}`;
    (episodes.get(k) ?? episodes.set(k, []).get(k)!).push(e);
  }
  for (const [k, group] of episodes) {
    if (group.length < 2) continue;
    const first = group[0]!;
    const f = duplicateFinding(`dup-episode:${k}`, 'duplicate-episode', `${first.series ?? first.seriesKey} · ${episodeTag(first.season ?? 1, first.episode)}`, group, 'Matched by show, season and episode number.');
    if (f) findings.push(f);
  }

  findings.sort((a, b) => b.reclaimableBytes - a.reclaimableBytes || a.title.localeCompare(b.title));
  const truncated = findings.length > MAX_FINDINGS;
  return { findings: truncated ? findings.slice(0, MAX_FINDINGS) : findings, truncated };
}

// ---------------------------------------------------------------------------
// Missing episodes

interface MetaEpisodes { bySeries: Map<string, Map<number, Map<number, { title: string | null; airDate: string | null }>>> }

/** Reads the synced episode list if the metadata feature's table exists; tolerates it being absent or a different shape. */
function loadMetaEpisodes(db: Db): MetaEpisodes | null {
  try {
    const cols = db.all<{ name: string }>(`PRAGMA table_info(meta_episode)`).map((c) => c.name);
    if (!['series_key', 'season', 'episode'].every((c) => cols.includes(c))) return null;
    const titleCol = cols.includes('title') ? 'title' : 'NULL';
    const airCol = cols.includes('air_date') ? 'air_date' : 'NULL';
    const rows = db.all<Row>(`SELECT series_key, season, episode, ${titleCol} AS title, ${airCol} AS air_date FROM meta_episode`);
    const bySeries: MetaEpisodes['bySeries'] = new Map();
    for (const r of rows) {
      const key = str(r.series_key);
      const season = nnum(r.season), episode = nnum(r.episode);
      if (!key || season == null || episode == null) continue;
      const seasons = bySeries.get(key) ?? bySeries.set(key, new Map()).get(key)!;
      const eps = seasons.get(season) ?? seasons.set(season, new Map()).get(season)!;
      eps.set(episode, { title: typeof r.title === 'string' && r.title ? r.title : null, airDate: typeof r.air_date === 'string' && r.air_date ? r.air_date : null });
    }
    return bySeries.size ? { bySeries } : null;
  } catch {
    return null; // table missing or unreadable: fall back to numbering gaps
  }
}

function findMissingEpisodes(entries: Entry[], meta: MetaEpisodes | null, today: string): DuplicateOut {
  const shows = new Map<string, { name: string; seasons: Map<number, Map<number, Entry>> }>();
  for (const e of entries) {
    if (e.vclass !== 'episode' || !e.seriesKey || e.episode == null) continue;
    const show = shows.get(e.seriesKey) ?? shows.set(e.seriesKey, { name: e.series ?? e.seriesKey, seasons: new Map() }).get(e.seriesKey)!;
    const season = e.season ?? 1;
    const eps = show.seasons.get(season) ?? show.seasons.set(season, new Map()).get(season)!;
    if (!eps.has(e.episode)) eps.set(e.episode, e);
  }

  const findings: HealthFinding[] = [];
  for (const [key, show] of shows) {
    const missing: HealthMissingEpisode[] = [];
    const anchors: Entry[] = [];
    let usedMeta = false;
    for (const [season, local] of [...show.seasons].sort((a, b) => a[0] - b[0])) {
      if (season === 0) continue; // specials are rarely numbered contiguously
      const expected = meta?.bySeries.get(key)?.get(season);
      const seasonMissing: HealthMissingEpisode[] = [];
      if (expected && expected.size > 0) {
        for (const [ep, info] of [...expected].sort((a, b) => a[0] - b[0])) {
          if (local.has(ep)) continue;
          if (info.airDate && info.airDate > today) continue; // not aired yet
          seasonMissing.push({ season, episode: ep, title: info.title });
        }
        if (seasonMissing.length) usedMeta = true;
      } else {
        const nums = [...local.keys()].sort((a, b) => a - b);
        for (let i = 1; i < nums.length; i++) {
          const gap = nums[i]! - nums[i - 1]! - 1;
          if (gap <= 0) continue;
          if (gap > MAX_GAP) { seasonMissing.length = 0; break; } // a different numbering scheme, not a gap
          for (let n = nums[i - 1]! + 1; n < nums[i]!; n++) seasonMissing.push({ season, episode: n, title: null });
        }
      }
      if (seasonMissing.length === 0) continue;
      missing.push(...seasonMissing);
      // Reveal target: the last local episode before the first gap, else the first local episode.
      const firstGap = seasonMissing[0]!.episode;
      const before = [...local].filter(([n]) => n < firstGap).sort((a, b) => b[0] - a[0])[0];
      anchors.push((before ?? [...local].sort((a, b) => a[0] - b[0])[0]!)[1]);
    }
    if (missing.length === 0) continue;
    const list = missing.slice(0, 12).map((m) => episodeTag(m.season, m.episode)).join(', ') + (missing.length > 12 ? `, and ${missing.length - 12} more` : '');
    findings.push({
      id: `missing:${key}`,
      kind: 'missing-episodes', category: 'missing', severity: usedMeta ? 'warning' : 'info',
      title: `${show.name} — ${missing.length} missing ${missing.length === 1 ? 'episode' : 'episodes'}`,
      explanation: `${usedMeta
        ? 'Compared with the episode list from your matched online source (episodes that have not aired yet are ignored).'
        : 'Found gaps in the episode numbering of the files you have; match the show online for a complete episode list.'} Missing: ${list}.`,
      files: anchors.slice(0, 6).map((e) => toFile(e)),
      missing, source: usedMeta ? 'metadata' : 'gaps', reclaimableBytes: 0
    });
  }
  findings.sort((a, b) => (b.missing?.length ?? 0) - (a.missing?.length ?? 0) || a.title.localeCompare(b.title));
  const truncated = findings.length > MAX_FINDINGS;
  return { findings: truncated ? findings.slice(0, MAX_FINDINGS) : findings, truncated };
}

// ---------------------------------------------------------------------------
// Problem files

interface RootInfo { id: number; name: string; path: string }

async function onlineRoots(roots: RootInfo[]): Promise<{ online: Set<number>; offline: RootInfo[] }> {
  const online = new Set<number>();
  const offline: RootInfo[] = [];
  await Promise.all(roots.map(async (r) => {
    try { await withTimeout(stat(r.path), ROOT_TIMEOUT_MS, 'stat'); online.add(r.id); } catch { offline.push(r); }
  }));
  return { online, offline };
}

function problem(kind: HealthKind, severity: HealthSeverity, e: Entry, title: string, explanation: string, exists = true): HealthFinding {
  return {
    id: `${kind}:${e.id}`, kind, category: 'files', severity, title, explanation,
    files: [toFile(e, { exists })], reclaimableBytes: 0
  };
}

async function findProblemFiles(entries: Entry[], online: Set<number>, check: FileChecker | null): Promise<{ findings: HealthFinding[]; checked: number }> {
  const findings: HealthFinding[] = [];
  const present = entries.filter((e) => online.has(e.rootId));

  // Disk check first: it also decides whether the database's idea of the file is still true.
  // A checker that throws is one more unreadable file, never a failed scan.
  const safeCheck = async (path: string): Promise<FileCheck> => {
    try { return await check!(path); } catch (err) { return { ok: false, code: 'unreadable', detail: (err as Error).message }; }
  };
  const results = check ? await mapPool(present.filter((e) => !e.missing), CHECK_CONCURRENCY, async (e) => [e.id, await safeCheck(e.path)] as const) : [];
  const disk = new Map(results);

  for (const e of present) {
    if (e.missing) {
      findings.push(problem('file-missing', 'warning', e, `${e.fileName} is missing`, 'This file was in your library but is no longer in its folder. It may have been moved, renamed or deleted outside Gravity. A rescan will clear it from the library.', false));
      continue;
    }
    const d = disk.get(e.id);
    if (d && !d.ok) {
      if (d.code === 'missing') findings.push(problem('file-missing', 'warning', e, `${e.fileName} is missing`, 'This file was in your library but is no longer on disk. It may have been moved, renamed or deleted outside Gravity. A rescan will clear it from the library.', false));
      else findings.push(problem('unreadable', 'error', e, `${e.fileName} cannot be read`, `The file exists but could not be opened (${d.detail}). Check its permissions, that no other program has it locked, and that the drive is healthy.`));
      continue;
    }
    const size = d?.ok ? (d.isDir ? e.size : d.size) : e.size;
    if (size === 0 && !(d?.ok && d.isDir)) {
      findings.push(problem('zero-length', 'error', e, `${e.fileName} is empty`, 'The file has no data (0 bytes). It is probably the leftover of a failed download or copy and can be replaced or removed.'));
      continue;
    }
    if ((e.kind === 'video' || e.kind === 'audio') && e.durationSec === 0) {
      findings.push(problem('no-duration', 'warning', e, `${e.fileName} may be damaged`, 'Gravity could not read a playable length from this file. It may be truncated, corrupt or in an unsupported format.'));
    }
  }
  return { findings, checked: disk.size };
}

// ---------------------------------------------------------------------------

export interface HealthScannerDeps {
  checkFile?: FileChecker;
  now?: () => number;
}

export class HealthScanner {
  private inFlight: Promise<HealthReport> | null = null;

  constructor(private readonly db: Db, private readonly deps: HealthScannerDeps = {}) {}

  /** Concurrent callers share one scan, so a double-click does not stat the whole library twice. */
  scan(options: HealthScanOptions = {}): Promise<HealthReport> {
    if (!this.inFlight) {
      this.inFlight = this.run(options).finally(() => { this.inFlight = null; });
    }
    return this.inFlight;
  }

  private async run(options: HealthScanOptions): Promise<HealthReport> {
    const now = (this.deps.now ?? Date.now)();
    const warnings: string[] = [];
    const roots = this.db.all<Row>('SELECT id, name, path FROM roots').map((r): RootInfo => ({ id: num(r.id), name: str(r.name), path: str(r.path) }));
    const { online, offline } = await onlineRoots(roots);

    const entries = this.db.all<Row>(`SELECT ${COLUMNS} FROM media m`).map(toEntry);
    const live = entries.filter((e) => !e.missing);
    const counts = new Map<number, number>();
    for (const e of entries) counts.set(e.rootId, (counts.get(e.rootId) ?? 0) + 1);
    for (const r of offline) warnings.push(`“${r.name}” is offline, so its ${counts.get(r.id) ?? 0} files were not checked on disk.`);

    // Only compare video that is really there: a vanished copy is not a duplicate worth acting on.
    const offlineIds = new Set(offline.map((r) => r.id));
    const video = live.filter((e) => e.kind === 'video' && !offlineIds.has(e.rootId));
    const dups = findDuplicates(video);
    const gaps = findMissingEpisodes(live.filter((e) => e.kind === 'video'), loadMetaEpisodes(this.db), new Date(now).toISOString().slice(0, 10));
    const files = await findProblemFiles(entries, online, options.checkFiles === false ? null : (this.deps.checkFile ?? defaultFileChecker));

    const order: Record<HealthSeverity, number> = { error: 0, warning: 1, info: 2 };
    files.findings.sort((a, b) => order[a.severity] - order[b.severity] || a.title.localeCompare(b.title));
    const filesTruncated = files.findings.length > MAX_FINDINGS;
    const fileFindings = filesTruncated ? files.findings.slice(0, MAX_FINDINGS) : files.findings;

    const truncated = dups.truncated || gaps.truncated || filesTruncated;
    if (truncated) warnings.push(`Only the first ${MAX_FINDINGS} findings of a kind are shown. Fix some and scan again to see the rest.`);

    const findings = [...dups.findings, ...gaps.findings, ...fileFindings];
    const dupFiles = dups.findings.flatMap((f) => f.files);
    log.info(`scan: ${findings.length} findings, ${files.checked} files checked, ${warnings.length} warnings`);
    return {
      generatedAt: now,
      summary: {
        duplicateGroups: dups.findings.length,
        lowerQualityCopies: dupFiles.filter((f) => f.lower).length,
        reclaimableBytes: dups.findings.reduce((a, f) => a + f.reclaimableBytes, 0),
        missingEpisodes: gaps.findings.reduce((a, f) => a + (f.missing?.length ?? 0), 0),
        problemFiles: fileFindings.length,
        filesChecked: files.checked
      },
      findings,
      warnings,
      truncated
    };
  }
}
