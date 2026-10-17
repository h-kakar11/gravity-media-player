import { ChevronLeft, ChevronRight, ListTree, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EpubInfo, MediaItem, TocEntry } from '@shared/types';
import { invoke } from '../api';
import { IconButton, Segmented, Spinner, Switch } from '../components/ui';
import { registerHandlers } from '../lib/hotkeys';
import { useSettings } from '../state/settings';
import { toast } from '../state/ui';
import { useReader } from '../state/reader';
import { ReaderTop, SettingGroup, useAutoHide, useReadingSession } from './shared';

const THEMES = {
  light: { bg: '#ffffff', fg: '#1d1d1f', link: '#0a60d8' },
  sepia: { bg: '#f4ecd8', fg: '#3b2f1e', link: '#8a4b12' },
  dark: { bg: '#1c1c1e', fg: '#e5e5e7', link: '#6cb2ff' },
  black: { bg: '#000000', fg: '#d2d2d6', link: '#6cb2ff' }
} as const;
const FONTS = { serif: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif", sans: "-apple-system, 'Inter Variable', 'Segoe UI', system-ui, sans-serif", mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" } as const;

interface Loc { spine: number; frac: number }

export function EpubReader({ item }: { item: MediaItem }) {
  const reader = useSettings((s) => s.settings.reader);
  const update = useSettings((s) => s.update);
  const e = reader.epub;
  const [info, setInfo] = useState<EpubInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loc, setLoc] = useState<Loc>({ spine: 0, frac: 0 });
  const [pages, setPages] = useState({ page: 0, total: 1 });
  const [panel, setPanel] = useState<null | 'toc' | 'search' | 'settings'>(null);
  const [hits, setHits] = useState<{ spineIndex: number; excerpt: string }[] | null>(null);
  const [query, setQuery] = useState('');
  const frame = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const state = useRef({ page: 0, total: 1, spine: 0, restoreFrac: -1, goLast: false, flow: e.flow, scheme: 'light' as keyof typeof THEMES });
  const ui = useAutoHide();
  const session = useReadingSession(item);

  const scheme: keyof typeof THEMES = e.theme === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : e.theme;
  state.current.scheme = scheme;
  state.current.flow = e.flow;
  const total = useMemo(() => (info ? info.spine.reduce((a, s) => a + Math.max(1, s.size), 0) : 1), [info]);

  useEffect(() => {
    let live = true;
    invoke('reader:epub', item.id).then((i) => {
      if (!live) return;
      setInfo(i);
      let l: Loc = { spine: 0, frac: 0 };
      try { const p = JSON.parse(item.location ?? 'null') as Loc | null; if (p && typeof p.spine === 'number') l = p; } catch { /* first open */ }
      if (item.completed) l = { spine: 0, frac: 0 };
      state.current.restoreFrac = l.frac;
      state.current.spine = clampSpine(l.spine, i);
      setLoc({ spine: state.current.spine, frac: l.frac });
    }).catch((err: Error) => live && setError(err.message));
    return () => { live = false; };
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const progressOf = useCallback((spine: number, frac: number) => {
    if (!info) return 0;
    const before = info.spine.slice(0, spine).reduce((a, s) => a + Math.max(1, s.size), 0);
    return Math.min(1, (before + frac * Math.max(1, info.spine[spine]?.size ?? 1)) / total);
  }, [info, total]);

  const report = useCallback((spine: number, frac: number) => {
    const p = progressOf(spine, frac);
    setLoc({ spine, frac });
    session.save(JSON.stringify({ spine, frac }), p, p > 0.985);
  }, [progressOf, session]);

  /** Apply theme + typography + pagination to the loaded chapter. */
  const layout = useCallback(() => {
    const f = frame.current;
    const doc = f?.contentDocument;
    if (!f || !doc || !doc.body) return;
    const st = state.current;
    const t = THEMES[st.scheme];
    const W = f.clientWidth, H = f.clientHeight;
    const padX = Math.max(18, Math.round(W * (e.margin / 100)));
    const padY = 36;
    const cols = e.flow === 'paginated' && W > 1000 ? 2 : 1;
    const colW = Math.floor(W / cols - 2 * padX);
    const font = e.fontFamily === 'publisher' ? '' : `font-family: ${FONTS[e.fontFamily]} !important;`;
    let style = doc.getElementById('gravity-style') as HTMLStyleElement | null;
    if (!style) { style = doc.createElement('style'); style.id = 'gravity-style'; doc.head.appendChild(style); }
    const imageOnly = doc.body.textContent!.trim().length < 40 && doc.querySelector('img, svg image, image');
    style.textContent = `
      html { font-size: ${e.fontSize * 100}% !important; background: ${t.bg} !important; ${e.flow === 'paginated' ? 'overflow: hidden !important;' : 'overflow-y: auto !important; overflow-x: hidden !important;'} -webkit-text-size-adjust: none; }
      body { margin: 0 !important; color: ${t.fg} !important; background: ${t.bg} !important; line-height: ${e.lineHeight} !important; ${font} ${e.justify ? 'text-align: justify; hyphens: auto;' : ''} overflow-wrap: break-word;
        ${e.flow === 'paginated'
          ? `padding: ${padY}px ${padX}px !important; height: ${H}px !important; box-sizing: border-box !important; column-width: ${colW}px !important; column-gap: ${2 * padX}px !important; column-fill: auto !important; width: auto !important; max-width: none !important;`
          : `padding: ${padY}px ${padX}px ${padY * 2}px !important; max-width: 46rem !important; margin: 0 auto !important;`} }
      a { color: ${t.link} !important; }
      img, svg, video { max-width: 100% !important; ${e.flow === 'paginated' ? `max-height: ${H - 2 * padY - 8}px !important;` : ''} height: auto; break-inside: avoid; }
      h1, h2, h3, h4 { break-after: avoid; line-height: 1.25 !important; }
      p { orphans: 2; widows: 2; }
      pre, table, blockquote { break-inside: avoid-column; max-width: 100%; }
      ${imageOnly ? `body { padding: 0 !important; display: flex; align-items: center; justify-content: center; } img, svg { width: 100% !important; height: ${H}px !important; max-height: none !important; object-fit: contain; }` : ''}
    `;
    doc.documentElement.style.colorScheme = st.scheme === 'light' || st.scheme === 'sepia' ? 'light' : 'dark';
    if (e.flow === 'paginated') {
      const sw = doc.documentElement.scrollWidth;
      const totalPages = Math.max(1, Math.round(sw / W));
      let page = st.page;
      if (st.goLast) { page = totalPages - 1; st.goLast = false; }
      else if (st.restoreFrac >= 0) { page = Math.min(totalPages - 1, Math.floor(st.restoreFrac * totalPages)); st.restoreFrac = -1; }
      else page = Math.min(page, totalPages - 1);
      st.page = page; st.total = totalPages;
      doc.documentElement.scrollLeft = page * W;
      setPages({ page, total: totalPages });
      report(st.spine, totalPages > 1 ? page / totalPages : 0);
    } else {
      const el = doc.documentElement;
      if (st.restoreFrac >= 0) { el.scrollTop = st.restoreFrac * Math.max(0, el.scrollHeight - H); st.restoreFrac = -1; }
      if (st.goLast) { el.scrollTop = el.scrollHeight; st.goLast = false; }
      setPages({ page: 0, total: 1 });
    }
  }, [e.fontFamily, e.fontSize, e.lineHeight, e.margin, e.flow, e.justify, report]);

  const showPage = useCallback((page: number) => {
    const f = frame.current;
    const st = state.current;
    if (!f?.contentDocument) return;
    st.page = page;
    f.contentDocument.documentElement.scrollLeft = page * f.clientWidth;
    setPages({ page, total: st.total });
    report(st.spine, st.total > 1 ? page / st.total : 0);
  }, [report]);

  const gotoSpine = useCallback((i: number, opts: { last?: boolean; frac?: number } = {}) => {
    if (!info) return;
    const st = state.current;
    const idx = clampSpine(i, info);
    st.spine = idx; st.page = 0; st.goLast = !!opts.last; st.restoreFrac = opts.frac ?? -1;
    setLoc({ spine: idx, frac: opts.frac ?? 0 });
  }, [info]);

  /** Turn the page, rolling over into the neighbouring chapter at the edges. */
  const turn = useCallback((dir: 1 | -1) => {
    const st = state.current;
    const f = frame.current;
    if (!info || !f?.contentDocument) return;
    if (st.flow === 'scrolled') {
      const el = f.contentDocument.documentElement;
      const atEnd = el.scrollTop + f.clientHeight >= el.scrollHeight - 4;
      if (dir > 0 && atEnd) return st.spine + 1 < info.spine.length ? gotoSpine(st.spine + 1) : toast('info', 'End of book');
      if (dir < 0 && el.scrollTop <= 2) return st.spine > 0 ? gotoSpine(st.spine - 1, { last: true }) : undefined;
      el.scrollBy({ top: dir * f.clientHeight * 0.88, behavior: 'smooth' });
      return;
    }
    const next = st.page + dir;
    if (next >= 0 && next < st.total) showPage(next);
    else if (dir > 0) { if (st.spine + 1 < info.spine.length) gotoSpine(st.spine + 1); else toast('info', 'End of book'); }
    else if (st.spine > 0) gotoSpine(st.spine - 1, { last: true });
  }, [info, gotoSpine, showPage]);

  const rtl = (info?.direction === 'rtl');
  useEffect(() => registerHandlers({
    'reader.next': (ev) => { turn(rtl && ev?.key === 'ArrowLeft' ? 1 : rtl && ev?.key === 'ArrowRight' ? -1 : 1); },
    'reader.prev': (ev) => { turn(rtl && ev?.key === 'ArrowRight' ? 1 : rtl && ev?.key === 'ArrowLeft' ? -1 : -1); },
    'reader.nextAlt': () => { turn(1); },
    'reader.prevAlt': () => { turn(-1); },
    'reader.first': () => { gotoSpine(0); },
    'reader.last': () => { if (info) gotoSpine(info.spine.length - 1, { last: true }); },
    'reader.nextChapter': () => { gotoSpine(state.current.spine + 1); },
    'reader.prevChapter': () => { gotoSpine(state.current.spine - 1); },
    'reader.zoomIn': () => { update({ reader: { epub: { fontSize: Math.min(2.4, e.fontSize + 0.1) } } }); },
    'reader.zoomOut': () => { update({ reader: { epub: { fontSize: Math.max(0.7, e.fontSize - 0.1) } } }); },
    'reader.zoomReset': () => { update({ reader: { epub: { fontSize: 1.1 } } }); },
    'reader.toc': () => { setPanel((p) => (p === 'toc' ? null : 'toc')); },
    'reader.settings': () => { setPanel((p) => (p === 'settings' ? null : 'settings')); },
    'nav.search': () => { setPanel('search'); },
    'reader.close': () => { if (panel) setPanel(null); else useReader.getState().close(); }
  }), [turn, gotoSpine, info, rtl, e.fontSize, update, panel]);

  // Re-flow when settings or the window size change.
  useEffect(() => { layout(); }, [layout, scheme]);
  useEffect(() => {
    const st = stage.current;
    if (!st) return;
    const ro = new ResizeObserver(() => { const s = state.current; s.restoreFrac = s.total > 1 ? s.page / s.total : -1; layout(); });
    ro.observe(st);
    return () => ro.disconnect();
  }, [layout]);

  const onFrameLoad = () => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    // Forward keys, wheel and link clicks from the (script-less, sandboxed) book document to the app.
    doc.addEventListener('keydown', (ev) => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ev.key, ctrlKey: ev.ctrlKey, metaKey: ev.metaKey, altKey: ev.altKey, shiftKey: ev.shiftKey, bubbles: true, cancelable: true })); ev.preventDefault(); });
    // Mouse movement inside the iframe never reaches the parent, so wake the auto-hiding chrome from here.
    doc.addEventListener('mousemove', () => ui.poke());
    let wheelAt = 0;
    doc.addEventListener('wheel', (ev) => {
      session.touch();
      if (state.current.flow !== 'paginated') return;
      ev.preventDefault();
      const now = performance.now();
      if (now - wheelAt < 280 || Math.abs(ev.deltaY) + Math.abs(ev.deltaX) < 8) return;
      wheelAt = now;
      turn((ev.deltaY + ev.deltaX) > 0 ? 1 : -1);
    }, { passive: false });
    doc.addEventListener('click', (ev) => {
      const a = (ev.target as HTMLElement).closest('a');
      session.touch();
      if (!a) { const f = frame.current!; const x = ev.clientX / f.clientWidth; if (x > 0.7) turn(rtl ? -1 : 1); else if (x < 0.3) turn(rtl ? 1 : -1); else ui.toggle(); return; }
      ev.preventDefault();
      const href = a.getAttribute('href') ?? '';
      if (/^[a-z]+:/i.test(href) && !href.startsWith('gravity:')) return toast('info', 'External links are disabled in the reader.');
      const path = decodeURIComponent(new URL(a.href, doc.baseURI).pathname.replace(/^\/book\/\d+\//, ''));
      const target = info?.spine.findIndex((s) => s.href === path) ?? -1;
      if (target >= 0) gotoSpine(target);
    });
    layout();
    // Anchors (#fragment) from the table of contents
    const hash = pendingAnchor.current;
    if (hash) { doc.getElementById(hash)?.scrollIntoView(); pendingAnchor.current = null; }
  };
  const pendingAnchor = useRef<string | null>(null);

  const chapterTitle = useMemo(() => {
    const flat: { entry: TocEntry; depth: number }[] = [];
    const walk = (list: TocEntry[], d: number) => list.forEach((t) => { flat.push({ entry: t, depth: d }); walk(t.children, d + 1); });
    walk(info?.toc ?? [], 0);
    return [...flat].reverse().find((x) => x.entry.spineIndex >= 0 && x.entry.spineIndex <= loc.spine)?.entry.title ?? '';
  }, [info, loc.spine]);

  const runSearch = async () => {
    if (query.trim().length < 2) return;
    setHits(null);
    setHits(await invoke('reader:search', item.id, query.trim()));
  };

  const overall = progressOf(loc.spine, pages.total > 1 ? pages.page / pages.total : loc.frac);
  const t = THEMES[scheme];
  const src = info ? `gravity://app/book/${item.id}/${info.spine[loc.spine]?.href.split('/').map(encodeURIComponent).join('/')}` : undefined;

  return (
    <div className="reader reader--epub" style={{ background: t.bg, color: t.fg }} onMouseMove={ui.poke} data-theme-reader={scheme}>
      {error ? <div className="reader__msg"><div className="t-title-3">Can’t open this book</div><p className="secondary">{error}</p></div>
        : !info ? <div className="reader__msg"><Spinner size={26} /></div>
        : (
          <div className="epub-stage" ref={stage}>
            <iframe ref={frame} className="epub-frame" title={item.title} src={src} sandbox="allow-same-origin" onLoad={onFrameLoad} style={{ background: t.bg }} />
          </div>
        )}
      <ReaderTop title={item.title} subtitle={chapterTitle || item.artist || undefined} visible={ui.visible || panel != null} onSettings={() => setPanel((p) => (p === 'settings' ? null : 'settings'))} settingsOpen={panel === 'settings'}>
        <IconButton icon={ListTree} label="Contents" active={panel === 'toc'} onClick={() => setPanel((p) => (p === 'toc' ? null : 'toc'))} className="ctl" size={18} />
        <IconButton icon={Search} label="Search in book" active={panel === 'search'} onClick={() => setPanel((p) => (p === 'search' ? null : 'search'))} className="ctl" size={18} />
      </ReaderTop>
      {info && (
        <>
          <button type="button" className="reader__edge reader__edge--left" aria-label="Previous page" onClick={() => turn(rtl ? 1 : -1)}><ChevronLeft size={26} /></button>
          <button type="button" className="reader__edge reader__edge--right" aria-label="Next page" onClick={() => turn(rtl ? -1 : 1)}><ChevronRight size={26} /></button>
        </>
      )}
      <div className={`rbar glass-dark ${ui.visible || panel ? '' : 'is-hidden'}`} onMouseEnter={() => ui.pin(true)} onMouseLeave={() => ui.pin(false)}>
        <span className="rbar__label tabular">{pages.total > 1 ? `${pages.page + 1} / ${pages.total}` : `${loc.spine + 1} / ${info?.spine.length ?? 1}`}</span>
        <input type="range" className="slider rbar__slider" min={0} max={1000} value={Math.round(overall * 1000)} aria-label="Position in book" style={{ '--p': `${overall * 100}%` } as React.CSSProperties}
          onChange={(ev) => {
            if (!info) return;
            const target = (Number(ev.target.value) / 1000) * total;
            let acc = 0;
            for (let i = 0; i < info.spine.length; i++) { const sz = Math.max(1, info.spine[i]!.size); if (acc + sz >= target) { gotoSpine(i, { frac: (target - acc) / sz }); return; } acc += sz; }
          }} />
        <span className="rbar__label tabular">{Math.round(overall * 100)}%</span>
      </div>

      {panel === 'toc' && info && (
        <aside className="rside glass-dark" aria-label="Contents">
          <h3 className="t-headline">Contents</h3>
          {info.toc.length === 0 ? info.spine.map((s) => <button key={s.index} type="button" className={`rside__item ${s.index === loc.spine ? 'is-on' : ''}`} onClick={() => { gotoSpine(s.index); setPanel(null); }}>Section {s.index + 1}</button>)
            : <TocList items={info.toc} depth={0} current={loc.spine} onGo={(t) => { pendingAnchor.current = t.href.includes('#') ? t.href.split('#')[1]! : null; gotoSpine(t.spineIndex); setPanel(null); }} />}
        </aside>
      )}
      {panel === 'search' && (
        <aside className="rside glass-dark" aria-label="Search">
          <form onSubmit={(ev) => { ev.preventDefault(); void runSearch(); }}>
            <input className="field" autoFocus placeholder="Search in this book" value={query} onChange={(ev) => setQuery(ev.target.value)} aria-label="Search in book" />
          </form>
          {hits == null && query ? <div className="rside__note secondary"><Spinner size={14} /> Searching…</div> : hits && hits.length === 0 ? <div className="rside__note secondary">No matches.</div> : null}
          {hits?.map((h, i) => <button key={i} type="button" className="rside__hit" onClick={() => { gotoSpine(h.spineIndex); setPanel(null); }}><span className="t-footnote tertiary">{info?.spine[h.spineIndex] ? `Section ${h.spineIndex + 1}` : ''}</span><span>{h.excerpt}</span></button>)}
        </aside>
      )}
      {panel === 'settings' && (
        <div className="rset glass-dark" role="dialog" aria-label="Reading settings" onMouseEnter={() => ui.pin(true)} onMouseLeave={() => ui.pin(false)}>
          <SettingGroup label="Theme">
            <div className="swatches">
              {(['auto', 'light', 'sepia', 'dark', 'black'] as const).map((th) => (
                <button key={th} type="button" className={`swatch swatch--theme ${e.theme === th ? 'is-on' : ''}`} style={{ background: th === 'auto' ? `linear-gradient(135deg, ${THEMES.light.bg} 50%, ${THEMES.dark.bg} 50%)` : THEMES[th].bg, color: th === 'auto' ? '#888' : THEMES[th].fg }} aria-label={th} aria-pressed={e.theme === th} onClick={() => update({ reader: { epub: { theme: th } } })}>Aa</button>
              ))}
            </div>
          </SettingGroup>
          <SettingGroup label="Font">
            <Segmented label="Font" value={e.fontFamily} onChange={(v) => update({ reader: { epub: { fontFamily: v } } })} options={[{ value: 'serif', label: 'Serif' }, { value: 'sans', label: 'Sans' }, { value: 'mono', label: 'Mono' }, { value: 'publisher', label: 'Book’s own' }]} />
          </SettingGroup>
          <SettingGroup label={`Text size · ${Math.round(e.fontSize * 100)}%`}>
            <input type="range" className="slider" min={70} max={240} step={5} value={Math.round(e.fontSize * 100)} aria-label="Text size" style={{ '--p': `${((e.fontSize * 100 - 70) / 170) * 100}%` } as React.CSSProperties} onChange={(ev) => update({ reader: { epub: { fontSize: Number(ev.target.value) / 100 } } })} />
          </SettingGroup>
          <SettingGroup label={`Line spacing · ${e.lineHeight.toFixed(1)}`}>
            <input type="range" className="slider" min={11} max={24} value={Math.round(e.lineHeight * 10)} aria-label="Line spacing" style={{ '--p': `${((e.lineHeight * 10 - 11) / 13) * 100}%` } as React.CSSProperties} onChange={(ev) => update({ reader: { epub: { lineHeight: Number(ev.target.value) / 10 } } })} />
          </SettingGroup>
          <SettingGroup label={`Margins · ${e.margin}%`}>
            <input type="range" className="slider" min={0} max={20} value={e.margin} aria-label="Margins" style={{ '--p': `${(e.margin / 20) * 100}%` } as React.CSSProperties} onChange={(ev) => update({ reader: { epub: { margin: Number(ev.target.value) } } })} />
          </SettingGroup>
          <SettingGroup label="Layout">
            <Segmented label="Flow" value={e.flow} onChange={(v) => update({ reader: { epub: { flow: v } } })} options={[{ value: 'paginated', label: 'Pages' }, { value: 'scrolled', label: 'Scroll' }]} />
          </SettingGroup>
          <label className="rset__row"><span>Justify text</span><Switch checked={e.justify} onChange={(v) => update({ reader: { epub: { justify: v } } })} label="Justify text" /></label>
        </div>
      )}
    </div>
  );
}

const clampSpine = (i: number, info: EpubInfo) => Math.max(0, Math.min(info.spine.length - 1, i));

function TocList({ items, depth, current, onGo }: { items: TocEntry[]; depth: number; current: number; onGo: (t: TocEntry) => void }) {
  return (
    <ul className="toc">
      {items.map((t, i) => (
        <li key={`${t.href}${i}`}>
          <button type="button" className={`rside__item ${t.spineIndex === current ? 'is-on' : ''}`} style={{ paddingLeft: 10 + depth * 16 }} onClick={() => onGo(t)} disabled={t.spineIndex < 0}>{t.title}</button>
          {t.children.length > 0 && <TocList items={t.children} depth={depth + 1} current={current} onGo={onGo} />}
        </li>
      ))}
    </ul>
  );
}
