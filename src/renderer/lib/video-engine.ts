import { create } from 'zustand';
import { chooseAudioIndex, candidateMimes, langMatches, planPlayback } from '@shared/playback-plan';
import { parseSubtitles, type Cue } from '@shared/subtitles';
import type { ChapterInfo, MediaItem, PlaybackMode, PlaybackSession, ProbeInfo, SpriteSheet, StreamInfo, SubtitleTrack } from '@shared/types';
import { invoke, quiet } from '../api';
import { audioGraph } from './audio-graph';
import { installMediaSession, setTransport } from './transport';
import { useSettings } from '../state/settings';
import { toast } from '../state/ui';
import { artUrl } from './art';

export type AspectMode = 'fit' | 'fill' | 'stretch';

export interface VideoStats {
  presentedFps: number;
  droppedFrames: number;
  totalFrames: number;
  width: number;
  height: number;
  bufferAhead: number;
}

export interface VideoState {
  open: boolean;
  queue: MediaItem[];
  index: number;
  item: MediaItem | null;
  phase: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  playing: boolean;
  buffering: boolean;
  time: number;
  duration: number;
  buffered: [number, number][];
  speed: number;
  session: PlaybackSession | null;
  probe: ProbeInfo | null;
  audioIndex: number;
  audioTracks: StreamInfo[];
  subtitleTracks: SubtitleTrack[];
  subtitleId: string | null;
  cues: Cue[];
  subtitleDelay: number;
  chapters: ChapterInfo[];
  sprite: SpriteSheet | null;
  aspect: AspectMode;
  controlsVisible: boolean;
  statsOpen: boolean;
  stats: VideoStats | null;
  pip: boolean;
  upNext: { item: MediaItem; secondsLeft: number } | null;
  osd: { text: string; id: number } | null;
  // actions
  play: (items: MediaItem[], index?: number, opts?: { startSec?: number }) => void;
  close: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  seekBy: (d: number) => void;
  setSpeed: (r: number) => void;
  stepSpeed: (dir: 1 | -1) => void;
  next: () => void;
  previous: () => void;
  setAudio: (i: number) => void;
  setSubtitle: (id: string | null) => void;
  setSubtitleDelay: (d: number) => void;
  toggleSubtitles: () => void;
  cycleSubtitle: () => void;
  cycleAudio: () => void;
  cycleAspect: () => void;
  toggleStats: () => void;
  showControls: () => void;
  togglePip: () => Promise<void>;
  screenshot: () => Promise<void>;
  jumpChapter: (dir: 1 | -1) => void;
  frameStep: (dir: 1 | -1) => void;
  cancelUpNext: () => void;
  playUpNext: () => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
}

export const SPEED_MIN = 0.1;
export const SPEED_MAX = 5;
const clampSpeed = (r: number) => Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, r)) * 100) / 100;

async function supportedMimes(probe: ProbeInfo, ext: string): Promise<Set<string>> {
  const out = new Set<string>();
  const v = document.createElement('video');
  const video = probe.streams.find((s) => s.type === 'video' && !s.attachedPic);
  await Promise.all(
    candidateMimes(probe, ext).map(async (mime) => {
      if (v.canPlayType(mime) === '') return;
      // mediaCapabilities knows about hardware limits (e.g. 10-bit or 8K) that canPlayType can't express.
      if (mime.startsWith('video/') && video && 'mediaCapabilities' in navigator) {
        try {
          const r = await navigator.mediaCapabilities.decodingInfo({
            type: 'file',
            video: { contentType: mime, width: Math.max(2, video.width), height: Math.max(2, video.height), bitrate: Math.max(500_000, probe.bitrate || 8_000_000), framerate: video.fps || 30 }
          });
          if (!r.supported) return;
        } catch { /* fall through: canPlayType said yes */ }
      }
      out.add(mime);
    })
  );
  return out;
}

