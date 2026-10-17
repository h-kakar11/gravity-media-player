import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildSpreads, spreadIndexOf } from '@shared/spreads';
import type { ComicInfo, MediaItem } from '@shared/types';
import { invoke } from '../api';
import { Segmented, Spinner, Switch } from '../components/ui';
import { registerHandlers } from '../lib/hotkeys';
import { useSettings } from '../state/settings';
import { toast } from '../state/ui';
import { useReader } from '../state/reader';
import { READER_BG, READER_FG, ReaderTop, SettingGroup, useAutoHide, useReadingSession } from './shared';
import { Zoomable } from './Zoomable';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function pageUrl(id: number, index: number, widthPx: number): string {
  return `gravity://app/comic/${id}/${index}${widthPx > 0 ? `?w=${widthPx}` : ''}`;
}

export function ComicReader({ item }: { item: MediaItem }) {
  const reader = useSettings((s) => s.settings.reader);
  const update = useSettings((s) => s.update);
  const [info, setInfo] = useState<ComicInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [dims, setDims] = useState<Record<number, number>>({}); // aspect ratio (w/h) per loaded page
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [siblings, setSiblings] = useState<{ prev: MediaItem | null; next: MediaItem | null }>({ prev: null, next: null });
  const ui = useAutoHide();
  const session = useReadingSession(item);
  const count = info?.pages.length ?? 0;
  const rtl = reader.direction === 'rtl';

  useEffect(() => {
    let live = true;
    setInfo(null);
    setError(null);
    invoke('reader:comic', item.id).then((i) => {
      if (!live) return;
      setInfo(i);
      let start = 0;
      try { start = (JSON.parse(item.location ?? '{}') as { page?: number }).page ?? 0; } catch { /* no saved place */ }
      // A finished volume re-opens at the start rather than its last page.
      setPage(item.completed ? 0 : clamp(start, 0, Math.max(0, i.pages.length - 1)));
    }).catch((e: Error) => live && setError(e.message));
    invoke('library:siblings', item.id).then((s) => live && setSiblings({ prev: s.prev, next: s.next })).catch(() => {});
    return () => { live = false; };
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const spreads = useMemo(() => (reader.mode === 'double' ? buildSpreads(count, (i) => (dims[i] ?? 0) > 1.1, reader.coverAlone) : count ? Array.from({ length: count }, (_, i) => [i]) : []), [reader.mode, count, dims, reader.coverAlone]);
  const spreadIdx = spreadIndexOf(spreads, page);
  const spread = spreads[spreadIdx] ?? [page];

  const widthPx = useMemo(() => {
    if (zoom > 1.6 || reader.fit === 'original') return 0;
    const dpr = window.devicePixelRatio || 1;
    return Math.min(3200, Math.ceil((window.innerWidth * dpr * (reader.mode === 'double' ? 0.55 : 1)) / 400) * 400);
  }, [zoom, reader.fit, reader.mode]);

  const goPage = useCallback((p: number) => {
    setPage(clamp(p, 0, Math.max(0, count - 1)));
    setZoom(1);
  }, [count]);

  const step = useCallback((dir: 1 | -1) => {
    if (reader.mode === 'scroll') {
      const el = document.querySelector('.comic-scroll');
      el?.scrollBy({ top: dir * el.clientHeight * 0.88, behavior: 'smooth' });
      return;
    }
    const target = spreads[spreadIdx + dir];
    if (target) goPage(target[0]!);
    else if (dir > 0 && siblings.next) { useReader.getState().open(siblings.next, useReader.getState().context); toast('info', `Next: ${siblings.next.title}`); }
    else if (dir > 0) toast('info', 'You’ve reached the end');
  }, [reader.mode, spreads, spreadIdx, goPage, siblings.next]);

  // Persist place + progress.
  useEffect(() => {
    if (!count) return;
    session.save(JSON.stringify({ page }), (page + 1) / count, page >= count - 1 || (reader.mode === 'double' && spread.includes(count - 1)));
  }, [page, count]); // eslint-disable-line react-hooks/exhaustive-deps

  // Warm the cache for the pages that are about to be needed.
  useEffect(() => {
    if (!count || reader.mode === 'scroll') return;
    const last = spread[spread.length - 1] ?? page;
    for (let k = 1; k <= reader.preload; k++) {
      for (const p of [last + k, page - k]) if (p >= 0 && p < count) { const im = new Image(); im.src = pageUrl(item.id, p, widthPx); }
    }
  }, [page, count, widthPx, reader.preload, reader.mode, item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard. Arrow keys follow the page's physical direction (RTL swaps them).
  useEffect(() => registerHandlers({
    'reader.next': (e) => { step(e?.key === 'ArrowRight' && rtl ? -1 : e?.key === 'ArrowLeft' && rtl ? -1 : 1); },
    'reader.prev': (e) => { step(e?.key === 'ArrowLeft' && rtl ? 1 : e?.key === 'ArrowRight' && rtl ? 1 : -1); },
    'reader.nextAlt': () => { step(1); },
    'reader.prevAlt': () => { step(-1); },
    'reader.first': () => { goPage(0); },
    'reader.last': () => { goPage(count - 1); },
    'reader.zoomIn': () => { setZoom((z) => Math.min(8, z * 1.25)); },
    'reader.zoomOut': () => { setZoom((z) => Math.max(1, z / 1.25)); },
    'reader.zoomReset': () => { setZoom(1); },
    'reader.fit': () => { update({ reader: { fit: ({ screen: 'width', width: 'height', height: 'original', original: 'screen' } as const)[reader.fit] } }); },
    'reader.direction': () => { update({ reader: { direction: rtl ? 'ltr' : 'rtl' } }); toast('info', rtl ? 'Reading left to right' : 'Reading right to left (manga)'); },
    'reader.mode': () => { update({ reader: { mode: ({ single: 'double', double: 'scroll', scroll: 'single' } as const)[reader.mode] } }); },
    'reader.nextChapter': () => { if (siblings.next) useReader.getState().open(siblings.next, useReader.getState().context); else return false; },
    'reader.prevChapter': () => { if (siblings.prev) useReader.getState().open(siblings.prev, useReader.getState().context); else return false; },
    'reader.settings': () => { setSettingsOpen((o) => !o); },
    'reader.toc': () => { setSettingsOpen((o) => !o); },
    'reader.close': () => { if (settingsOpen) setSettingsOpen(false); else useReader.getState().close(); }
  }), [step, goPage, count, rtl, reader.fit, reader.mode, siblings, settingsOpen, update]);

  const onTap = (x: number, w: number) => {
    session.touch();
    const frac = x / w;
    const leftZone = frac < 0.28, rightZone = frac > 0.72;
    if (!leftZone && !rightZone) return ui.toggle();
    // Physical left/right: in RTL books the left edge advances.
    step((rightZone ? 1 : -1) * (rtl ? -1 : 1) as 1 | -1);
  };

  const bg = READER_BG[reader.background];
  const label = `${spread.length === 2 ? `${spread[0]! + 1}–${spread[1]! + 1}` : (spread[0] ?? 0) + 1} / ${count}`;

  return (
    <div className="reader" style={{ background: bg, color: READER_FG[reader.background] }} onMouseMove={ui.poke} data-mode={reader.mode}>
      {error ? <div className="reader__msg"><div className="t-title-3">Can’t open this file</div><p className="secondary">{error}</p></div>
        : !info ? <div className="reader__msg"><Spinner size={26} /></div>
        : reader.mode === 'scroll' ? <ScrollMode id={item.id} count={count} page={page} onPage={(p) => { setPage(p); }} zoom={zoom} onDims={(i, ar) => setDims((d) => (d[i] === ar ? d : { ...d, [i]: ar }))} widthPx={widthPx} onTap={() => ui.toggle()} />
        : (
          <Zoomable resetKey={page + reader.mode} zoom={zoom} onZoom={setZoom} onTap={onTap} className="comic-stage">
            <div className={`comic-spread fit-${reader.fit} ${rtl ? 'is-rtl' : ''} ${spread.length === 2 ? 'is-double' : ''}`}>
              {spread.map((p) => (
                <img key={p} className="comic-page" src={pageUrl(item.id, p, widthPx)} alt={`Page ${p + 1}`} draggable={false} onLoad={(e) => { const ar = e.currentTarget.naturalWidth / Math.max(1, e.currentTarget.naturalHeight); setDims((d) => (d[p] === ar ? d : { ...d, [p]: ar })); }} />
              ))}
            </div>
          </Zoomable>
        )}

      <ReaderTop title={item.series ?? item.title} subtitle={item.series ? item.title : undefined} visible={ui.visible || settingsOpen} onSettings={() => setSettingsOpen((o) => !o)} settingsOpen={settingsOpen} />

      {info && reader.mode !== 'scroll' && (
        <>
          <button type="button" className="reader__edge reader__edge--left" aria-label={rtl ? 'Next page' : 'Previous page'} onClick={() => step(rtl ? 1 : -1)}><ChevronLeft size={26} /></button>
          <button type="button" className="reader__edge reader__edge--right" aria-label={rtl ? 'Previous page' : 'Next page'} onClick={() => step(rtl ? -1 : 1)}><ChevronRight size={26} /></button>
        </>
      )}

      <div className={`rbar glass-dark ${ui.visible || settingsOpen ? '' : 'is-hidden'}`} onMouseEnter={() => ui.pin(true)} onMouseLeave={() => ui.pin(false)}>
        <span className="rbar__label tabular">{label}</span>
        <input
          type="range" className="slider rbar__slider" min={0} max={Math.max(0, count - 1)} value={page} aria-label="Page"
          style={{ '--p': `${count > 1 ? (page / (count - 1)) * 100 : 0}%`, direction: rtl && reader.mode !== 'scroll' ? 'rtl' : 'ltr', '--dir': rtl && reader.mode !== 'scroll' ? 'to left' : 'to right' } as React.CSSProperties}
          onChange={(e) => goPage(Number(e.target.value))}
        />
        <span className="rbar__label tabular">{Math.round(((page + 1) / Math.max(1, count)) * 100)}%</span>
      </div>

      {settingsOpen && (
        <div className="rset glass-dark" role="dialog" aria-label="Reading settings" onMouseEnter={() => ui.pin(true)} onMouseLeave={() => ui.pin(false)}>
          <SettingGroup label="Layout">
            <Segmented label="Page layout" value={reader.mode} onChange={(v) => update({ reader: { mode: v } })} options={[{ value: 'single', label: 'Single' }, { value: 'double', label: 'Two pages' }, { value: 'scroll', label: 'Scroll' }]} />
          </SettingGroup>
          <SettingGroup label="Reading direction">
            <Segmented label="Reading direction" value={reader.direction} onChange={(v) => update({ reader: { direction: v } })} options={[{ value: 'ltr', label: 'Left to right' }, { value: 'rtl', label: 'Right to left' }]} />
          </SettingGroup>
          <SettingGroup label="Fit">
            <Segmented label="Fit" value={reader.fit} onChange={(v) => update({ reader: { fit: v } })} options={[{ value: 'screen', label: 'Screen' }, { value: 'width', label: 'Width' }, { value: 'height', label: 'Height' }, { value: 'original', label: '100%' }]} />
          </SettingGroup>
          <SettingGroup label="Background">
            <div className="swatches">
              {(['black', 'dark', 'sepia', 'white'] as const).map((b) => <button key={b} type="button" className={`swatch ${reader.background === b ? 'is-on' : ''}`} style={{ background: READER_BG[b] }} aria-label={b} aria-pressed={reader.background === b} onClick={() => update({ reader: { background: b } })} />)}
            </div>
          </SettingGroup>
          <label className="rset__row"><span>Cover on its own page</span><Switch checked={reader.coverAlone} onChange={(v) => update({ reader: { coverAlone: v } })} label="Cover on its own page" /></label>
          <div className="rset__zoom t-footnote tertiary">Zoom: Ctrl/⌘ + scroll, + / −, or double-click. Drag to pan.</div>
        </div>
      )}
    </div>
  );
}

/** Continuous vertical strip (webtoon style): pages load lazily as you scroll. */
function ScrollMode({ id, count, page, onPage, zoom, onDims, widthPx, onTap }: { id: number; count: number; page: number; onPage: (p: number) => void; zoom: number; onDims: (i: number, ar: number) => void; widthPx: number; onTap: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const restoring = useRef(true);
  const initial = useRef(page);

  useEffect(() => {
    // Land on the saved page; keep nudging while earlier images (of unknown height) load in.
    const t = setTimeout(() => { restoring.current = false; }, 2500);
    return () => clearTimeout(t);
  }, []);

  const scrollToPage = (p: number) => ref.current?.querySelector<HTMLElement>(`[data-p="${p}"]`)?.scrollIntoView({ block: 'start' });
  useEffect(() => { scrollToPage(initial.current); }, []);

  useEffect(() => {
    const root = ref.current!;
    const io = new IntersectionObserver((entries) => {
      if (restoring.current) return;
      for (const e of entries) if (e.isIntersecting && e.intersectionRatio > 0.01) onPage(Number((e.target as HTMLElement).dataset.p));
    }, { root, rootMargin: '-45% 0px -50% 0px', threshold: [0, 0.01] });
    root.querySelectorAll('[data-p]').forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [count]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="comic-scroll" ref={ref} onClick={onTap}>
      <div className="comic-strip" style={{ width: `min(${zoom * 100}%, ${960 * zoom}px)` }}>
        {Array.from({ length: count }, (_, i) => (
          <img key={i} data-p={i} className="comic-strip__page" loading="lazy" decoding="async" src={pageUrl(id, i, widthPx)} alt={`Page ${i + 1}`} draggable={false}
            onLoad={(e) => { onDims(i, e.currentTarget.naturalWidth / Math.max(1, e.currentTarget.naturalHeight)); if (restoring.current && i <= initial.current) scrollToPage(initial.current); }} />
        ))}
      </div>
    </div>
  );
}
