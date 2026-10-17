import {
  Camera, ChevronDown, ChevronsLeftRightEllipsis, Expand, Gauge, ListVideo, Maximize, Minimize, Pause, PictureInPicture2, PictureInPicture, Play, RotateCcw, RotateCw, Captions,
  SkipBack, SkipForward, Volume1, Volume2, VolumeX, AudioLines, ScanLine, X, PanelTopOpen
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatBitrate, formatDuration, formatFps, formatResolution } from '@shared/format';
import { activeCues, type Cue } from '@shared/subtitles';
import { audioTrackLabel } from '@shared/playback-plan';
import { invoke } from '../api';
import { Icon, IconButton, SkipGlyph, Spinner } from '../components/ui';
import { registerHandlers } from '../lib/hotkeys';
import { useApp } from '../state/app';
import { useSettings } from '../state/settings';
import { useUi, type MenuEntry } from '../state/ui';
import { navigate } from '../state/router';
import { videoEngine, useVideoPlayer } from '../lib/video-engine';
import { artUrl } from '../lib/art';
import { ChapterPicker } from './ChapterPicker';
import { SeekBar } from './SeekBar';
import { SkipPrompt } from './SkipPrompt';
import { SpeedDial } from './SpeedDial';

const fmtSpeed = (r: number) => `${Number.isInteger(r) ? r : r.toFixed(2).replace(/0$/, '')}×`;

export function VideoPlayerHost() {
  const open = useVideoPlayer((s) => s.open);
  const mode = useApp((s) => s.win.mode);
  if (!open) return null;
  return mode === 'normal' ? <VideoPlayer /> : <CompactVideo mode={mode} />;
}

/** Keeps the single <video> element mounted in whichever layout is showing. */
function useVideoMount() {
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    el.appendChild(videoEngine.video);
    return () => { videoEngine.video.remove(); };
  }, []);
  return stage;
}

function useVideoHotkeys(onSpeed: () => void) {
  useEffect(() => {
    const p = () => useSettings.getState().settings.playback;
    const v = () => useVideoPlayer.getState();
    return registerHandlers({
      'media.playPause': () => { v().toggle(); },
      'media.stop': () => { v().close(); },
      'media.seekBack': () => { v().seekBy(-p().skipBackSec); },
      'media.seekForward': () => { v().seekBy(p().skipForwardSec); },
      'media.seekBackLong': () => { v().seekBy(-60); },
      'media.seekForwardLong': () => { v().seekBy(60); },
      'media.next': () => { v().next(); },
      'media.previous': () => { v().previous(); },
      'media.volumeUp': () => { v().setVolume(useSettings.getState().settings.audio.volume + 0.05); },
      'media.volumeDown': () => { v().setVolume(useSettings.getState().settings.audio.volume - 0.05); },
      'media.mute': () => { v().toggleMute(); },
      'media.speedUp': () => { v().stepSpeed(1); },
      'media.speedDown': () => { v().stepSpeed(-1); },
      'media.speedReset': () => { v().setSpeed(1); },
      'media.speedFine': () => { onSpeed(); },
      'media.frameForward': () => { v().frameStep(1); },
      'media.frameBack': () => { v().frameStep(-1); },
      'media.jumpStart': () => { v().seek(0); },
      'video.subtitles': () => { v().toggleSubtitles(); },
      'video.subtitleNext': () => { v().cycleSubtitle(); },
      'video.subDelayMinus': () => { v().setSubtitleDelay(v().subtitleDelay - 0.1); },
      'video.subDelayPlus': () => { v().setSubtitleDelay(v().subtitleDelay + 0.1); },
      'video.audioNext': () => { v().cycleAudio(); },
      'video.chapterNext': () => { v().jumpChapter(1); },
      'video.chapterPrev': () => { v().jumpChapter(-1); },
      'video.pip': () => { void v().togglePip(); },
      'video.stats': () => { v().toggleStats(); },
      'video.aspect': () => { v().cycleAspect(); },
      'video.screenshot': () => { void v().screenshot(); },
      'video.close': () => {
        if (useApp.getState().win.fullscreen) void invoke('window:fullscreen', false);
        else v().close();
      },
      // Number keys jump to 0–90 %.
      ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`video.percent${n}`, () => { const d = v().duration; if (d) v().seek((d * n) / 10); }]))
    });
  }, [onSpeed]);
}