function pickSubtitle(tracks: SubtitleTrack[], audio: StreamInfo | undefined, prefLangs: string[], mode: 'off' | 'auto' | 'always', remembered: string | null): string | null {
  if (remembered === 'none') return null;
  if (remembered && tracks.some((t) => t.id === remembered)) return remembered;
  if (mode === 'off' || tracks.length === 0) return null;
  const textual = tracks.filter((t) => t.format !== 'bitmap');
  const pool = textual.length ? textual : tracks;
  const audioLang = audio?.language ?? '';
  const preferred = prefLangs.find(() => true);
  const match = (forced: boolean) => pool.find((t) => !!preferred && langMatches(t.language, preferred) && t.isForced === forced);
  if (mode === 'always') return (match(false) ?? match(true))?.id ?? null;
  // auto: show subtitles when the audio isn't in a language you prefer; otherwise only forced (foreign-dialogue) ones.
  const audioIsPreferred = prefLangs.some((l) => langMatches(audioLang, l)) || !audioLang;
  if (audioIsPreferred) return match(true)?.id ?? pool.find((t) => t.isForced && langMatches(t.language, audioLang))?.id ?? null;
  return (match(false) ?? match(true))?.id ?? null;
}

class VideoTracker {
  private startedAt = Date.now();
  private wall = 0;
  private media = 0;
  private last = performance.now();
  private speedSum = 0;
  constructor(readonly item: MediaItem, private from: number) {}
  tick(rate: number): void {
    const now = performance.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    if (dt >= 1.5) return;
    this.wall += dt;
    this.media += dt * rate;
    this.speedSum += dt * rate;
  }
  finish(to: number) {
    if (this.wall < 5) return null;
    return { mediaId: this.item.id, startedAt: this.startedAt, watchedSec: this.wall, mediaSec: this.media, fromSec: this.from, toSec: to, speed: this.wall > 0 ? this.speedSum / this.wall : 1 };
  }
}

class VideoEngine {
  readonly video: HTMLVideoElement;
  private token = 0;
  private forced: PlaybackMode | undefined;
  private tracker: VideoTracker | null = null;
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private upNextTimer: ReturnType<typeof setInterval> | null = null;
  private osdId = 0;
  private frameCounter = 0;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private frameCb = 0;
  private completedMarked = false;
  private pinned = false;
  private attached = false;
  private pendingSeek: number | null = null;

  constructor() {
    const v = document.createElement('video');
    v.className = 'player__video';
    v.playsInline = true;
    v.preload = 'auto';
    v.disablePictureInPicture = false;
    v.setAttribute('crossorigin', 'anonymous');
    this.video = v;
    v.addEventListener('play', () => this.onPlayState(true));
    v.addEventListener('pause', () => this.onPlayState(false));
    v.addEventListener('waiting', () => useVideoPlayer.setState({ buffering: true }));
    v.addEventListener('playing', () => useVideoPlayer.setState({ buffering: false, playing: true }));
    v.addEventListener('canplay', () => useVideoPlayer.setState({ buffering: false }));
    v.addEventListener('timeupdate', () => this.sync());
    v.addEventListener('progress', () => this.syncBuffered());
    v.addEventListener('ended', () => this.onEnded());
    v.addEventListener('error', () => this.onError());
    v.addEventListener('enterpictureinpicture', () => useVideoPlayer.setState({ pip: true }));
    v.addEventListener('leavepictureinpicture', () => useVideoPlayer.setState({ pip: false }));
    v.addEventListener('ratechange', () => useVideoPlayer.setState({ speed: v.playbackRate }));
  }

  // ---- derived time ---------------------------------------------------------------

  private get offset(): number {
    return useVideoPlayer.getState().session?.mode === 'direct' ? 0 : useVideoPlayer.getState().session?.offsetSec ?? 0;
  }

  get currentTime(): number {
    return this.offset + this.video.currentTime;
  }

  private sync(): void {
    const st = useVideoPlayer.getState();
    const t = this.offset + this.video.currentTime;
    useVideoPlayer.setState({ time: t });
    const settings = useSettings.getState().settings.playback;
    if (!this.completedMarked && st.item && st.duration > 0 && t >= st.duration * settings.completeThreshold) {
      this.completedMarked = true;
      quiet(invoke('state:progress', { mediaId: st.item.id, completed: true, positionSec: 0, progress: 1 }));
    }
    // Up-next card appears in the last seconds of an episode/film.
    if (settings.autoplayNext && st.duration > 60 && !st.upNext && st.duration - t < 14 && st.playing) this.beginUpNext(false);
  }

