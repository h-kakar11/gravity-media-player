import { episodeTag, formatDuration, formatFps, formatResolution } from '@shared/format';
import type { MediaItem } from '@shared/types';

export function displayTitle(m: MediaItem): string {
  if (m.kind === 'video' && m.vclass === 'episode') return m.title;
  return m.title;
}

/** Second line under a card: the most useful context for the kind of media. */
export function subtitleFor(m: MediaItem): string {
  switch (m.kind) {
    case 'audio': return [m.artist ?? m.albumArtist, m.album].filter(Boolean).join(' — ') || 'Unknown Artist';
    case 'video':
      if (m.vclass === 'episode') return [m.series, episodeTag(m.season, m.episode)].filter(Boolean).join(' · ');
      return [m.year, m.durationSec ? formatDuration(m.durationSec, { long: true }) : ''].filter(Boolean).join(' · ');
    case 'comic': return [m.season != null ? `Vol. ${m.season}` : '', m.episode != null ? `Ch. ${m.episode}` : '', m.pages ? `${m.pages} pages` : ''].filter(Boolean).join(' · ');
    case 'book': return m.artist ?? '';
    case 'image': return m.width ? `${m.width} × ${m.height}` : '';
  }
}

export function techBadges(m: MediaItem): string[] {
  if (m.kind !== 'video') return [];
  const out: string[] = [];
  const res = formatResolution(m.width, m.height);
  if (res) out.push(res);
  if (m.hdr) out.push('HDR');
  if (m.fps >= 48) out.push(formatFps(m.fps));
  if (m.vcodec) out.push(m.vcodec.toUpperCase().replace('HEVC', 'HEVC'));
  if (m.audioTrackCount > 1) out.push(`${m.audioTrackCount} audio`);
  if (m.subtitleTrackCount > 0) out.push('CC');
  return out;
}

export function resumeLabel(m: MediaItem): string | null {
  if (m.completed || m.positionSec < 10 || !m.durationSec) return null;
  const left = Math.max(0, m.durationSec - m.positionSec);
  return `${formatDuration(left, { long: true })} left`;
}

export function kindLabel(m: MediaItem): string {
  switch (m.kind) {
    case 'video': return m.vclass === 'episode' ? 'Episode' : m.vclass === 'movie' ? 'Movie' : 'Video';
    case 'audio': return 'Song';
    case 'image': return m.ext === 'gif' ? 'GIF' : 'Image';
    case 'comic': return 'Comic';
    case 'book': return 'Book';
  }
}

export const isPlayable = (m: MediaItem) => m.kind === 'video' || m.kind === 'audio';
export const isReadable = (m: MediaItem) => m.kind === 'comic' || m.kind === 'book' || m.kind === 'image';

export function artistOf(m: MediaItem): string {
  return m.artist ?? m.albumArtist ?? 'Unknown Artist';
}

export function albumKeyOf(m: MediaItem): string {
  return `${(m.albumArtist || m.artist || '').toLowerCase()}\u0001${(m.album ?? '').toLowerCase()}`;
}

export function artistKeyOf(m: MediaItem): string {
  return (m.albumArtist || m.artist || '').toLowerCase();
}

export function seriesKeyOf(m: MediaItem): string {
  return (m.series ?? '').toLowerCase();
}