// ---------------------------------------------------------------------------

function VideoPlayer() {
  const stage = useVideoMount();
  const s = useVideoPlayer();
  const fullscreen = useApp((x) => x.win.fullscreen);
  const [speedOpen, setSpeedOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useVideoHotkeys(() => setSpeedOpen((o) => !o));

  useEffect(() => { videoEngine.video.style.objectFit = s.aspect === 'fit' ? 'contain' : s.aspect === 'fill' ? 'cover' : 'fill'; }, [s.aspect]);
  const item = s.item;

  return (
    <div
      ref={rootRef}
      className={`player ${s.controlsVisible || !s.playing || speedOpen ? '' : 'is-idle'}`}
      onMouseMove={() => videoEngine.showControls()}
      onMouseLeave={() => { if (s.playing) videoEngine.pinControls(false); }}
      role="region" aria-label={item ? `Playing ${item.title}` : 'Video player'}
    >
      <div className="player__stage" ref={stage} onClick={() => s.toggle()} onDoubleClick={() => void invoke('window:fullscreen')} />
      <SubtitleLayer />
      {s.buffering && s.phase !== 'error' && <div className="player__spinner"><Spinner size={34} /></div>}
      {s.osd && <div key={s.osd.id} className="osd" aria-live="polite">{s.osd.text}</div>}
      {s.phase === 'error' && <PlayerError message={s.error ?? 'This video could not be played.'} onRetry={() => item && videoEngine.jumpToStart(item)} onClose={() => s.close()} />}
      {s.statsOpen && <StatsOverlay />}

      <div className="player__top" onMouseEnter={() => videoEngine.pinControls(true)} onMouseLeave={() => videoEngine.pinControls(false)}>
        <button type="button" className="glass-btn" onClick={() => s.close()} aria-label="Close player" title="Close player (Esc)"><ChevronDown size={18} strokeWidth={2.2} /></button>
        <div className="player__title">
          <div className="truncate player__name">{item?.title}</div>
          <div className="truncate player__sub">{[item?.series, item?.vclass === 'episode' && item.episode != null ? `S${item.season ?? 1}E${item.episode}` : item?.year].filter(Boolean).join(' · ')}</div>
        </div>
        {s.session && s.session.mode !== 'direct' && (
          <span className="mode-pill" title={s.session.reason}>{s.session.mode === 'remux' ? 'Direct stream' : s.session.encoder.includes('libx') ? 'Transcoding' : 'Transcoding · GPU'}</span>
        )}
      </div>

      <ControlBar speedOpen={speedOpen} setSpeedOpen={setSpeedOpen} fullscreen={fullscreen} />
      <SkipPrompt />
      {s.upNext && <UpNext />}
    </div>
  );
}

function PlayerError({ message, onRetry, onClose }: { message: string; onRetry: () => void; onClose: () => void }) {
  return (
    <div className="player__error" role="alert">
      <div className="t-title-3">Can’t play this video</div>
      <p className="secondary">{message}</p>
      <div className="player__error-actions">
        <button type="button" className="btn btn--primary" onClick={onRetry}>Try Again</button>
        <button type="button" className="btn btn--glass" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subtitles — rendered by the app so size, colour, background, position and delay are all adjustable.

function SubtitleLayer() {
  const cues = useVideoPlayer((s) => s.cues);
  const delay = useVideoPlayer((s) => s.subtitleDelay);
  const style = useSettings((s) => s.settings.playback.subtitleStyle);
  const [active, setActive] = useState<Cue[]>([]);

  useEffect(() => {
    if (cues.length === 0) { setActive([]); return; }
    let raf = 0;
    let lastKey = '';
    const loop = () => {
      const list = activeCues(cues, videoEngine.currentTime - delay);
      const key = list.map((c) => `${c.start}|${c.html}`).join('¦');
      if (key !== lastKey) { lastKey = key; setActive(list); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cues, delay]);

  const groups = (['top', 'middle', 'bottom'] as const).map((a) => ({ anchor: a, list: active.filter((c) => c.anchor === a) })).filter((g) => g.list.length);
  const font = { system: 'var(--font-sans)', serif: 'var(--font-serif)', mono: 'var(--font-mono)', rounded: "ui-rounded, 'SF Pro Rounded', var(--font-sans)" }[style.font];
  return (
    <div className="subs" style={{ '--sub-scale': style.size, '--sub-color': style.color, '--sub-bg': `rgba(0,0,0,${style.background})`, '--sub-bottom': `${style.bottom}%`, fontFamily: font } as React.CSSProperties} aria-live="off">
      {groups.map((g) => (
        <div key={g.anchor} className={`subs__group subs__group--${g.anchor}`}>
          {g.list.map((c, i) => (
            <div key={i} className={`subs__cue ${style.outline ? 'has-outline' : ''}`} style={{ textAlign: c.align }} dangerouslySetInnerHTML={{ __html: c.html }} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Controls

function ControlBar({ speedOpen, setSpeedOpen, fullscreen }: { speedOpen: boolean; setSpeedOpen: (v: boolean) => void; fullscreen: boolean }) {
  const s = useVideoPlayer();
  const settings = useSettings((x) => x.settings);
  const controls = settings.controls.video;
  const audio = settings.audio;
  const [remaining, setRemaining] = useState(false);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const timeRef = useRef<HTMLSpanElement>(null);
  const speedBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (timeRef.current) {
        const t = videoEngine.currentTime;
        timeRef.current.textContent = remaining ? `−${formatDuration(Math.max(0, s.duration - t))}` : formatDuration(t);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [remaining, s.duration]);

  const anchorMenu = (el: HTMLElement, entries: MenuEntry[]) => {
    const r = el.getBoundingClientRect();
    useUi.getState().openMenu(r.left + r.width / 2 - 110, r.top - 10, entries, { above: true, minWidth: 220 });
  };

  const audioMenu = (e: React.MouseEvent) => anchorMenu(e.currentTarget as HTMLElement, s.audioTracks.map((a, i) => ({ label: audioTrackLabel(a, i), checked: i === s.audioIndex, run: () => s.setAudio(i) })));
  const subMenu = (e: React.MouseEvent) => anchorMenu(e.currentTarget as HTMLElement, [
    { label: 'Off', checked: s.subtitleId == null, run: () => s.setSubtitle(null) },
    ...s.subtitleTracks.map((t) => ({ label: `${t.label}${t.source === 'external' ? ' (file)' : ''}`, checked: t.id === s.subtitleId, run: () => s.setSubtitle(t.id) })),
    { separator: true },
    { label: `Delay ${s.subtitleDelay >= 0 ? '+' : '−'}${Math.abs(s.subtitleDelay).toFixed(1)} s`, disabled: true },
    { label: 'Earlier (−0.1 s)', run: () => s.setSubtitleDelay(s.subtitleDelay - 0.1) },
    { label: 'Later (+0.1 s)', run: () => s.setSubtitleDelay(s.subtitleDelay + 0.1) },
    { label: 'Reset Delay', run: () => s.setSubtitleDelay(0) },
    { separator: true },
    { label: 'Subtitle Appearance…', run: () => { s.close(); navigate({ name: 'settings', pane: 'playback' }); } }
  ]);
  const chapterMenu = () => setChaptersOpen(true);

  const VolIcon = audio.muted || audio.volume === 0 ? VolumeX : audio.volume < 0.45 ? Volume1 : Volume2;
  const hasAudioChoice = s.audioTracks.length > 1;
  const hasSubs = s.subtitleTracks.length > 0;

  const defs: Record<string, React.ReactNode> = {
    skipBack: <IconButton key="skipBack" icon={RotateCcw} glyph={<SkipGlyph dir="back" seconds={settings.playback.skipBackSec} size={26} />} label={`Back ${settings.playback.skipBackSec} seconds`} onClick={() => s.seekBy(-settings.playback.skipBackSec)} className="ctl" />,
    playPause: <button key="playPause" type="button" className="ctl-play" onClick={() => s.toggle()} aria-label={s.playing ? 'Pause' : 'Play'}><Icon as={s.playing ? Pause : Play} size={26} fill="currentColor" strokeWidth={0} /></button>,
    skipForward: <IconButton key="skipForward" icon={RotateCw} glyph={<SkipGlyph dir="forward" seconds={settings.playback.skipForwardSec} size={26} />} label={`Forward ${settings.playback.skipForwardSec} seconds`} onClick={() => s.seekBy(settings.playback.skipForwardSec)} className="ctl" />,
    next: <IconButton key="next" icon={SkipForward} label="Next" onClick={() => s.next()} className="ctl" size={19} />,
    previous: <IconButton key="previous" icon={SkipBack} label="Previous" onClick={() => s.previous()} className="ctl" size={19} />,
    volume: (
      <div key="volume" className="vol">
        <IconButton icon={VolIcon} label={audio.muted ? 'Unmute' : 'Mute'} onClick={() => s.toggleMute()} className="ctl" />
        <input type="range" className="slider vol__slider" min={0} max={100} value={audio.muted ? 0 : Math.round(audio.volume * 100)} aria-label="Volume" style={{ '--p': `${audio.muted ? 0 : audio.volume * 100}%` } as React.CSSProperties} onChange={(e) => s.setVolume(Number(e.target.value) / 100)} />
      </div>
    ),
    speed: <button key="speed" ref={speedBtn} type="button" className={`ctl-pill ${s.speed !== 1 ? 'is-on' : ''}`} onClick={() => setSpeedOpen(!speedOpen)} aria-label={`Playback speed ${fmtSpeed(s.speed)}`} title="Playback speed ( S )"><Gauge size={15} />{fmtSpeed(s.speed)}</button>,
    audio: hasAudioChoice ? <IconButton key="audio" icon={AudioLines} label="Audio track" onClick={audioMenu} className="ctl" /> : null,
    subtitles: hasSubs ? <IconButton key="subtitles" icon={Captions} label="Subtitles" active={s.subtitleId != null} onClick={subMenu} className="ctl" /> : null,
    chapters: s.chapters.length > 0 ? <IconButton key="chapters" icon={ListVideo} label="Chapters" onClick={chapterMenu} className="ctl" /> : null,
    pip: <IconButton key="pip" icon={s.pip ? PictureInPicture : PictureInPicture2} label="Picture in Picture" active={s.pip} onClick={() => void s.togglePip()} className="ctl" />,
    mini: <IconButton key="mini" icon={PanelTopOpen} label="Mini player" onClick={() => void invoke('window:setMode', 'mini')} className="ctl" />,
    overlay: <IconButton key="overlay" icon={ScanLine} label="Overlay on top of other windows" onClick={() => void invoke('window:setMode', 'overlay')} className="ctl" />,
    screenshot: <IconButton key="screenshot" icon={Camera} label="Save screenshot" onClick={() => void s.screenshot()} className="ctl" />,
    stats: <IconButton key="stats" icon={ChevronsLeftRightEllipsis} label="Playback statistics" active={s.statsOpen} onClick={() => s.toggleStats()} className="ctl" />,
    aspect: <IconButton key="aspect" icon={Expand} label={`Aspect: ${s.aspect}`} onClick={() => s.cycleAspect()} className="ctl" />,
    fullscreen: <IconButton key="fullscreen" icon={fullscreen ? Minimize : Maximize} label={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={() => void invoke('window:fullscreen')} className="ctl" />
  };
  const transportIds = ['skipBack', 'playPause', 'skipForward', 'next', 'previous'];
  const left = controls.filter((c) => c === 'volume');
  const center = controls.filter((c) => transportIds.includes(c));
  const right = controls.filter((c) => c !== 'volume' && !transportIds.includes(c));
  const render = (ids: string[]) => ids.map((id) => defs[id]);

  return (
    <div className="player__bottom" onMouseEnter={() => videoEngine.pinControls(true)} onMouseLeave={() => videoEngine.pinControls(false)}>
      <div className="bar glass">
        <div className="bar__timeline">
          <span className="bar__time tabular" ref={timeRef}>0:00</span>
          <SeekBar
            duration={s.duration} getTime={() => videoEngine.currentTime} buffered={s.buffered} chapters={s.chapters} sprite={s.sprite} onSeek={(t) => s.seek(t)}
            onInteract={(a) => videoEngine.pinControls(a)} previews={settings.playback.seekPreview} label="Seek"
          />
          <button type="button" className="bar__time bar__time--btn tabular" onClick={() => setRemaining(!remaining)} title="Toggle remaining time">{remaining ? formatDuration(s.duration) : `−${formatDuration(Math.max(0, s.duration - s.time))}`}</button>
        </div>
        <div className="bar__row">
          <div className="bar__group bar__group--left">{render(left)}</div>
          <div className="bar__group bar__group--center">{render(center)}</div>
          <div className="bar__group bar__group--right">{render(right)}</div>
        </div>
        {speedOpen && (
          <div className="speed-anchor"><SpeedDial value={s.speed} onChange={(v) => s.setSpeed(v)} onClose={() => setSpeedOpen(false)} /></div>
        )}
        {chaptersOpen && <ChapterPicker chapters={s.chapters} sprite={s.sprite} time={videoEngine.currentTime} onPick={(t) => s.seek(t)} onClose={() => setChaptersOpen(false)} />}
      </div>
    </div>
  );
}

function UpNext() {
  const un = useVideoPlayer((s) => s.upNext)!;
  const s = useVideoPlayer.getState();
  const it = un.item;
  return (
    <div className="upnext glass" role="dialog" aria-label="Up next">
      <div className="upnext__art" style={{ backgroundImage: it.hasArt ? `url(${artUrl(it.id, 'thumb', it.mtimeMs)})` : undefined }} />
      <div className="upnext__text">
        <div className="t-caps">Up next · {un.secondsLeft}s</div>
        <div className="truncate t-headline">{it.title}</div>
        <div className="truncate secondary t-footnote">{it.series ?? ''}{it.episode != null ? ` · S${it.season ?? 1}E${it.episode}` : ''}</div>
        <div className="upnext__actions">
          <button type="button" className="btn btn--primary btn--sm" onClick={() => s.playUpNext()}><Play size={13} fill="currentColor" strokeWidth={0} />Play Now</button>
          <button type="button" className="btn btn--glass btn--sm" onClick={() => s.cancelUpNext()}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function StatsOverlay() {
  const s = useVideoPlayer();
  const info = useApp((x) => x.info);
  const it = s.item;
  const st = s.stats;
  const video = s.probe?.streams.find((x) => x.type === 'video' && !x.attachedPic);
  const audio = s.audioTracks[s.audioIndex];
  const rows: [string, string][] = [
    ['Video', video ? `${video.width}×${video.height} ${formatResolution(video.width, video.height)} · ${video.codec.toUpperCase()} ${video.profile}${video.bitDepth > 8 ? ` · ${video.bitDepth}-bit` : ''} · ${video.pixFmt}` : '—'],
    ['Frame rate', `${st ? st.presentedFps.toFixed(1) : '…'} fps shown · ${video ? formatFps(video.fps) : '—'} source · ${info?.displayRefreshRate ?? '—'} Hz display`],
    ['Dropped', st ? `${st.droppedFrames} of ${st.totalFrames} frames` : '…'],
    ['Playback', s.session ? `${s.session.mode === 'direct' ? 'Direct play' : s.session.mode === 'remux' ? 'Direct stream' : 'Transcode'} · ${s.session.reason}` : '—'],
    ...(s.session && s.session.mode !== 'direct' ? [['Converted to', `${s.session.videoCodecOut.toUpperCase() || '—'} (${s.session.encoder}) + ${s.session.audioCodecOut.toUpperCase()}`] as [string, string]] : []),
    ['Audio', audio ? `${audio.codec.toUpperCase()} · ${audio.channels} ch · ${audio.sampleRate / 1000} kHz${audio.language ? ` · ${audio.language}` : ''}` : '—'],
    ['Container', `${it?.container.toUpperCase() ?? ''} · ${s.probe ? formatBitrate(s.probe.bitrate) : ''}`],
    ['Buffer', st ? `${st.bufferAhead.toFixed(1)} s ahead` : '…'],
    ['Speed', `${fmtSpeed(s.speed)} · subtitle delay ${s.subtitleDelay.toFixed(1)} s`]
  ];
  return (
    <div className="stats-overlay" role="status">
      <div className="t-caps">Playback statistics</div>
      {rows.map(([k, v]) => <div key={k} className="stats-overlay__row"><span>{k}</span><span>{v}</span></div>)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact layouts for the mini window and always-on-top overlay

function CompactVideo({ mode }: { mode: 'mini' | 'overlay' }) {
  const stage = useVideoMount();
  const s = useVideoPlayer();
  const [opacity, setOpacity] = useState(1);
  const [through, setThrough] = useState(false);
  useVideoHotkeys(() => {});
  useEffect(() => {
    const v = s.probe?.streams.find((x) => x.type === 'video' && !x.attachedPic);
    // Both floating windows follow the picture's shape, so the video is never letterboxed or cropped.
    if (v && v.width && v.height) void invoke('window:setAspect', v.width / v.height);
  }, [mode, s.probe]);
  useEffect(() => () => { void invoke('window:setAspect', 0); }, []);
  useEffect(() => { videoEngine.video.style.objectFit = 'contain'; }, []);
  return (
    <div className="compact compact--video" data-mode={mode}>
      <div className="compact__stage" ref={stage} onClick={() => s.toggle()} onDoubleClick={() => void invoke('window:setMode', 'normal')} />
      <SubtitleLayer />
      {s.buffering && <div className="player__spinner"><Spinner size={26} /></div>}
      <div className="compact__top drag">
        <div className="truncate compact__title">{s.item?.title}</div>
        <div className="compact__btns no-drag">
          <IconButton icon={Expand} label="Back to full window" onClick={() => void invoke('window:setMode', 'normal')} size={15} className="ctl" />
          <IconButton icon={X} label="Close" onClick={() => { s.close(); void invoke('window:setMode', 'normal'); }} size={15} className="ctl" />
        </div>
      </div>
      <div className="compact__bottom no-drag">
        <div className="compact__transport">
          <IconButton icon={RotateCcw} label="Back 10 seconds" onClick={() => s.seekBy(-10)} size={16} className="ctl" />
          <button type="button" className="ctl-play ctl-play--sm" onClick={() => s.toggle()} aria-label={s.playing ? 'Pause' : 'Play'}><Icon as={s.playing ? Pause : Play} size={18} fill="currentColor" strokeWidth={0} /></button>
          <IconButton icon={RotateCw} label="Forward 10 seconds" onClick={() => s.seekBy(10)} size={16} className="ctl" />
          {mode === 'overlay' && (
            <>
              <input type="range" className="slider compact__opacity" min={25} max={100} value={Math.round(opacity * 100)} aria-label="Overlay opacity" title="Opacity" style={{ '--p': `${((opacity * 100 - 25) / 75) * 100}%` } as React.CSSProperties}
                onChange={(e) => { const o = Number(e.target.value) / 100; setOpacity(o); void invoke('window:overlay', { opacity: o }); }} />
              <button type="button" className={`ctl-pill ${through ? 'is-on' : ''}`} title="Let clicks pass through to the windows underneath. Press Ctrl/⌘+Alt+L to get control back." onClick={() => { const v = !through; setThrough(v); void invoke('window:overlay', { clickThrough: v }); if (v) useUi.getState().toast('info', 'Click-through on — press Ctrl/⌘+Alt+L to make the overlay interactive again'); }}>Click-through</button>
            </>
          )}
        </div>
        <SeekBar compact duration={s.duration} getTime={() => videoEngine.currentTime} buffered={s.buffered} chapters={s.chapters} sprite={null} previews={false} onSeek={(t) => s.seek(t)} label="Seek" />
      </div>
    </div>
  );
}