  private syncBuffered(): void {
    const b = this.video.buffered;
    const off = this.offset;
    const out: [number, number][] = [];
    for (let i = 0; i < b.length; i++) out.push([off + b.start(i), off + b.end(i)]);
    useVideoPlayer.setState({ buffered: out });
  }

  // ---- loading ----------------------------------------------------------------------

  async open(items: MediaItem[], index: number, startSec?: number): Promise<void> {
    installMediaSession();
    if (!this.attached) { audioGraph.attach(this.video); this.attached = true; }
    audioGraph.resume();
    // Anything else that was playing steps aside.
    void import('./music-engine').then((m) => m.musicEngine.stop());
    useVideoPlayer.setState({ open: true, queue: items, index });
    await this.load(items[index]!, startSec);
  }

  private async load(item: MediaItem, startSec?: number): Promise<void> {
    const my = ++this.token;
    this.flushTracker();
    this.stopTimers();
    this.completedMarked = false;
    this.forced = undefined;
    const settings = useSettings.getState().settings;
    useVideoPlayer.setState({
      item, phase: 'loading', error: null, playing: false, buffering: true, time: 0, duration: item.durationSec, buffered: [], session: null, probe: null,
      cues: [], subtitleId: null, subtitleTracks: [], audioTracks: [], chapters: [], sprite: null, upNext: null, stats: null, controlsVisible: true
    });
    try {
      const [probe, prefs, subs] = await Promise.all([
        invoke('playback:probe', item.id),
        invoke('playback:prefs', item.id),
        invoke('playback:subtitles', item.id).catch(() => [] as SubtitleTrack[])
      ]);
      if (my !== this.token) return;
      const audios = probe.streams.filter((s) => s.type === 'audio');
      const audioIndex = chooseAudioIndex(audios, settings.playback.preferredAudioLangs, prefs.audioIndex);
      const speed = settings.playback.rememberSpeed && prefs.speed ? prefs.speed : settings.playback.defaultSpeed;
      const subId = pickSubtitle(subs, audios[audioIndex], settings.playback.preferredSubtitleLangs, settings.playback.subtitles, prefs.subtitleId);
      const resume = startSec ?? (settings.playback.resume === 'always' && item.positionSec > 10 && !item.completed && item.durationSec > 0 && item.positionSec < item.durationSec * settings.playback.completeThreshold ? item.positionSec : 0);
      useVideoPlayer.setState({
        probe, audioTracks: audios, audioIndex, subtitleTracks: subs, chapters: probe.chapters, speed: clampSpeed(speed), subtitleDelay: prefs.subtitleDelay ?? 0,
        duration: probe.durationSec || item.durationSec
      });
      await this.openSession(resume, audioIndex, -1, undefined, my);
      if (my !== this.token) return;
      if (subId) await this.applySubtitle(subId, false);
      quiet(invoke('playback:sprite', item.id).then((s) => { if (my === this.token) useVideoPlayer.setState({ sprite: s }); }));
      this.tracker = new VideoTracker(item, resume);
      this.updateMediaSession(item);
      setTransport(videoTransport);
      this.startTimers();
    } catch (err) {
      if (my !== this.token) return;
      const msg = (err as Error).message;
      useVideoPlayer.setState({ phase: 'error', error: msg, buffering: false });
    }
  }

