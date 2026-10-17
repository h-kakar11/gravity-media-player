import { Minus, Plus, RotateCcw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useDismiss } from '../lib/hooks';
import { SPEED_MAX, SPEED_MIN } from '../lib/video-engine';

const PRESETS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5];
const LN_MIN = Math.log(SPEED_MIN);
const LN_RANGE = Math.log(SPEED_MAX) - LN_MIN;
/** Pixels of dial travel per natural-log unit of speed: wide enough that fine control is easy. */
const PX_PER_LN = 150;

const snapStep = (v: number) => (v < 1 ? 0.01 : v < 2 ? 0.05 : v < 3 ? 0.1 : 0.25);
const quantise = (v: number) => {
  const s = snapStep(v);
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(v / s) * s));
};
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, ''));

/**
 * A scrubbable speed dial (0.1×–5×). The ruler slides under a fixed needle as you drag, on a
 * logarithmic scale so 0.5× and 2× are the same distance from 1×. Release near a preset and it snaps.
 */
export function SpeedDial({ value, onChange, onClose }: { value: number; onChange: (v: number) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; v: number } | null>(null);
  useDismiss(ref, onClose);

  // Position the ruler so the current value sits under the needle.
  useEffect(() => {
    if (strip.current) strip.current.style.transform = `translateX(${-(Math.log(value) - LN_MIN) * PX_PER_LN}px)`;
  }, [value]);

  const ticks: { v: number; major: boolean }[] = [];
  for (let v = 0.1; v <= 1; v += 0.05) ticks.push({ v: Math.round(v * 100) / 100, major: false });
  for (let v = 1.1; v <= 2; v += 0.1) ticks.push({ v: Math.round(v * 100) / 100, major: false });
  for (let v = 2.25; v <= 5; v += 0.25) ticks.push({ v: Math.round(v * 100) / 100, major: false });

  const snap = (v: number) => {
    const near = PRESETS.find((p) => Math.abs(Math.log(p) - Math.log(v)) < 0.035);
    return near ?? quantise(v);
  };

  return (
    <div className="speed" ref={ref} role="dialog" aria-label="Playback speed">
      <div className="speed__readout tabular" aria-live="polite">{fmt(value)}<span>×</span></div>
      <div
        className="speed__dial" role="slider" tabIndex={0} aria-label="Speed" aria-valuemin={SPEED_MIN} aria-valuemax={SPEED_MAX} aria-valuenow={value}
        onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, v: value }; }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          // Dragging left moves the ruler left, i.e. increases speed.
          const v = Math.exp(Math.log(drag.current.v) - (e.clientX - drag.current.x) / PX_PER_LN);
          onChange(quantise(v));
        }}
        onPointerUp={(e) => { if (!drag.current) return; (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); drag.current = null; onChange(snap(value)); }}
        onWheel={(e) => { e.preventDefault(); onChange(quantise(Math.exp(Math.log(value) + (e.deltaY + e.deltaX) / 600))); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); onChange(quantise(value - snapStep(value))); }
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); onChange(quantise(value + snapStep(value))); }
        }}
      >
        <div className="speed__needle" />
        <div className="speed__strip" ref={strip}>
          {ticks.map((t) => <i key={t.v} className="speed__tick" style={{ left: `${((Math.log(t.v) - LN_MIN) * PX_PER_LN)}px` }} />)}
          {PRESETS.map((p) => (
            <span key={p} className="speed__mark" style={{ left: `${(Math.log(p) - LN_MIN) * PX_PER_LN}px` }}>
              <i className="speed__tick speed__tick--major" />{fmt(p)}
            </span>
          ))}
        </div>
        <div className="speed__fade speed__fade--l" /><div className="speed__fade speed__fade--r" />
      </div>
      <div className="speed__chips" role="group" aria-label="Speed presets">
        {[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((p) => (
          <button key={p} type="button" className={`chip ${Math.abs(p - value) < 0.004 ? 'is-on' : ''}`} onClick={() => onChange(p)}>{fmt(p)}×</button>
        ))}
      </div>
      <div className="speed__nudge">
        <button type="button" className="btn btn--sm" onClick={() => onChange(quantise(value - 0.05))} aria-label="Slower by 0.05"><Minus size={14} /></button>
        <button type="button" className="btn btn--sm" onClick={() => onChange(1)}><RotateCcw size={13} /> Normal</button>
        <button type="button" className="btn btn--sm" onClick={() => onChange(quantise(value + 0.05))} aria-label="Faster by 0.05"><Plus size={14} /></button>
      </div>
      <div className="speed__hint t-footnote tertiary">Drag the dial · scroll · or use [ and ] · {fmt(SPEED_MIN)}× to {fmt(SPEED_MAX)}×</div>
    </div>
  );
}
