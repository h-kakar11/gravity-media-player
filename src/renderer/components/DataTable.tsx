import { ChevronDown, ChevronUp } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useScroller } from './layout';

export interface Column<T> {
  id: string;
  header: string;
  width: string; // CSS grid track, e.g. '2fr' or '90px'
  render: (item: T, index: number) => ReactNode;
  align?: 'right';
  sortKey?: string;
  hideBelow?: number; // hide when the table is narrower than this
}

interface Props<T> {
  items: T[];
  columns: Column<T>[];
  getKey: (item: T) => string | number;
  rowHeight?: number;
  onActivate?: (item: T, index: number) => void;
  onContext?: (e: React.MouseEvent, item: T, index: number) => void;
  sort?: { key: string; desc: boolean };
  onSort?: (key: string) => void;
  selectedKey?: string | number | null;
  onSelect?: (item: T) => void;
  isCurrent?: (item: T) => boolean;
  draggableIds?: (item: T) => number[] | null;
  dragMime?: string;
  /** Enables drag-to-reorder: called with the dragged row key and the index to move it to. */
  onReorder?: (fromKey: string, toIndex: number) => void;
}

/** Virtualised, sortable table with keyboard navigation — the "list" view of every library. */
export function DataTable<T>({ items, columns, getKey, rowHeight = 46, onActivate, onContext, sort, onSort, selectedKey, onSelect, isCurrent, draggableIds, dragMime, onReorder }: Props<T>) {
  const scroller = useScroller();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  const [width, setWidth] = useState(0);
  const [focusIdx, setFocusIdx] = useState(0);
  const [dropAt, setDropAt] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || !scroller) return;
    const measure = () => {
      setMargin(el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop);
      setWidth(el.clientWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scroller, items.length]);

  const v = useVirtualizer({ count: items.length, getScrollElement: () => scroller, estimateSize: () => rowHeight, overscan: 12, scrollMargin: margin });
  const cols = columns.filter((c) => !c.hideBelow || width >= c.hideBelow);
  const template = cols.map((c) => c.width).join(' ');

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(items.length - 1, Math.max(0, focusIdx + (e.key === 'ArrowDown' ? 1 : -1)));
      setFocusIdx(next);
      onSelect?.(items[next]!);
      v.scrollToIndex(next, { align: 'auto' });
    } else if (e.key === 'Enter' && items[focusIdx]) {
      e.preventDefault();
      onActivate?.(items[focusIdx]!, focusIdx);
    }
  };

  return (
    <div className="table" ref={wrapRef} role="grid" aria-rowcount={items.length} tabIndex={0} onKeyDown={onKey}>
      <div className="table__head" role="row" style={{ gridTemplateColumns: template }}>
        {cols.map((c) => (
          <button
            key={c.id} type="button" role="columnheader" className={`table__th ${c.align === 'right' ? 'is-right' : ''} ${c.sortKey != null && sort?.key === c.sortKey ? 'is-sorted' : ''}`}
            disabled={!c.sortKey} onClick={() => c.sortKey && onSort?.(c.sortKey)}
          >
            {c.header}
            {c.sortKey != null && sort?.key === c.sortKey && (sort?.desc ? <ChevronDown size={12} strokeWidth={2.4} /> : <ChevronUp size={12} strokeWidth={2.4} />)}
          </button>
        ))}
      </div>
      <div className="table__body" style={{ height: v.getTotalSize() }}>
        {v.getVirtualItems().map((vr) => {
          const item = items[vr.index]!;
          const key = getKey(item);
          const ids = draggableIds?.(item);
          return (
            <div
              key={key} role="row" aria-rowindex={vr.index + 1} data-index={vr.index}
              className={`table__row ${selectedKey === key ? 'is-selected' : ''} ${isCurrent?.(item) ? 'is-current' : ''} ${vr.index % 2 ? 'is-odd' : ''}`}
              style={{ transform: `translateY(${vr.start - margin}px)`, height: rowHeight, gridTemplateColumns: template }}
              onClick={() => { setFocusIdx(vr.index); onSelect?.(item); }}
              onDoubleClick={() => onActivate?.(item, vr.index)}
              onContextMenu={(e) => { onSelect?.(item); onContext?.(e, item, vr.index); }}
              draggable={(!!ids && !!dragMime) || !!onReorder}
              onDragStart={(e) => {
                if (ids && dragMime) e.dataTransfer.setData(dragMime, JSON.stringify(ids));
                if (onReorder) e.dataTransfer.setData('application/x-gravity-reorder', String(key));
                e.dataTransfer.effectAllowed = onReorder ? 'copyMove' : 'copy';
              }}
              onDragOver={(e) => {
                if (!onReorder || !e.dataTransfer.types.includes('application/x-gravity-reorder')) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                setDropAt(e.clientY < r.top + r.height / 2 ? vr.index : vr.index + 1);
              }}
              onDragLeave={() => setDropAt(null)}
              onDrop={(e) => {
                const from = e.dataTransfer.getData('application/x-gravity-reorder');
                if (!onReorder || !from) return;
                e.preventDefault();
                const to = dropAt ?? vr.index;
                setDropAt(null);
                onReorder(from, to);
              }}
              onDragEnd={() => setDropAt(null)}
            >
              {dropAt === vr.index && <span className="table__drop table__drop--top" />}
              {dropAt === vr.index + 1 && vr.index === items.length - 1 && <span className="table__drop table__drop--bottom" />}
              {cols.map((c) => <div key={c.id} role="gridcell" className={`table__td ${c.align === 'right' ? 'is-right' : ''}`}>{c.render(item, vr.index)}</div>)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