  private async openSession(startSec: number, audioIndex: number, burn: number, force: PlaybackMode | undefined, my: number): Promise<void> {
    const st = useVideoPlayer.getState();
    const item = st.item!;
    const probe = st.probe!;
    const settings = useSettings.getState().settings.playback;
    const supported = await supportedMimes(probe, item.ext);
    const plan = planPlayback({ probe, ext: item.ext, supported, audioIndex, burnSubtitle: burn, maxHeight: settings.transcodeMaxHeight, force: force ?? this.forced });
    const session = await invoke('playback:open', { mediaId: item.id, mode: plan.mode, startSec, audioIndex: plan.audioIndex, maxHeight: plan.maxHeight, burnSubtitle: burn, reason: plan.reason });
    if (my !== this.token) { quiet(invoke('playback:close', session.sid)); return; }
    const old = st.session;
    useVideoPlayer.setState({ session, audioIndex: plan.audioIndex, buffering: true });
    if (old && old.mode !== 'direct') quiet(invoke('playback:close', old.sid));
    const v = this.video;
    v.defaultPlaybackRate = useVideoPlayer.getState().speed;
    v.src = session.url;
    v.load();
    v.playbackRate = useVideoPlayer.getState().speed;
    await new Promise<void>((resolve, reject) => {
      const done = () => { v.removeEventListener('loadedmetadata', ok); v.removeEventListener('error', fail); };
      const ok = () => { done(); resolve(); };
      const fail = () => { done(); reject(new Error(v.error?.message || 'The video could not be opened')); };
      v.addEventListener('loadedmetadata', ok);
      v.addEventListener('error', fail);
    });
    if (my !== this.token) return;
    if (session.mode === 'direct' && startSec > 0) v.currentTime = startSec;
    audioGraph.resume();
    useVideoPlayer.setState({ phase: 'ready', duration: session.durationSec || useVideoPlayer.getState().duration });
    try { await v.play(); } catch (e) { if ((e as Error).name !== 'AbortError') throw e; }
  }

  /** The stream failed: step down direct → remux → transcode before giving up. */
  private onError(): void {
    const st = useVideoPlayer.getState();
    if (!st.open || !st.item || !st.session || st.phase === 'loading') return;
    const at = this.currentTime;
    const next: PlaybackMode | null = st.session.mode === 'direct' ? 'remux' : st.session.mode === 'remux' ? 'transcode' : null;
    if (next) {
      this.forced = next;
      toast('info', next === 'remux' ? 'Repackaging the video for playback…' : 'Converting the video for playback…');
      const my = ++this.token;
      void this.openSession(at, st.audioIndex, -1, next, my).catch((e) => useVideoPlayer.setState({ phase: 'error', error: (e as Error).message }));
      return;
    }
    useVideoPlayer.setState({ phase: 'error', error: this.video.error?.message || 'This video could not be played.', buffering: false });
  }

  // ---- transport ----------------------------------------------------------------------

  private onPlayState(playing: boolean): void {
    useVideoPlayer.setState({ playing });
    quiet(invoke('playback:keepAwake', playing));
    if (!playing) this.saveProgress();
    if (playing) this.scheduleHide(); else this.showControls();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }

  toggle(): void {
    if (this.video.paused) { audioGraph.resume(); void this.video.play().catch(() => {}); } else this.video.pause();
  }

  seek(t: number): void {
    const st = useVideoPlayer.getState();
    const dur = st.duration || Infinity;
    const target = Math.max(0, Math.min(t, dur - 0.1));
    const s = st.session;
    useVideoPlayer.setState({ time: target });
    if (!s) return;
    if (s.mode === 'direct') { this.video.currentTime = target; return; }
    const rel = target - s.offsetSec;
    const b = this.video.buffered;
    for (let i = 0; i < b.length; i++) {
      if (rel >= b.start(i) - 0.01 && rel <= b.end(i) - 0.3) { this.video.currentTime = rel; return; }
    }
    // Outside what has been converted so far: restart the stream from the new position.
    this.pendingSeek = target;
    const my = ++this.token;
    useVideoPlayer.setState({ buffering: true });
    void this.openSession(target, st.audioIndex, this.burnIndex(), undefined, my).catch((e) => useVideoPlayer.setState({ phase: 'error', error: (e as Error).message }));
  }

  private burnIndex(): number {
    const st = useVideoPlayer.getState();
    const t = st.subtitleTracks.find((x) => x.id === st.subtitleId);
    return t?.format === 'bitmap' && typeof t.ref === 'number' ? t.ref : -1;
  }

  setAudio(i: number): void {
    const st = useVideoPlayer.getState();
    if (!st.item || i === st.audioIndex) return;
    quiet(invoke('playback:prefs', st.item.id, { audioIndex: i }));
    const my = ++this.token;
    useVideoPlayer.setState({ audioIndex: i, buffering: true });
    this.osd(`Audio: ${st.audioTracks[i]?.language || `Track ${i + 1}`}`);
    void this.openSession(this.currentTime, i, this.burnIndex(), undefined, my).catch((e) => useVideoPlayer.setState({ phase: 'error', error: (e as Error).message }));
  }

