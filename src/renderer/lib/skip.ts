import { resolveSegments, sanitizeMarkers, segmentAt, showKey, withCredits, withIntro, type SkipMarkers, type SkipSegment } from '@shared/skip';
import { formatDuration } from '@shared/format';
import { useSettings } from '../state/settings';
import { useVideoPlayer, videoEngine } from './video-engine';

/** The intro start the user has marked but not yet closed, for the item it was marked on. */
let pendingIntro: { itemId: number; start: number } | null = null;

const markersFor = (key: string | null): SkipMarkers | undefined => (key ? sanitizeMarkers(useSettings.getState().settings.skip.markers[key]) ?? undefined : undefined);

/** Skippable segments of what is playing now. */
export function currentSegments(): SkipSegment[] {
  const v = useVideoPlayer.getState();
  return resolveSegments(v.chapters, v.duration, markersFor(showKey(v.item)));
}

/** Jump past `seg`: the end of an intro, or on to the next episode for credits. */
export function skipSegment(seg: SkipSegment): void {
  const v = useVideoPlayer.getState();
  if (seg.kind === 'intro') v.seek(seg.end);
  else if (v.queue[v.index + 1] || v.item?.vclass === 'episode') v.next();
  else v.seek(Math.max(0, seg.end - 0.5));
  videoEngine.osd(seg.kind === 'intro' ? 'Skipped intro' : 'Skipped credits');
}

export function skipNow(): void {
  const seg = segmentAt(currentSegments(), videoEngine.currentTime);
  if (!seg) { videoEngine.osd('Nothing to skip here'); return; }
  skipSegment(seg);
}

function save(key: string, markers: SkipMarkers): void {
  useSettings.getState().update({ skip: { markers: { [key]: markers } } });
}

/** Everything the mark/forget commands need, or an on-screen explanation of why not. */
function target(): { key: string; name: string; time: number; duration: number; itemId: number } | null {
  const v = useVideoPlayer.getState();
  const key = showKey(v.item);
  if (!v.item || !key) { videoEngine.osd('Skip markers are remembered for episodes of a show'); return null; }
  return { key, name: v.item.series ?? '', time: videoEngine.currentTime, duration: v.duration, itemId: v.item.id };
}

export function markIntroStart(): void {
  const t = target();
  if (!t) return;
  pendingIntro = { itemId: t.itemId, start: t.time };
  videoEngine.osd(`Intro starts at ${formatDuration(t.time)} — mark its end next`);
}

export function markIntroEnd(): void {
  const t = target();
  if (!t) return;
  if (!pendingIntro || pendingIntro.itemId !== t.itemId) { videoEngine.osd('Mark where the intro starts first'); return; }
  const r = withIntro(markersFor(t.key), pendingIntro.start, t.time);
  if (!r.ok) { videoEngine.osd(r.reason); return; }
  save(t.key, r.markers);
  videoEngine.osd(`Intro ${formatDuration(pendingIntro.start)}–${formatDuration(t.time)} remembered for ${t.name}`);
  pendingIntro = null;
}

export function markCredits(): void {
  const t = target();
  if (!t) return;
  const r = withCredits(markersFor(t.key), t.time, t.duration);
  if (!r.ok) { videoEngine.osd(r.reason); return; }
  save(t.key, r.markers);
  videoEngine.osd(`Credits remembered for ${t.name}`);
}

export function clearMarkers(): void {
  const t = target();
  if (!t) return;
  save(t.key, {});
  videoEngine.osd(`Forgot skip markers for ${t.name}`);
}
