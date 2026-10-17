import { useEffect, useRef, useState } from 'react';
import { formatDuration } from '@shared/format';

/** Slim timeline for audio: smooth playhead via requestAnimationFrame, commit-on-release scrubbing. */
export function Scrubber({ duration, getTime, onSeek, label = 'Seek', showTimes = false, className = '' }: { duration: number; getTime: () => number; onSeek: (t: number) => void; label?: string; showTimes?: boolean; className?: string }) {
  const track = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const left = useRef<HTMLSpanElement>(null);
  const right = useRef<HTMLSpanElement>(null);
  const dragging = useRef<number | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const t = dragging.current ?? getTime();
      const p = duration > 0 ? Math.min(1, Math.max(0, t / duration)) : 0;
      if (fill.current) fill.current.style.transform = `scaleX(${p})`;
      if (knob.current) knob.current.style.left = `${p * 100}%`;
      if (left.current) left.current.textContent = formatDuration(t);
      if (right.current) right.current.textContent = `−${formatDuration(Math.max(0, duration - t))}`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [duration, getTime]);

  const at = (x: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (x - r.left) / r.width)) * duration;
  };

  return (
    <div className={`scrub ${active ? 'is-active' : ''} ${className}`}>
      {showTimes && <span className="scrub__time tabular" ref={left}>0:00</span>}
      <div
        className="scrub__hit" role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(getTime())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); onSeek(getTime() - 5); }
          if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); onSeek(getTime() + 5); }
        }}
        onPointerDown={(e) => { if (duration <= 0) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); dragging.current = at(e.clientX); setActive(true); }}
        onPointerMove={(e) => { if (dragging.current != null) dragging.current = at(e.clientX); }}
        onPointerUp={(e) => { if (dragging.current == null) return; (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); const t = at(e.clientX); dragging.current = null; setActive(false); onSeek(t); }}
        onPointerEnter={() => setActive(true)} onPointerLeave={() => { if (dragging.current == null) setActive(false); }}
      >
        <div className="scrub__track" ref={track}><div className="scrub__fill" ref={fill} /><div className="scrub__knob" ref={knob} /></div>
      </div>
      {showTimes && <span className="scrub__time tabular" ref={right}>−0:00</span>}
    </div>
  );
}