  // ---- subtitles ----------------------------------------------------------------------

  async applySubtitle(id: string | null, remember = true): Promise<void> {
    const st = useVideoPlayer.getState();
    if (!st.item) return;
    const wasBurned = this.burnIndex() >= 0;
    if (id == null) {
      useVideoPlayer.setState({ subtitleId: null, cues: [] });
      if (remember) quiet(invoke('playback:prefs', st.item.id, { subtitleId: 'none' }));
      if (wasBurned) this.reopenForBurn(-1);
      return;
    }
    const track = st.subtitleTracks.find((t) => t.id === id);
    if (!track) return;
    if (remember) quiet(invoke('playback:prefs', st.item.id, { subtitleId: id }));
    if (track.format === 'bitmap') {
      useVideoPlayer.setState({ subtitleId: id, cues: [] });
      if (typeof track.ref === 'number') this.reopenForBurn(track.ref);
      return;
    }
    try {
      const { text, format } = await invoke('playback:subtitleText', st.item.id, id);
      useVideoPlayer.setState({ subtitleId: id, cues: parseSubtitles(text, format) });
      if (wasBurned) this.reopenForBurn(-1);
    } catch (err) {
      toast('error', (err as Error).message);
    }
  }

  /** Re-scan for subtitle tracks (after a download) and optionally switch to one. */
  async reloadSubtitles(select?: string): Promise<void> {
    const st = useVideoPlayer.getState();
    if (!st.item) return;
    const subs = await invoke('playback:subtitles', st.item.id).catch(() => st.subtitleTracks);
    useVideoPlayer.setState({ subtitleTracks: subs });
    if (select && subs.some((t) => t.id === select)) await this.applySubtitle(select);
  }

  private reopenForBurn(streamIndex: number): void {
    const st = useVideoPlayer.getState();
    const my = ++this.token;
    useVideoPlayer.setState({ buffering: true });
    toast('info', streamIndex >= 0 ? 'Image-based subtitles are burned into the picture, so the video is being converted.' : 'Restoring original video…');
    void this.openSession(this.currentTime, st.audioIndex, streamIndex, undefined, my).catch((e) => useVideoPlayer.setState({ phase: 'error', error: (e as Error).message }));
  }

  // ---- end of media / queue ------------------------------------------------------------------

  private async nextItem(): Promise<MediaItem | null> {
    const st = useVideoPlayer.getState();
    if (st.queue[st.index + 1]) return st.queue[st.index + 1]!;
    if (!st.item) return null;
    const sib = await invoke('library:siblings', st.item.id).catch(() => null);
    return sib?.next && sib.next.kind === 'video' ? sib.next : null;
  }

  private beginUpNext(atEnd: boolean): void {
    if (this.upNextTimer || useVideoPlayer.getState().upNext) return;
    void this.nextItem().then((next) => {
      if (!next) { if (atEnd) this.finishPlayback(); return; }
      let left = 8;
      useVideoPlayer.setState({ upNext: { item: next, secondsLeft: left }, controlsVisible: true });
      this.upNextTimer = setInterval(() => {
        left -= 1;
        if (left <= 0) { this.clearUpNext(); this.advance(next); }
        else useVideoPlayer.setState({ upNext: { item: next, secondsLeft: left } });
      }, 1000);
    });
  }

  private clearUpNext(): void {
    if (this.upNextTimer) clearInterval(this.upNextTimer);
    this.upNextTimer = null;
  }

  private advance(next: MediaItem): void {
    const st = useVideoPlayer.getState();
    const idx = st.queue.findIndex((m) => m.id === next.id);
    useVideoPlayer.setState({ upNext: null, index: idx >= 0 ? idx : st.index + 1, queue: idx >= 0 ? st.queue : [...st.queue, next] });
    this.flushTracker();
    void this.load(next, 0);
  }

