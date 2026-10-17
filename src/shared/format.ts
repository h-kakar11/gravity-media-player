/** Display helpers shared by renderer and main (log lines, notifications). */

export function formatDuration(totalSec: number, opts: { long?: boolean } = {}): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return opts.long ? '0 sec' : '0:00';
  const s = Math.floor(totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (opts.long) {
    if (h > 0) return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
    if (m > 0) return `${m} min`;
    return `${sec} sec`;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function formatHours(totalSec: number): string {
  const h = totalSec / 3600;
  if (h >= 100) return `${Math.round(h)}`;
  if (h >= 10) return h.toFixed(1);
  return h.toFixed(2);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(v >= 10 ? 1 : 2)} ${units[i]}`;
}

export function formatBitrate(bps: number): string {
  if (!bps) return '';
  return bps >= 1_000_000 ? `${(bps / 1_000_000).toFixed(1)} Mbps` : `${Math.round(bps / 1000)} kbps`;
}

export function formatRelativeTime(ms: number, now = Date.now()): string {
  const diff = Math.max(0, now - ms);
  const min = 60_000, hour = 60 * min, day = 24 * hour;
  if (diff < min) return 'Just now';
  if (diff < hour) return `${Math.floor(diff / min)} min ago`;
  if (diff < day) return `${Math.floor(diff / hour)} hr ago`;
  if (diff < 2 * day) return 'Yesterday';
  if (diff < 7 * day) return `${Math.floor(diff / day)} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatResolution(width: number, height: number): string {
  if (!width || !height) return '';
  const h = Math.max(height, Math.round((width * 9) / 16));
  if (h >= 4000) return '8K';
  if (h >= 2000) return '4K';
  if (h >= 1400) return '1440p';
  if (h >= 1000) return '1080p';
  if (h >= 700) return '720p';
  if (h >= 560) return '576p';
  if (h >= 460) return '480p';
  return `${height}p`;
}

export function formatFps(fps: number): string {
  if (!fps) return '';
  const r = Math.abs(fps - Math.round(fps)) < 0.02 ? String(Math.round(fps)) : fps.toFixed(3).replace(/0+$/, '');
  return `${r} fps`;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** "S01E04" style tag. */
export function episodeTag(season: number | null, episode: number | null): string {
  if (episode == null) return '';
  return season != null ? `S${pad2(season)}E${pad2(episode)}` : `E${pad2(episode)}`;
}
