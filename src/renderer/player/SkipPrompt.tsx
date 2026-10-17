import { SkipForward } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { resolveSegments, sanitizeMarkers, segmentAt, showKey } from '@shared/skip';
import { clearMarkers, markCredits, markIntroEnd, markIntroStart, skipNow, skipSegment } from '../lib/skip';
import { registerHandlers } from '../lib/hotkeys';
import { useVideoPlayer } from '../lib/video-engine';
import { useSettings } from '../state/settings';
import '../styles/skip.css';

/**
 * The "Skip Intro" / "Skip Credits" button, plus the commands for marking a show's intro and
 * credits so the other episodes get the button too. Mounted once inside the video player.
 */
export function SkipPrompt() {
  const item = useVideoPlayer((s) => s.item);
  const chapters = useVideoPlayer((s) => s.chapters);
  const duration = useVideoPlayer((s) => s.duration);
  const time = useVideoPlayer((s) => s.time);
  const upNext = useVideoPlayer((s) => s.upNext);
  const skip = useSettings((s) => s.settings.skip);
  const key = showKey(item);
  const saved = key ? sanitizeMarkers(skip.markers[key]) ?? undefined : undefined;
  const segments = useMemo(() => resolveSegments(chapters, duration, saved), [chapters, duration, saved?.intro?.start, saved?.intro?.end, saved?.credits?.fromEnd]); // eslint-disable-line react-hooks/exhaustive-deps
  const seg = segmentAt(segments, time);
  const done = useRef(new Set<string>());

  useEffect(() => registerHandlers({
    'video.skipSegment': skipNow,
    'video.markIntroStart': markIntroStart,
    'video.markIntroEnd': markIntroEnd,
    'video.markCredits': markCredits,
    'video.clearSkipMarkers': clearMarkers
  }), []);

  // Each segment is skipped automatically at most once per viewing, so rewinding into it works.
  useEffect(() => {
    if (!seg || !item) return;
    const auto = seg.kind === 'intro' ? skip.autoIntro : skip.autoCredits;
    const id = `${item.id}:${seg.kind}`;
    if (!auto || done.current.has(id)) return;
    done.current.add(id);
    skipSegment(seg);
  }, [seg?.kind, seg?.start, item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!seg || upNext) return null;
  return (
    <button type="button" className="skip-prompt" onClick={() => skipSegment(seg)} title="Skip ( Shift+K )">
      <SkipForward size={16} fill="currentColor" strokeWidth={0} />
      {seg.kind === 'intro' ? 'Skip Intro' : 'Skip Credits'}
    </button>
  );
}