  private onEnded(): void {
    const st = useVideoPlayer.getState();
    if (st.item && !this.completedMarked) {
      this.completedMarked = true;
      quiet(invoke('state:progress', { mediaId: st.item.id, completed: true, positionSec: 0, progress: 1 }));
    }
    // For converted streams `ended` also fires if the stream was cut short; only trust it near the real end.
    if (st.duration > 0 && this.currentTime < st.duration - 3 && st.session?.mode !== 'direct') {
      this.onError();
      return;
    }
    if (useSettings.getState().settings.playback.autoplayNext) this.beginUpNext(true);
    else this.finishPlayback();
  }

  private finishPlayback(): void {
    useVideoPlayer.setState({ playing: false, controlsVisible: true });
  }

  // ---- progress & history ------------------------------------------------------------------------

  private saveProgress(): void {
    const st = useVideoPlayer.getState();
    if (!st.item || st.phase !== 'ready' || st.duration <= 0) return;
    const t = this.currentTime;
    if (this.completedMarked) return;
    quiet(invoke('state:progress', { mediaId: st.item.id, positionSec: t, progress: Math.min(1, t / st.duration) }));
  }

  private flushTracker(): void {
    const t = this.tracker;
    this.tracker = null;
    if (!t) return;
    const rec = t.finish(this.currentTime);
    if (rec) quiet(invoke('history:record', rec));
  }

  private startTimers(): void {
    this.stopTimers();
    this.saveTimer = setInterval(() => { if (!this.video.paused) this.saveProgress(); }, 10_000);
    this.tickTimer = setInterval(() => { if (!this.video.paused) this.tracker?.tick(this.video.playbackRate); }, 250);
  }

  private stopTimers(): void {
    for (const t of [this.saveTimer, this.tickTimer]) if (t) clearInterval(t);
    this.saveTimer = this.tickTimer = null;
    this.clearUpNext();
  }

  // ---- UI helpers --------------------------------------------------------------------------------------

  osd(text: string): void {
    useVideoPlayer.setState({ osd: { text, id: ++this.osdId } });
  }

  pinControls(on: boolean): void {
    this.pinned = on;
    if (on) this.showControls(); else this.scheduleHide();
  }

  showControls(): void {
    if (!useVideoPlayer.getState().controlsVisible) useVideoPlayer.setState({ controlsVisible: true });
    this.scheduleHide();
  }

  private scheduleHide(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    const secs = useSettings.getState().settings.playback.autoHideControlsSec;
    this.hideTimer = setTimeout(() => {
      const st = useVideoPlayer.getState();
      if (st.playing && !this.pinned && !st.upNext) useVideoPlayer.setState({ controlsVisible: false });
    }, secs * 1000);
  }

  startStats(): void {
    this.stopStats();
    const v = this.video;
    const loop = () => { this.frameCounter++; this.frameCb = (v as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => number }).requestVideoFrameCallback(loop); };
    this.frameCb = (v as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => number }).requestVideoFrameCallback(loop);
    this.frameCounter = 0;
    let last = performance.now();
    this.statsTimer = setInterval(() => {
      const now = performance.now();
      const fps = this.frameCounter / ((now - last) / 1000);
      this.frameCounter = 0;
      last = now;
      const q = v.getVideoPlaybackQuality();
      const b = v.buffered;
      let ahead = 0;
      for (let i = 0; i < b.length; i++) if (v.currentTime >= b.start(i) && v.currentTime <= b.end(i)) ahead = b.end(i) - v.currentTime;
      useVideoPlayer.setState({ stats: { presentedFps: v.paused ? 0 : fps, droppedFrames: q.droppedVideoFrames, totalFrames: q.totalVideoFrames, width: v.videoWidth, height: v.videoHeight, bufferAhead: ahead } });
    }, 1000);
  }

  stopStats(): void {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    const v = this.video as HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void };
    if (this.frameCb && v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(this.frameCb);
    this.frameCb = 0;
  }

  private updateMediaSession(item: MediaItem): void {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.title, artist: item.series ?? '', album: item.year ? String(item.year) : '',
      artwork: item.hasArt ? [{ src: artUrl(item.id, 'large', item.mtimeMs), sizes: '1024x1024', type: 'image/jpeg' }] : []
    });
  }

  /** Called when music or another player takes over. */
  pauseForOtherMedia(): void {
    if (useVideoPlayer.getState().open) this.video.pause();
  }

  close(): void {
    const st = useVideoPlayer.getState();
    this.token++;
    this.saveProgress();
    this.flushTracker();
    this.stopTimers();
    this.stopStats();
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    if (st.session && st.session.mode !== 'direct') quiet(invoke('playback:close', st.session.sid));
    quiet(invoke('playback:keepAwake', false));
    quiet(invoke('window:fullscreen', false));
    useVideoPlayer.setState({ open: false, item: null, session: null, playing: false, phase: 'idle', upNext: null, cues: [], stats: null, statsOpen: false });
    setTransport(null);
  }

  jumpToStart(item: MediaItem): void { void this.load(item, 0); }

  playUpNext(): void {
    const un = useVideoPlayer.getState().upNext;
    if (!un) return;
    this.clearUpNext();
    this.advance(un.item);
  }

  cancelUpNext(): void {
    this.clearUpNext();
    useVideoPlayer.setState({ upNext: null });
  }

  goTo(delta: 1 | -1): void {
    const st = useVideoPlayer.getState();
    const target = st.queue[st.index + delta];
    if (target) {
      useVideoPlayer.setState({ index: st.index + delta });
      this.flushTracker();
      void this.load(target, 0);
    } else if (delta === 1) {
      void this.nextItem().then((n) => { if (n) this.advance(n); else this.osd('End of queue'); });
    } else {
      this.seek(0);
    }
  }
}

