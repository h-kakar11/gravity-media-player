import { useEffect, useRef, useState } from 'react';
import { formatDuration } from '@shared/format';
import { chapterIndexAt, snapToChapter, spriteFrame } from '@shared/chapters';
import type { ChapterInfo, SpriteSheet } from '@shared/types';
import '../styles/chapter-thumbs.css';

interface Props {
  duration: number;
  /** Current media time, read every animation frame so the playhead is as smooth as the display allows. */
  getTime: () => number;
  buffered: [number, number][];
  chapters: ChapterInfo[];
  sprite: SpriteSheet | null;
  onSeek: (t: number) => void;
  /** Reports when the user is scrubbing so the controls stay visible. */
  onInteract?: (active: boolean) => void;
  label?: string;
  previews?: boolean;
  compact?: boolean;
}

/**
 * Timeline with buffered ranges, chapter ticks and hover thumbnails.
 * While dragging, the preview follows the pointer and playback jumps once on release — this keeps
 * converted (transcoded) streams from restarting dozens of times during a scrub.
 */
export function SeekBar({ duration, getTime, buffered, chapters, sprite, onSeek, onInteract, label = 'Seek', previews = true, compact }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; t: number; snapped: boolean } | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const dragging = useRef(false);

  // Smooth playhead: update styles directly each frame instead of re-rendering React.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const t = dragging.current && drag != null ? drag : getTime();
      const p = duration > 0 ? Math.min(1, Math.max(0, t / duration)) : 0;
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${p})`;
      if (thumbRef.current) thumbRef.current.style.left = `${p * 100}%`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [duration, getTime, drag]);

  /** Pointer position as a time on the bar; near a chapter boundary it snaps to the chapter start. */
  const timeAt = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const raw = p * duration;
    const snap = snapToChapter(chapters, raw, duration, r.width);
    if (snap == null) return { p, t: raw, x: p * r.width, snapped: false };
    const t = chapters[snap]!.startSec;
    return { p: t / duration, t, x: (t / duration) * r.width, snapped: true };
  };

  const chapterAt = (t: number) => [...chapters].reverse().find((c) => t >= c.startSec)?.title;

  const preview = hover && previews && sprite && duration > 0 ? spriteFrame(sprite, hover.t) : null;
  const hotChapter = hover && chapters.length > 1 ? chapterIndexAt(chapters, hover.t) : -1;

  const trackW = trackRef.current?.clientWidth ?? 0;
  const tipW = sprite ? sprite.thumbWidth : 90;
  const tipLeft = hover ? Math.min(Math.max(hover.x - tipW / 2, 0), Math.max(0, trackW - tipW)) : 0;

  return (
    <div
      className={`seek ${compact ? 'seek--compact' : ''} ${hover || drag != null ? 'is-active' : ''}`}
      role="slider" aria-label={label} aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(getTime())} aria-valuetext={`${formatDuration(getTime())} of ${formatDuration(duration)}`} tabIndex={0}
      onPointerMove={(e) => { const r = timeAt(e.clientX); setHover(r); if (dragging.current) setDrag(r.t); }}
      onPointerLeave={() => { if (!dragging.current) setHover(null); }}
      onPointerDown={(e) => {
        if (duration <= 0) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        dragging.current = true;
        onInteract?.(true);
        setDrag(timeAt(e.clientX).t);
      }}
      onPointerUp={(e) => {
        if (!dragging.current) return;
        dragging.current = false;
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        const t = timeAt(e.clientX).t;
        setDrag(null);
        onInteract?.(false);
        onSeek(t);
      }}
      onPointerCancel={() => { dragging.current = false; setDrag(null); onInteract?.(false); }}
    >
      {hover && duration > 0 && (
        <div className="seek__tip" style={{ left: tipLeft, width: preview ? tipW : undefined }}>
          {preview && sprite && <div className="seek__thumb" style={{ width: sprite.thumbWidth, height: sprite.thumbHeight, backgroundImage: `url(${preview.url})`, backgroundPosition: `${preview.x}px ${preview.y}px` }} />}
          {chapterAt(hover.t) && <div className="seek__chapter">{chapterAt(hover.t)}</div>}
          <div className="seek__time tabular">{formatDuration(drag != null ? drag : hover.t)}</div>
        </div>
      )}
      <div className="seek__track" ref={trackRef}>
        {buffered.map(([a, b], i) => <div key={i} className="seek__buffer" style={{ left: `${(a / duration) * 100}%`, width: `${((b - a) / duration) * 100}%` }} />)}
        {hotChapter >= 0 && (
          <div className="seek__seg" style={{ left: `${(chapters[hotChapter]!.startSec / duration) * 100}%`, width: `${(((chapters[hotChapter]!.endSec > chapters[hotChapter]!.startSec ? chapters[hotChapter]!.endSec : duration) - chapters[hotChapter]!.startSec) / duration) * 100}%` }} />
        )}
        <div className="seek__fill" ref={fillRef} />
        {chapters.slice(1).map((c) => <span key={c.startSec} className={`seek__tick ${hover?.snapped && hover.t === c.startSec ? 'is-snapped' : ''}`} style={{ left: `${(c.startSec / duration) * 100}%` }} />)}
        <div className="seek__knob" ref={thumbRef} />
      </div>
    </div>
  );
}
