import { extOf, kindOfExt } from './formats';

/** What a dropped path turned out to be on disk. */
export interface DroppedPath {
  path: string;
  kind: 'file' | 'folder' | 'missing';
}

export interface DropRoot { path: string; name: string }

export interface DropPlan {
  /** Supported media files: opened straight away. */
  play: string[];
  /** Folders that are not yet part of the library. */
  add: string[];
  /** Folders already inside the library, with the library folder that holds them. */
  covered: { path: string; root: string }[];
  /** Folders being added that contain a library folder already (adding them would list items twice). */
  overlapping: string[];
  /** Files Gravity can't open, and paths that no longer exist. */
  ignored: string[];
}

const isWindowsPath = (p: string) => /^[a-z]:[\\/]/i.test(p) || p.startsWith('\\\\');

/** Compare-friendly form: forward slashes, no trailing slash, case-folded on Windows paths. */
export function canonicalPath(p: string): string {
  const slashed = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return isWindowsPath(p) ? slashed.toLowerCase() : slashed;
}

/** True when `child` is `parent` itself or lives below it. */
export function isWithin(child: string, parent: string): boolean {
  const c = canonicalPath(child);
  const p = canonicalPath(parent);
  return c === p || c.startsWith(`${p}/`);
}

/** Decide what to do with a drop: play files, offer new folders, and say why anything was skipped. */
export function planDrop(dropped: DroppedPath[], roots: DropRoot[]): DropPlan {
  const plan: DropPlan = { play: [], add: [], covered: [], overlapping: [], ignored: [] };
  const folders: string[] = [];
  for (const d of dropped) {
    if (d.kind === 'missing') plan.ignored.push(d.path);
    else if (d.kind === 'file') (kindOfExt(extOf(d.path)) ? plan.play : plan.ignored).push(d.path);
    else folders.push(d.path);
  }
  // Dropping a folder together with one of its sub-folders adds just the outer one.
  const unique = folders.filter((f, i) => !folders.some((g, j) => j !== i && (isWithin(f, g) && (canonicalPath(f) !== canonicalPath(g) || j < i))));
  for (const f of unique) {
    const holder = roots.find((r) => isWithin(f, r.path));
    if (holder) plan.covered.push({ path: f, root: holder.path });
    else {
      plan.add.push(f);
      if (roots.some((r) => isWithin(r.path, f))) plan.overlapping.push(f);
    }
  }
  return plan;
}