export const videoEngine = new VideoEngine();

export const videoTransport = {
  toggle: () => videoEngine.toggle(),
  play: () => { void videoEngine.video.play().catch(() => {}); },
  pause: () => videoEngine.video.pause(),
  next: () => videoEngine.goTo(1),
  previous: () => videoEngine.goTo(-1),
  seekTo: (t: number) => videoEngine.seek(t),
  seekBy: (d: number) => videoEngine.seek(videoEngine.currentTime + d),
  stop: () => videoEngine.close()
};

const fmtSpeed = (r: number) => `${Number.isInteger(r) ? r : r.toFixed(2).replace(/0$/, '')}×`;
const SPEED_STOPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

export const useVideoPlayer = create<VideoState>((set, get) => ({
  open: false, queue: [], index: 0, item: null, phase: 'idle', error: null, playing: false, buffering: false, time: 0, duration: 0, buffered: [],
  speed: 1, session: null, probe: null, audioIndex: 0, audioTracks: [], subtitleTracks: [], subtitleId: null, cues: [], subtitleDelay: 0, chapters: [],
  sprite: null, aspect: 'fit', controlsVisible: true, statsOpen: false, stats: null, pip: false, upNext: null, osd: null,

  play: (items, index = 0, opts) => {
    if (items.length === 0) return;
    if (useSettings.getState().settings.playback.fullscreenOnPlay) quiet(invoke('window:fullscreen', true));
    void videoEngine.open(items, Math.max(0, index), opts?.startSec);
  },
  close: () => videoEngine.close(),
  toggle: () => videoEngine.toggle(),
  seek: (t) => videoEngine.seek(t),
  seekBy: (d) => {
    videoEngine.seek(videoEngine.currentTime + d);
    videoEngine.osd(`${d > 0 ? '+' : '−'}${Math.abs(d)} s`);
  },
  setSpeed: (r) => {
    const v = clampSpeed(r);
    videoEngine.video.defaultPlaybackRate = v;
    videoEngine.video.playbackRate = v;
    set({ speed: v });
    videoEngine.osd(fmtSpeed(v));
    const it = get().item;
    if (it && useSettings.getState().settings.playback.rememberSpeed) quiet(invoke('playback:prefs', it.id, { speed: v }));
  },
  stepSpeed: (dir) => {
    const cur = get().speed;
    const next = dir > 0 ? SPEED_STOPS.find((s) => s > cur + 0.001) : [...SPEED_STOPS].reverse().find((s) => s < cur - 0.001);
    get().setSpeed(next ?? cur);
  },
  next: () => videoEngine.goTo(1),
  previous: () => videoEngine.goTo(-1),
  setAudio: (i) => videoEngine.setAudio(i),
  setSubtitle: (id) => { void videoEngine.applySubtitle(id); videoEngine.osd(id ? `Subtitles: ${get().subtitleTracks.find((t) => t.id === id)?.label ?? 'On'}` : 'Subtitles off'); },
  setSubtitleDelay: (d) => {
    const v = Math.round(d * 10) / 10;
    set({ subtitleDelay: v });
    videoEngine.osd(`Subtitle delay ${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} s`);
    const it = get().item;
    if (it) quiet(invoke('playback:prefs', it.id, { subtitleDelay: v }));
  },
  toggleSubtitles: () => {
    const st = get();
    if (st.subtitleId) get().setSubtitle(null);
    else {
      const first = st.subtitleTracks.find((t) => t.format !== 'bitmap') ?? st.subtitleTracks[0];
      if (first) get().setSubtitle(first.id); else videoEngine.osd('No subtitles available');
    }
  },
  cycleSubtitle: () => {
    const { subtitleTracks, subtitleId } = get();
    if (subtitleTracks.length === 0) return videoEngine.osd('No subtitles available');
    const i = subtitleTracks.findIndex((t) => t.id === subtitleId);
    const next = i + 1 < subtitleTracks.length ? subtitleTracks[i + 1]!.id : null;
    get().setSubtitle(next);
  },
  cycleAudio: () => {
    const { audioTracks, audioIndex } = get();
    if (audioTracks.length < 2) return videoEngine.osd('Only one audio track');
    get().setAudio((audioIndex + 1) % audioTracks.length);
  },
  cycleAspect: () => {
    const next = ({ fit: 'fill', fill: 'stretch', stretch: 'fit' } as const)[get().aspect];
    set({ aspect: next });
    videoEngine.osd(next === 'fit' ? 'Fit' : next === 'fill' ? 'Fill' : 'Stretch');
  },
  toggleStats: () => {
    const on = !get().statsOpen;
    set({ statsOpen: on });
    if (on) videoEngine.startStats(); else videoEngine.stopStats();
  },
  showControls: () => videoEngine.showControls(),
  togglePip: async () => {
    const v = videoEngine.video;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch (err) {
      toast('error', `Picture in Picture isn’t available here: ${(err as Error).message}`);
    }
  },
  screenshot: async () => {
    const v = videoEngine.video;
    const it = get().item;
    if (!it || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    try {
      const path = await invoke('playback:screenshot', c.toDataURL('image/png'), it.title);
      videoEngine.osd('Screenshot saved');
      if (path) toast('success', `Saved screenshot to ${path}`);
    } catch (err) {
      toast('error', `Couldn’t save screenshot: ${(err as Error).message}`);
    }
  },
  jumpChapter: (dir) => {
    const { chapters } = get();
    if (chapters.length === 0) return videoEngine.osd('No chapters');
    const t = videoEngine.currentTime;
    const target = dir > 0 ? chapters.find((c) => c.startSec > t + 0.5) : [...chapters].reverse().find((c) => c.startSec < t - 2);
    if (target) { videoEngine.seek(target.startSec); videoEngine.osd(target.title || 'Next chapter'); } else if (dir < 0) videoEngine.seek(0);
  },
  frameStep: (dir) => {
    const v = videoEngine.video;
    const fps = get().item?.fps || 24;
    v.pause();
    const st = get();
    if (st.session && st.session.mode !== 'direct') {
      const rel = v.currentTime + dir / fps;
      if (rel >= 0) v.currentTime = rel;
    } else v.currentTime = Math.max(0, v.currentTime + dir / fps);
  },
  cancelUpNext: () => videoEngine.cancelUpNext(),
  playUpNext: () => videoEngine.playUpNext(),
  setVolume: (v) => { useSettings.getState().update({ audio: { volume: Math.max(0, Math.min(1, v)), muted: false } }); videoEngine.osd(`Volume ${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`); },
  toggleMute: () => { const m = !useSettings.getState().settings.audio.muted; useSettings.getState().update({ audio: { muted: m } }); videoEngine.osd(m ? 'Muted' : 'Sound on'); }
}));
