import { execFile } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logger } from '../log';

const log = logger('drive');

export type DriveKind = 'hdd' | 'ssd' | 'unknown';

/** Split a Linux `st_dev` into its major and minor numbers (glibc's encoding). */
export function majorMinor(dev: bigint): [number, number] {
  const major = Number(((dev >> 8n) & 0xfffn) | ((dev >> 32n) & ~0xfffn));
  const minor = Number((dev & 0xffn) | ((dev >> 12n) & ~0xffn));
  return [major, minor];
}

/** "Solid State: Yes" from `diskutil info`. */
export function parseDiskutil(out: string): DriveKind {
  const m = /Solid State:\s*(Yes|No)/i.exec(out);
  return m ? (m[1]!.toLowerCase() === 'yes' ? 'ssd' : 'hdd') : 'unknown';
}

/** Device column of the last line of `df -P <path>`. */
export function parseDfDevice(out: string): string | null {
  const line = out.trim().split('\n').pop() ?? '';
  const dev = line.split(/\s+/)[0];
  return dev && dev.startsWith('/dev/') ? dev : null;
}

const run = (file: string, args: string[]): Promise<string> =>
  new Promise((resolve) => execFile(file, args, { timeout: 8000, windowsHide: true }, (err, out) => resolve(err ? '' : String(out))));

async function linuxKind(path: string): Promise<DriveKind> {
  const st = await stat(path, { bigint: true });
  const [major, minor] = majorMinor(st.dev);
  if (major === 0) return 'unknown'; // anonymous devices (btrfs, overlay, network shares)
  // /sys/dev/block/M:m points at the partition; `queue/rotational` lives on the disk above it.
  let dir = await realpath(`/sys/dev/block/${major}:${minor}`);
  for (let i = 0; i < 3; i++) {
    try {
      const v = (await readFile(join(dir, 'queue', 'rotational'), 'utf8')).trim();
      return v === '1' ? 'hdd' : v === '0' ? 'ssd' : 'unknown';
    } catch { dir = dirname(dir); }
  }
  return 'unknown';
}

async function macKind(path: string): Promise<DriveKind> {
  const dev = parseDfDevice(await run('df', ['-P', path]));
  return dev ? parseDiskutil(await run('diskutil', ['info', dev])) : 'unknown';
}

async function windowsKind(path: string): Promise<DriveKind> {
  const letter = /^([a-z]):[\\/]/i.exec(path)?.[1];
  if (!letter) return 'unknown'; // UNC paths and network drives
  const script = `(Get-Partition -DriveLetter '${letter.toUpperCase()}' | Get-Disk | Get-PhysicalDisk).MediaType`;
  const out = (await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])).trim().toUpperCase();
  return out === 'HDD' ? 'hdd' : out === 'SSD' || out === 'SCM' ? 'ssd' : 'unknown';
}

/**
 * Finds out whether a folder lives on a spinning disk, so scanning can read one directory at a
 * time there (avoiding head seeks) and in parallel on flash. Detection asks the operating system
 * once per folder and remembers the answer; anything it can't determine (network shares, virtual
 * disks, an unsupported platform) is `unknown`, which gets a middle-of-the-road setting.
 */
export class DriveDetector {
  private readonly known = new Map<string, DriveKind>();
  private readonly pending = new Map<string, Promise<DriveKind>>();

  async kindFor(path: string): Promise<DriveKind> {
    const hit = this.known.get(path);
    if (hit) return hit;
    let p = this.pending.get(path);
    if (!p) {
      p = this.detect(path).then((k) => { this.known.set(path, k); this.pending.delete(path); log.info(`${path}: ${k === 'unknown' ? 'drive type unknown' : k === 'hdd' ? 'spinning disk' : 'solid state'}`); return k; });
      this.pending.set(path, p);
    }
    return p;
  }

  /** The last answer for a folder without waiting (`unknown` until it has been asked). */
  cached(path: string): DriveKind { return this.known.get(path) ?? 'unknown'; }

  anyRotational(): boolean { return [...this.known.values()].includes('hdd'); }
  allSolidState(): boolean { const v = [...this.known.values()]; return v.length > 0 && v.every((k) => k === 'ssd'); }

  forget(path: string): void { this.known.delete(path); }

  private async detect(path: string): Promise<DriveKind> {
    try {
      if (process.platform === 'linux') return await linuxKind(path);
      if (process.platform === 'darwin') return await macKind(path);
      if (process.platform === 'win32') return await windowsKind(path);
    } catch (err) {
      log.warn(`Could not identify the drive for ${path}:`, (err as Error).message);
    }
    return 'unknown';
  }
}

export const drives = new DriveDetector();
