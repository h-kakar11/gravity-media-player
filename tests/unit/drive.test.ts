import { describe, expect, it } from 'vitest';
import { DriveDetector, majorMinor, parseDfDevice, parseDiskutil } from '../../src/main/library/drive';

describe('drive detection helpers', () => {
  it('decodes Linux device numbers', () => {
    // /dev/sda1 is 8:1, /dev/nvme0n1p2 is 259:2, device-mapper dm-0 is 253:0
    expect(majorMinor(0x801n)).toEqual([8, 1]);
    expect(majorMinor((259n << 8n) | 2n)).toEqual([259, 2]);
    expect(majorMinor(253n << 8n)).toEqual([253, 0]);
    // Large minors spill into the upper bits of st_dev
    expect(majorMinor((8n << 8n) | 0x45n | (0x1n << 20n))).toEqual([8, 0x45 | (0x1 << 8)]);
  });

  it('reads diskutil output', () => {
    expect(parseDiskutil('   Device Location:   Internal\n   Solid State:   Yes\n')).toBe('ssd');
    expect(parseDiskutil('   Solid State:   No\n')).toBe('hdd');
    expect(parseDiskutil('nothing useful')).toBe('unknown');
  });

  it('finds the device in df output', () => {
    expect(parseDfDevice('Filesystem 512-blocks Used Available Capacity Mounted on\n/dev/disk3s5 1953595632 100 200 1% /System/Volumes/Data\n')).toBe('/dev/disk3s5');
    expect(parseDfDevice('Filesystem 512-blocks\nserver:/share 1 2 3 4% /Volumes/share\n')).toBeNull();
  });

  it('identifies a real folder without throwing, and remembers the answer', async () => {
    const d = new DriveDetector();
    const first = await d.kindFor(process.cwd());
    expect(['hdd', 'ssd', 'unknown']).toContain(first);
    expect(d.cached(process.cwd())).toBe(first);
    expect(await d.kindFor('/definitely/not/a/real/path')).toBe('unknown');
  });
});
