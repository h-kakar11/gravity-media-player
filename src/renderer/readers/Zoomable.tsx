import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Reset zoom/pan when this value changes (e.g. the page index). */
  resetKey: unknown;
  maxZoom?: number;
  zoom: number;
  onZoom: (z: number) => void;
  /** Click without drag (for page-turn zones). */
  onTap?: (x: number, width: number) => void;
  className?: string;
}

/**
 * Pinch/scroll-wheel/double-click zoom toward the pointer, drag to pan, with the pan clamped so
 * the picture can never be lost off-screen. Works for images and rendered pages.
 */
export function Zoomable({ children, resetKey, maxZoom = 8, zoom, onZoom, onTap, className = '' }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);

  useEffect(() => { setPan({ x: 0, y: 0 }); }, [resetKey]);
  useEffect(() => { if (zoom <= 1) setPan({ x: 0, y: 0 }); }, [zoom]);

  const clamp = (p: { x: number; y: number }, z: number) => {
    const r = box.current!.getBoundingClientRect();
    const mx = Math.max(0, (r.width * (z - 1)) / 2), my = Math.max(0, (r.height * (z - 1)) / 2);
    return { x: Math.max(-mx, Math.min(mx, p.x)), y: Math.max(-my, Math.min(my, p.y)) };
  };

  const zoomAt = (next: number, cx: number, cy: number) => {
    const z = Math.max(1, Math.min(maxZoom, next));
    const r = box.current!.getBoundingClientRect();
    const dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2);
    // Keep the point under the cursor stationary.
    const k = z / zoom;
    setPan((p) => clamp({ x: dx - (dx - p.x) * k, y: dy - (dy - p.y) * k }, z));
    onZoom(z);
  };

  useEffect(() => {
    const el = box.current!;
    const wheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) && zoom <= 1) return; // plain wheel scrolls/turns pages
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomAt(zoom * Math.exp(-e.deltaY * 0.0075), e.clientX, e.clientY);
      else setPan((p) => clamp({ x: p.x - e.deltaX, y: p.y - e.deltaY }, zoom));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });

  return (
    <div
      ref={box} className={`zoomable ${zoom > 1 ? 'is-zoomed' : ''} ${className}`}
      onPointerDown={(e) => { box.current!.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false }; }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
        if (zoom > 1 && d.moved) setPan(clamp({ x: d.px + dx, y: d.py + dy }, zoom));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        box.current!.releasePointerCapture(e.pointerId);
        if (d && !d.moved && onTap) { const r = box.current!.getBoundingClientRect(); onTap(e.clientX - r.left, r.width); }
      }}
      onDoubleClick={(e) => zoomAt(zoom > 1.05 ? 1 : 2.5, e.clientX, e.clientY)}
    >
      <div className="zoomable__inner" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>{children}</div>
    </div>
  );
}
