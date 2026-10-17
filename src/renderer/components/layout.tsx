import { ChevronLeft, ChevronRight } from 'lucide-react';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { routeKey, useRouter } from '../state/router';
import { useToolbar } from './Toolbar';

const ScrollerCtx = createContext<HTMLElement | null>(null);
export const useScroller = () => useContext(ScrollerCtx);

const scrollMemory = new Map<string, number>();

/**
 * The scrolling content region. It sits *under* the floating toolbar (so content blurs behind it —
 * the HIG "scroll edge effect") and remembers scroll position per route for Back/Forward.
 */
export function ContentScroller({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [el, setEl] = useState<HTMLElement | null>(null);
  const route = useRouter((s) => s.route);
  const key = routeKey(route);
  const prevKey = useRef(key);

  useLayoutEffect(() => setEl(ref.current), []);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (prevKey.current !== key) scrollMemory.set(prevKey.current, scrollMemory.get(`live:${prevKey.current}`) ?? 0);
    prevKey.current = key;
    const target = scrollMemory.get(key) ?? 0;
    node.scrollTop = target;
    useToolbar.setState({ scrolled: target > 2 });
    if (target > 0) {
      // Content often arrives asynchronously; keep nudging until the page is tall enough.
      let tries = 0;
      const iv = setInterval(() => {
        if (!ref.current || Math.abs(ref.current.scrollTop - target) < 2 || ++tries > 20) return clearInterval(iv);
        ref.current.scrollTop = target;
      }, 40);
      return () => clearInterval(iv);
    }
  }, [key]);

  return (
    <div
      className="scroller" ref={ref} data-route={route.name}
      onScroll={(e) => {
        const top = e.currentTarget.scrollTop;
        scrollMemory.set(`live:${key}`, top);
        if ((top > 2) !== useToolbar.getState().scrolled) useToolbar.setState({ scrolled: top > 2 });
      }}
    >
      <ScrollerCtx.Provider value={el}>
        <div className="page" key={key}>{children}</div>
      </ScrollerCtx.Provider>
    </div>
  );
}

/** Large title that collapses into the toolbar once it scrolls out of view. */
export function PageHeader({ title, subtitle, children, eyebrow }: { title: string; subtitle?: ReactNode; children?: ReactNode; eyebrow?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const scroller = useScroller();
  useEffect(() => {
    const node = ref.current;
    if (!node || !scroller) return;
    useToolbar.setState({ compactTitle: title });
    const io = new IntersectionObserver(([e]) => useToolbar.setState({ compact: !e!.isIntersecting }), { root: scroller, rootMargin: '-52px 0px 0px 0px', threshold: 0 });
    io.observe(node);
    return () => { io.disconnect(); useToolbar.setState({ compact: false }); };
  }, [scroller, title]);
  return (
    <div className="page-header" ref={ref}>
      <div className="page-header__text">
        {eyebrow && <div className="t-caps">{eyebrow}</div>}
        <h1 className="t-large-title truncate">{title}</h1>
        {subtitle && <p className="secondary page-header__sub">{subtitle}</p>}
      </div>
      {children && <div className="page-header__actions">{children}</div>}
    </div>
  );
}

export function Shelf({ title, subtitle, onSeeAll, children, className = '' }: { title: string; subtitle?: string; onSeeAll?: () => void; children: ReactNode; className?: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const measure = () => {
    const t = track.current;
    if (!t) return;
    setEdge({ left: t.scrollLeft > 4, right: t.scrollLeft + t.clientWidth < t.scrollWidth - 4 });
  };
  useEffect(() => {
    measure();
    const t = track.current;
    if (!t) return;
    const ro = new ResizeObserver(measure);
    ro.observe(t);
    return () => ro.disconnect();
  });
  const page = (dir: -1 | 1) => track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.82, behavior: 'smooth' });
  return (
    <section className={`shelf ${className}`} aria-label={title}>
      <header className="shelf__head">
        <div>
          <h2 className="t-title-2">{onSeeAll ? <button type="button" className="shelf__title-btn" onClick={onSeeAll}>{title}<ChevronRight size={18} strokeWidth={2.2} /></button> : title}</h2>
          {subtitle && <p className="secondary t-subhead">{subtitle}</p>}
        </div>
      </header>
      <div className="shelf__frame">
        <div className="shelf__track" ref={track} onScroll={measure}>{children}</div>
        {edge.left && <button type="button" className="shelf__nav shelf__nav--left" aria-label="Scroll left" onClick={() => page(-1)}><ChevronLeft size={20} strokeWidth={2.2} /></button>}
        {edge.right && <button type="button" className="shelf__nav shelf__nav--right" aria-label="Scroll right" onClick={() => page(1)}><ChevronRight size={20} strokeWidth={2.2} /></button>}
      </div>
    </section>
  );
}
