import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLibrary } from '../state/library';

export interface AsyncState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Run an async loader whenever `deps` change or the library changes underneath. Stale responses
 * are discarded and the previous data stays visible while reloading (no flicker).
 */
export function useLibraryQuery<T>(loader: () => Promise<T>, deps: unknown[], opts: { live?: boolean } = {}): AsyncState<T> {
  const revision = useLibrary((s) => s.revision);
  const [state, setState] = useState<{ data: T | undefined; loading: boolean; error: string | null }>({ data: undefined, loading: true, error: null });
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const live = opts.live ?? true;

  useEffect(() => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    loaderRef.current().then(
      (data) => { if (mine === seq.current) setState({ data, loading: false, error: null }); },
      (err: Error) => { if (mine === seq.current) setState((s) => ({ ...s, loading: false, error: err.message })); }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, live ? revision : 0]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export function useDebounced<T>(value: T, ms = 220): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => { ref.current = fn; });
  return useCallback((...args: A) => ref.current(...args), []);
}

export function useElementSize<T extends HTMLElement>(): [React.RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e!.contentRect;
      setSize((s) => (Math.abs(s.width - r.width) < 0.5 && Math.abs(s.height - r.height) < 0.5 ? s : { width: r.width, height: r.height }));
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setSize({ width: r.width, height: r.height });
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** Close-on-outside-click / Escape helper for popovers. */
export function useDismiss(ref: React.RefObject<HTMLElement | null>, onDismiss: () => void, active = true): void {
  const cb = useEvent(onDismiss);
  useEffect(() => {
    if (!active) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) cb(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); cb(); } };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', down, true); document.removeEventListener('keydown', key, true); };
  }, [active, ref, cb]);
}

export function useMediaQuery(query: string): boolean {
  const [m, setM] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const h = () => setM(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [query]);
  return m;
}
