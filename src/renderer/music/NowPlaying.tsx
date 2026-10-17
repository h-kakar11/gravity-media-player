import { ChevronDown, GripVertical, ListMusic, Mic2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { activeLyricIndex } from '@shared/lyrics';
import { formatDuration } from '@shared/format';
import type { LyricsResult, MediaItem } from '@shared/types';
import { invoke } from '../api';
import { Artwork } from '../components/Artwork';
import { Scrubber } from '../components/Scrubber';
import { Button, EmptyState, Icon, IconButton, Segmented } from '../components/ui';
import { artUrl } from '../lib/art';
import { audioGraph } from '../lib/audio-graph';
import { registerHandlers } from '../lib/hotkeys';
import { artistOf, albumKeyOf, artistKeyOf } from '../lib/media';
import { musicEngine, useMusic, type NowPlayingTab } from '../lib/music-engine';
import { navigate } from '../state/router';
import { useSettings } from '../state/settings';
import { useApp } from '../state/app';
import { toast } from '../state/ui';
import '../styles/lyrics.css';
import { Equalizer } from './Equalizer';
import { VolumeControl } from './MusicBar';

export function NowPlaying() {
  const open = useMusic((s) => s.nowPlayingOpen);
  const mode = useApp((s) => s.win.mode);
  if (!open || mode !== 'normal') return null;
  return <NowPlayingSheet />;
}

function NowPlayingSheet() {
  const s = useMusic();
  const item = s.queue[s.index];
  const visualizer = useSettings((x) => x.settings.audio.visualizer);
  const getTime = useMemo(() => () => musicEngine.currentTime, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest?.('.menu')) { e.stopPropagation(); useMusic.getState().closeNowPlaying(); } };
    window.addEventListener('keydown', key, true);
    const off = registerHandlers({
      'music.lyrics': () => { useMusic.getState().setTab(useMusic.getState().tab === 'lyrics' ? 'art' : 'lyrics'); },
      'music.queue': () => { useMusic.getState().setTab(useMusic.getState().tab === 'queue' ? 'art' : 'queue'); }
    });
    return () => { window.removeEventListener('keydown', key, true); off(); };
  }, []);

  if (!item) return null;
  const bg = item.hasArt ? artUrl(item.id, 'thumb', item.mtimeMs) : null;
  return (
    <div className="np" role="dialog" aria-label="Now Playing">
      <div className="np__bg" aria-hidden="true">
        {bg && <div className="np__bg-img" style={{ backgroundImage: `url(${bg})` }} />}
        <div className="np__bg-scrim" />
        {visualizer && s.playing && <Visualizer />}
      </div>
      <header className="np__top drag">
        <div className="no-drag np__top-left"><IconButton icon={ChevronDown} label="Close Now Playing" onClick={() => s.closeNowPlaying()} size={20} className="np-btn" /></div>
        <div className="no-drag">
          <Segmented<NowPlayingTab> label="Panel" value={s.tab} onChange={s.setTab} options={[{ value: 'art', label: 'Artwork' }, { value: 'lyrics', icon: Mic2, label: 'Lyrics' }, { value: 'queue', icon: ListMusic, label: 'Queue' }, { value: 'eq', icon: SlidersHorizontal, label: 'EQ' }]} />
        </div>
        <div className="np__top-right" />
      </header>

      <div className={`np__body np__body--${s.tab}`}>
        <section className="np__player">
          <div className={`np__art ${s.playing ? 'is-playing' : ''}`}>
            <Artwork mediaId={item.id} hasArt={item.hasArt} title={item.title} kind="audio" shape="square" size="large" fit="cover" version={item.mtimeMs} eager />
          </div>
          <div className="np__info">
            <h1 className="np__title truncate">{item.title}</h1>
            <button type="button" className="np__artist truncate" onClick={() => { s.closeNowPlaying(); navigate({ name: 'artist', key: artistKeyOf(item) }); }}>{artistOf(item)}</button>
            {item.album && <button type="button" className="np__album truncate" onClick={() => { s.closeNowPlaying(); navigate({ name: 'album', key: albumKeyOf(item) }); }}>{item.album}</button>}
            <div className="np__fmt">{[item.acodec.toUpperCase(), item.sampleRate ? `${item.sampleRate / 1000} kHz` : '', item.bitDepth > 16 ? `${item.bitDepth}-bit` : '', item.bitrate ? `${Math.round(item.bitrate / 1000)} kbps` : ''].filter(Boolean).join(' · ')}</div>
          </div>
          <Scrubber className="np__scrub" duration={s.duration} getTime={getTime} onSeek={(t) => s.seek(t)} showTimes />
          <div className="np__transport">
            <IconButton icon={Shuffle} label="Shuffle" active={s.shuffle} onClick={() => s.setShuffle(!s.shuffle)} size={19} className="np-btn" />
            <IconButton icon={SkipBack} label="Previous" onClick={() => s.previous()} size={28} className="np-btn" />
            <button type="button" className="ctl-play ctl-play--xl" onClick={() => s.toggle()} aria-label={s.playing ? 'Pause' : 'Play'}><Icon as={s.playing ? Pause : Play} size={32} fill="currentColor" strokeWidth={0} /></button>
            <IconButton icon={SkipForward} label="Next" onClick={() => s.next()} size={28} className="np-btn" />
            <IconButton icon={s.repeat === 'one' ? Repeat1 : Repeat} label={`Repeat: ${s.repeat}`} active={s.repeat !== 'off'} onClick={() => s.cycleRepeat()} size={19} className="np-btn" />
          </div>
          <VolumeControl />
        </section>

        {s.tab !== 'art' && (
          <section className="np__panel">
            {s.tab === 'lyrics' && <LyricsPanel item={item} />}
            {s.tab === 'queue' && <QueuePanel />}
            {s.tab === 'eq' && <Equalizer />}
          </section>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function LyricsPanel({ item }: { item: MediaItem }) {
  const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const lastScroll = useRef(-2);
  const online = useSettings((x) => x.settings.lyrics.lrclib);
  const saveLrc = () => {
    invoke('lyrics:save', item.id).then(() => toast('success', 'Saved a .lrc file next to the song')).catch((e: Error) => toast('error', e.message));
  };

  useEffect(() => {
    let live = true;
    setLyrics(null);
    setActive(-1);
    invoke('playback:lyrics', item.id).then((l) => live && setLyrics(l)).catch(() => live && setLyrics({ synced: false, lines: [], source: 'none' }));
    return () => { live = false; };
  }, [item.id, online]);

  useEffect(() => {
    if (!lyrics?.synced) return;
    let raf = 0;
    const loop = () => {
      const i = activeLyricIndex(lyrics.lines, musicEngine.currentTime + 0.15);
      setActive((p) => (p === i ? p : i));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [lyrics]);

  useEffect(() => {
    if (active < 0 || active === lastScroll.current) return;
    lastScroll.current = active;
    const el = box.current?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    const scroller = box.current?.closest<HTMLElement>('.np__panel');
    if (!el || !scroller) return;
    // Centre the line inside the lyrics panel only. scrollIntoView would also scroll every ancestor, which
    // slides the whole Now Playing sheet (it clips with overflow: hidden) off the top of a short window.
    const offset = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTo({ top: offset - scroller.clientHeight / 2 + el.clientHeight / 2, behavior: useApp.getState().win.focused ? 'smooth' : 'auto' });
  }, [active]);

  if (!lyrics) return <div className="np__empty secondary">Loading lyrics…</div>;
  if (lyrics.lines.length === 0) {
    return <EmptyState icon={Mic2} title="No lyrics for this song" message={online ? 'LRCLIB has nothing for this song. You can put a .lrc file with the same name next to it, or embed lyrics in the file’s tags.' : 'Put a .lrc file with the same name next to the song, embed lyrics in its tags, or turn on LRCLIB in Settings → Audio to look them up online.'}>{!online && <Button variant="secondary" onClick={() => navigate({ name: 'settings', pane: 'audio' })}>Open Audio Settings</Button>}</EmptyState>;
  }
  return (
    <div className="lyrics" ref={box}>
      {lyrics.lines.map((l, i) => (
        <p key={i} data-i={i} className={`lyrics__line ${lyrics.synced ? 'is-synced' : ''} ${i === active ? 'is-active' : i < active ? 'is-past' : ''}`} onClick={() => lyrics.synced && useMusic.getState().seek(l.timeSec)}>{l.text || '♪'}</p>
      ))}
      <div className="lyrics__src t-footnote tertiary">
        {lyrics.synced ? 'Synced lyrics' : 'Lyrics'} · from {lyrics.source === 'lrc' ? 'a .lrc file' : lyrics.source === 'lrclib' ? 'LRCLIB' : 'file tags'}
        {lyrics.source === 'lrclib' && lyrics.synced && <button type="button" className="lyrics__save" onClick={saveLrc}>Save as .lrc</button>}
      </div>
    </div>
  );
}

function QueuePanel() {
  const queue = useMusic((s) => s.queue);
  const index = useMusic((s) => s.index);
  const history = useMusic((s) => s.history);
  const playing = useMusic((s) => s.playing);
  const m = useMusic.getState();
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const current = queue[index];
  const upcoming = queue.slice(index + 1);
  const past = history.filter((h) => h.id !== current?.id).slice(0, 8);

  const row = (it: MediaItem, i: number, kind: 'past' | 'now' | 'next') => (
    <div
      key={`${kind}${it.id}${i}`} className={`qrow ${kind === 'now' ? 'is-now' : ''} ${over === i && kind === 'next' ? 'is-over' : ''}`}
      draggable={kind === 'next'} onDragStart={() => setDragIdx(i)} onDragOver={(e) => { if (kind === 'next') { e.preventDefault(); setOver(i); } }}
      onDragEnd={() => { setDragIdx(null); setOver(null); }}
      onDrop={() => { if (dragIdx != null && kind === 'next') m.move(dragIdx, i); setDragIdx(null); setOver(null); }}
      onDoubleClick={() => kind === 'next' && m.playIndex(i)}
    >
      {kind === 'next' && <GripVertical size={14} className="qrow__grip tertiary" />}
      <div className="qrow__art"><Artwork mediaId={it.id} hasArt={it.hasArt} title={it.title} kind="audio" shape="square" fit="cover" version={it.mtimeMs} /></div>
      <div className="qrow__text"><div className="truncate">{it.title}</div><div className="truncate secondary t-footnote">{artistOf(it)}</div></div>
      <span className="qrow__time secondary tabular t-footnote">{formatDuration(it.durationSec)}</span>
      {kind === 'next' && <IconButton icon={X} label="Remove from queue" size={14} className="qrow__x" onClick={() => m.removeAt(i)} />}
      {kind === 'past' && <IconButton icon={Play} label="Play again" size={14} className="qrow__x" onClick={() => m.playItems([it], 0)} />}
    </div>
  );

  return (
    <div className="queue">
      {current && <><h3 className="t-caps">Now playing</h3>{row(current, index, 'now')}</>}
      <div className="queue__head"><h3 className="t-caps">Playing next · {upcoming.length}</h3>{upcoming.length > 0 && <Button size="sm" icon={Trash2} onClick={() => m.clearUpcoming()}>Clear</Button>}</div>
      {upcoming.length === 0 ? <p className="secondary t-subhead queue__empty">Nothing queued after this song{m.repeat === 'all' ? ' — repeat is on, so the queue starts again' : ''}.</p> : upcoming.map((it, k) => row(it, index + 1 + k, 'next'))}
      {past.length > 0 && <><h3 className="t-caps queue__past-h">Recently played</h3>{past.map((it, i) => row(it, i, 'past'))}</>}
      <span className="sr-only" aria-live="polite">{playing ? 'Playing' : 'Paused'}</span>
    </div>
  );
}

/** Soft spectrum bars rising from the bottom edge, tinted with the accent colour. */
function Visualizer() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const bins = new Uint8Array(new ArrayBuffer(audioGraph.analyser?.frequencyBinCount ?? 2048));
    let raf = 0;
    const smooth = new Float32Array(72);
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const a = audioGraph.analyser;
      if (a) {
        a.getByteFrequencyData(bins);
        const nyq = audioGraph.sampleRate / 2;
        const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4a93ff';
        const barW = w / smooth.length;
        for (let i = 0; i < smooth.length; i++) {
          const f = 40 * Math.pow(500, i / (smooth.length - 1));
          const bin = Math.min(bins.length - 1, Math.round((f / nyq) * bins.length));
          const v = (bins[bin]! / 255) ** 1.6;
          smooth[i] = Math.max(v, smooth[i]! * 0.9);
          const bh = smooth[i]! * h * 0.85;
          const g = ctx.createLinearGradient(0, h, 0, h - bh);
          g.addColorStop(0, color);
          g.addColorStop(1, 'transparent');
          ctx.fillStyle = g;
          ctx.globalAlpha = 0.5;
          ctx.beginPath();
          ctx.roundRect(i * barW + barW * 0.18, h - bh, barW * 0.64, bh, 3);
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas className="np__viz" ref={ref} />;
}
