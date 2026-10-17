import { ChevronLeft, ChevronRight, Info, Pause, Play, RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatBytes } from '@shared/format';
import type { MediaItem } from '@shared/types';
import { Artwork } from '../components/Artwork';
import { IconButton } from '../components/ui';
import { registerHandlers } from '../lib/hotkeys';
import { mediaUrl, artUrl } from '../lib/art';
import { useReader } from '../state/reader';
import { ReaderTop, useAutoHide, useReadingSession } from './shared';
import { Zoomable } from './Zoomable';

/** Lightbox for photos and GIFs: zoom/pan, rotate, slideshow and a filmstrip of neighbours. */
export function ImageViewer({ item, context }: { item: MediaItem; context: MediaItem[] }) {
  const list = useMemo(() => context.filter((m) => m.kind === 'image'), [context]);
  const start = Math.max(0, list.findIndex((m) => m.id === item.id));
  const [index, setIndex] = useState(start);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [showInfo, setShowInfo] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [fallback, setFallback] = useState<Record<number, boolean>>({});
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const ui = useAutoHide();
  const cur = list[index] ?? item;
  useReadingSession(cur);
  const strip = useRef<HTMLDivElement>(null);

  const go = useCallback((d: number) => {
    setIndex((i) => (list.length ? (i + d + list.length) % list.length : 0));
    setZoom(1);
    setRotation(0);
    setNatural(null);
  }, [list.length]);

  useEffect(() => registerHandlers({
    'reader.next': () => { go(1); },
    'reader.prev': () => { go(-1); },
    'reader.nextAlt': () => { go(1); },
    'reader.prevAlt': () => { go(-1); },
    'reader.first': () => { setIndex(0); },
    'reader.last': () => { setIndex(list.length - 1); },
    'reader.zoomIn': () => { setZoom((z) => Math.min(10, z * 1.25)); },
    'reader.zoomOut': () => { setZoom((z) => Math.max(1, z / 1.25)); },
    'reader.zoomReset': () => { setZoom(1); setRotation(0); },
    'reader.direction': () => { setRotation((r) => r + 90); },
    'reader.toc': () => { setShowInfo((v) => !v); },
    'reader.close': () => { useReader.getState().close(); }
  }), [go, list.length]);

  // Slideshow
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => go(1), 4000);
    return () => clearInterval(t);
  }, [playing, go]);

  // Preload neighbours
  useEffect(() => {
    for (const d of [1, -1, 2]) { const n = list[(index + d + list.length) % list.length]; if (n) new Image().src = mediaUrl(n.id); }
    strip.current?.querySelector<HTMLElement>('.film__item.is-on')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [index, list]);

  const src = fallback[cur.id] ? artUrl(cur.id, 'large', cur.mtimeMs) : mediaUrl(cur.id);
  const rotated = rotation % 180 !== 0;

  return (
    <div className="reader viewer" style={{ background: '#050506', color: '#fff' }} onMouseMove={ui.poke}>
      <Zoomable resetKey={cur.id} zoom={zoom} onZoom={setZoom} className="viewer__stage" onTap={(x, w) => { if (zoom === 1) { if (x < w * 0.2) go(-1); else if (x > w * 0.8) go(1); else ui.toggle(); } }}>
        <img
          key={cur.id} className="viewer__img" src={src} alt={cur.title} draggable={false}
          style={{ transform: `rotate(${rotation}deg)`, maxWidth: rotated ? '100vh' : '100%', maxHeight: rotated ? '100vw' : '100%' }}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          onError={() => { if (!fallback[cur.id]) setFallback((f) => ({ ...f, [cur.id]: true })); }}
        />
      </Zoomable>
      <ReaderTop title={cur.title} subtitle={`${index + 1} of ${list.length}${cur.ext === 'gif' ? ' · GIF' : ''}`} visible={ui.visible}>
        <IconButton icon={RotateCcw} label="Rotate left" onClick={() => setRotation((r) => r - 90)} className="ctl" />
        <IconButton icon={RotateCw} label="Rotate right" onClick={() => setRotation((r) => r + 90)} className="ctl" />
        <IconButton icon={ZoomOut} label="Zoom out" onClick={() => setZoom((z) => Math.max(1, z / 1.25))} className="ctl" />
        <IconButton icon={ZoomIn} label="Zoom in" onClick={() => setZoom((z) => Math.min(10, z * 1.25))} className="ctl" />
        <IconButton icon={playing ? Pause : Play} label={playing ? 'Stop slideshow' : 'Start slideshow'} active={playing} onClick={() => setPlaying((p) => !p)} className="ctl" />
        <IconButton icon={Info} label="Info" active={showInfo} onClick={() => setShowInfo((v) => !v)} className="ctl" />
      </ReaderTop>
      {list.length > 1 && (
        <>
          <button type="button" className="reader__edge reader__edge--left" aria-label="Previous photo" onClick={() => go(-1)}><ChevronLeft size={26} /></button>
          <button type="button" className="reader__edge reader__edge--right" aria-label="Next photo" onClick={() => go(1)}><ChevronRight size={26} /></button>
        </>
      )}
      {showInfo && (
        <aside className="viewer__info glass-dark">
          <h3 className="t-headline truncate">{cur.title}</h3>
          <dl className="info-list info-list--compact">
            <div className="info-list__row"><dt>Size</dt><dd>{formatBytes(cur.size)}</dd></div>
            <div className="info-list__row"><dt>Dimensions</dt><dd>{natural ? `${natural.w} × ${natural.h}` : cur.width ? `${cur.width} × ${cur.height}` : '—'}</dd></div>
            <div className="info-list__row"><dt>Type</dt><dd>{cur.ext.toUpperCase()}{cur.pages > 1 ? ` · ${cur.pages} frames` : ''}</dd></div>
            <div className="info-list__row"><dt>Modified</dt><dd>{new Date(cur.mtimeMs).toLocaleString()}</dd></div>
            <div className="info-list__row"><dt>Folder</dt><dd className="info-list__path">{cur.dir}</dd></div>
          </dl>
        </aside>
      )}
      {list.length > 1 && (
        <div className={`film glass-dark ${ui.visible ? '' : 'is-hidden'}`} ref={strip} onMouseEnter={() => ui.pin(true)} onMouseLeave={() => ui.pin(false)}>
          {list.map((m, i) => (
            <button key={m.id} type="button" className={`film__item ${i === index ? 'is-on' : ''}`} onClick={() => { setIndex(i); setZoom(1); setRotation(0); }} aria-label={m.title} aria-current={i === index}>
              <Artwork mediaId={m.id} hasArt title={m.title} kind="image" shape="square" fit="cover" version={m.mtimeMs} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
