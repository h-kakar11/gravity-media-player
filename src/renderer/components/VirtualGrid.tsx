import { useVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useElementSize } from '../lib/hooks';
import { useScroller } from './layout';

interface Props<T> {
  items: T[];
  getKey: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number, width: number) => ReactNode;
  /** Minimum tile width in px; columns are chosen so tiles stretch to fill the row. */
  minWidth: number;
  /** Height of the artwork as a multiple of tile width (2/3 poster → 1.5). */
  aspect: number;
  /** Height reserved below the artwork for title lines. */
  labelHeight?: number;
  gap?: number;
  overscanRows?: number;
}

/** Windowed grid: only rows near the viewport are in the DOM, so 50 000-item libraries stay fluid. */
export function VirtualGrid<T>({ items, getKey, renderItem, minWidth, aspect, labelHeight = 46, gap = 22, overscanRows = 3 }: Props<T>) {
  const scroller = useScroller();
  const [boxRef, { width }] = useElementSize<HTMLDivElement>();
  const gridRef = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);

  const cols = Math.max(1, Math.floor((width + gap) / (minWidth + gap)));
  const tile = cols > 0 && width > 0 ? (width - gap * (cols - 1)) / cols : minWidth;
  const rowH = tile * aspect + labelHeight + gap;
  const rows = Math.ceil(items.length / cols);

  useLayoutEffect(() => {
    if (!scroller || !gridRef.current) return;
    const sRect = scroller.getBoundingClientRect();
    const gRect = gridRef.current.getBoundingClientRect();
    setMargin(gRect.top - sRect.top + scroller.scrollTop);
  }, [scroller, width, items.length]);

  const v = useVirtualizer({
    count: rows,
    getScrollElement: () => scroller,
    estimateSize: () => rowH,
    overscan: overscanRows,
    scrollMargin: margin
  });
  // Row height depends on width; re-measure when it changes.
  useLayoutEffect(() => { v.measure(); }, [rowH]); // eslint-disable-line react-hooks/exhaustive-deps

  const virtualRows = v.getVirtualItems();
  const content = useMemo(
    () =>
      virtualRows.map((vr) => {
        const start = vr.index * cols;
        const slice = items.slice(start, start + cols);
        return (
          <div key={vr.key} className="vgrid__row" style={{ transform: `translateY(${vr.start - margin}px)`, height: rowH - gap, gridTemplateColumns: `repeat(${cols}, ${tile}px)`, columnGap: gap }}>
            {slice.map((item, i) => <div key={getKey(item, start + i)} className="vgrid__cell">{renderItem(item, start + i, tile)}</div>)}
          </div>
        );
      }),
    [virtualRows, items, cols, tile, rowH, margin, gap] // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <div ref={boxRef} className="vgrid">
      <div ref={gridRef} className="vgrid__inner" style={{ height: Math.max(0, v.getTotalSize() - gap) }}>{width > 0 && content}</div>
    </div>
  );
}
