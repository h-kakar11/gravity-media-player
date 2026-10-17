import { create } from 'zustand';
import type { MediaItem } from '@shared/types';
import { invoke, quiet } from '../api';
import { artUrl, mediaUrl } from './art';
import { audioGraph, replayGainToLinear } from './audio-graph';
import { useSettings } from '../state/settings';
import { toast } from '../state/ui';
import { installMediaSession, setTransport } from './transport';

export type Repeat = 'off' | 'all' | 'one';
export type NowPlayingTab = 'art' | 'lyrics' | 'queue' | 'eq';

export interface MusicState {
  queue: MediaItem[];
  /** Queue in its original order, restored when shuffle is switched off. */
  original: MediaItem[];
  index: number;
  playing: boolean;
  loading: boolean;
  time: number;
  duration: number;
  shuffle: boolean;
  repeat: Repeat;
  history: MediaItem[];
  nowPlayingOpen: boolean;
  tab: NowPlayingTab;
  error: string | null;
  // actions
  playItems: (items: MediaItem[], index?: number, opts?: { shuffle?: boolean }) => void;
  playIndex: (i: number) => void;
  toggle: () => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  previous: () => void;
  seek: (t: number) => void;
  seekBy: (d: number) => void;
  stop: () => void;
  setShuffle: (on: boolean) => void;
  setRepeat: (r: Repeat) => void;
  cycleRepeat: () => void;
  playNext: (items: MediaItem[]) => void;
  addToQueue: (items: MediaItem[]) => void;
  removeAt: (i: number) => void;
  move: (from: number, to: number) => void;
  clearUpcoming: () => void;
  openNowPlaying: (tab?: NowPlayingTab) => void;
  closeNowPlaying: () => void;
  setTab: (t: NowPlayingTab) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
}

const NATIVE_CODECS = new Set(['mp3', 'aac', 'flac', 'vorbis', 'opus', 'pcm', 'mp2', 'wav']);
const NATIVE_EXT = new Set(['mp3', 'flac', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'm4b', 'aac', 'mka']);

/** Chromium decodes these directly; everything else (ALAC, APE, WavPack, DSD, WMA…) is converted by ffmpeg. */
export function canPlayAudioDirect(m: MediaItem): boolean {
  if (!NATIVE_EXT.has(m.ext)) return false;
  if (m.acodec && !NATIVE_CODECS.has(m.acodec)) return false;
  return true;
}

const shuffled = <T,>(list: T[], keepFirst?: T): T[] => {
  const arr = list.filter((x) => x !== keepFirst);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return keepFirst !== undefined ? [keepFirst, ...arr] : arr;
};

interface Slot {
  el: HTMLAudioElement;
  item: MediaItem | null;
  sid: string | null;
  offset: number;
  gain: GainNode | null;
  rg: number;
  ready: boolean;
}

const LONG_FORM_SEC = 20 * 60;

class MusicEngine {
  private slots: [Slot, Slot] | null = null;
  private cur = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private crossfading = false;
  private tracker: ListenTracker | null = null;
  private lastSave = 0;
  private pausedFlush: ReturnType<typeof setTimeout> | null = null;
  private token = 0;
  private fallbackTried = new Set<number>();

  private init(): [Slot, Slot] {
    if (this.slots) return this.slots;
    const mk = (): Slot => {
      const el = new Audio();
      el.preload = 'auto';
      el.setAttribute('playsinline', '');
      return { el, item: null, sid: null, offset: 0, gain: null, rg: 1, ready: false };
    };
    const slots: [Slot, Slot] = [mk(), mk()];
    for (const [i, s] of slots.entries()) {
      s.gain = audioGraph.attach(s.el);
      s.el.addEventListener('ended', () => this.onEnded(i));
      s.el.addEventListener('error', () => this.onError(i));
      s.el.addEventListener('playing', () => { if (i === this.cur) useMusic.setState({ playing: true, loading: false }); });
      s.el.addEventListener('pause', () => { if (i === this.cur && !s.el.ended && !this.crossfading) { useMusic.setState({ playing: false }); this.onPaused(); } });
      s.el.addEventListener('waiting', () => { if (i === this.cur) useMusic.setState({ loading: true }); });
      s.el.addEventListener('canplay', () => { if (i === this.cur) useMusic.setState({ loading: false }); });
      s.el.addEventListener('loadedmetadata', () => { s.ready = true; if (i === this.cur) this.syncDuration(); });
      s.el.addEventListener('timeupdate', () => { if (i === this.cur) this.syncTime(); });
    }
    this.slots = slots;
    installMediaSession();
    return slots;
  }

  private get slot(): Slot { return this.init()[this.cur]!; }
  private get other(): Slot { return this.init()[1 - this.cur]!; }

  get currentTime(): number {
    if (!this.slots) return 0;
    const s = this.slot;
    return s.offset + s.el.currentTime;
  }

  private syncTime(): void {
    const s = this.slot;
    useMusic.setState({ time: s.offset + s.el.currentTime });
  }

  private syncDuration(): void {
    const s = this.slot;
    const d = s.item?.durationSec || (Number.isFinite(s.el.duration) ? s.offset + s.el.duration : 0);
    useMusic.setState({ duration: d });
  }

  // ---- loading -------------------------------------------------------------

  private async load(slot: Slot, item: MediaItem, startAt: number): Promise<void> {
    this.release(slot);
    slot.item = item;
    slot.ready = false;
    slot.rg = replayGainToLinear(item.replayGain, useSettings.getState().settings.audio.replayGain);
    slot.gain?.gain.setValueAtTime(slot.rg, audioGraph.time);
    const forceConvert = this.fallbackTried.has(item.id);
    if (canPlayAudioDirect(item) && !forceConvert) {
      slot.offset = 0;
      slot.el.src = mediaUrl(item.id);
      if (startAt > 0) {
        const seek = () => { slot.el.currentTime = startAt; slot.el.removeEventListener('loadedmetadata', seek); };
        slot.el.addEventListener('loadedmetadata', seek);
      }
    } else {
      const s = await invoke('playback:open', { mediaId: item.id, mode: 'transcode', startSec: startAt, audioIndex: 0, maxHeight: 0, burnSubtitle: -1, reason: 'Format needs conversion' });
      slot.sid = s.sid;
      slot.offset = s.offsetSec;
      slot.el.src = s.url;
    }
    slot.el.load();
  }

  private release(slot: Slot): void {
    if (slot.sid) quiet(invoke('playback:close', slot.sid));
    slot.sid = null;
    slot.offset = 0;
  }

  private preloadNext(): void {
    const st = useMusic.getState();
    const nextIdx = this.nextIndex(st);
    const o = this.other;
    if (nextIdx == null) { o.item = null; return; }
    const item = st.queue[nextIdx]!;
    if (o.item?.id === item.id && o.el.src) return;
    o.el.pause();
    void this.load(o, item, 0).catch((e) => console.warn('Preload failed', e));
  }

  private nextIndex(st: MusicState): number | null {
    if (st.queue.length === 0) return null;
    if (st.repeat === 'one') return st.index;
    if (st.index + 1 < st.queue.length) return st.index + 1;
    return st.repeat === 'all' ? 0 : null;
  }

  // ---- public ---------------------------------------------------------------

  async startAt(index: number, startAt = 0): Promise<void> {
    const st = useMusic.getState();
    const item = st.queue[index];
    if (!item) return;
    this.init();
    audioGraph.resume();
    const my = ++this.token;
    this.flushTracker();
    this.crossfading = false;
    this.other.el.pause();
    const s = this.slot;
    s.el.pause();
    this.fallbackTried.delete(item.id);
    useMusic.setState({ index, loading: true, error: null, time: startAt, duration: item.durationSec });
    try {
      // Long recordings (audiobooks, podcasts, DJ sets) resume where you left off.
      const resumeAt = startAt === 0 && item.durationSec > LONG_FORM_SEC && item.positionSec > 10 && !item.completed ? item.positionSec : startAt;
      await this.load(s, item, resumeAt);
      if (my !== this.token) return;
      await s.el.play();
      setTransport(musicTransport);
      this.startTimer();
      this.tracker = new ListenTracker(item, resumeAt);
      this.updateMediaSession(item);
      this.preloadNext();
      useMusic.setState((cur) => ({ history: [item, ...cur.history.filter((h) => h.id !== item.id)].slice(0, 100) }));
    } catch (err) {
      if (my !== this.token) return;
      this.handleFailure(item, err as Error);
    }
  }

  private handleFailure(item: MediaItem, err: Error): void {
    if (!this.fallbackTried.has(item.id) && canPlayAudioDirect(item)) {
      // Direct playback failed (unusual codec inside a normal container): retry through ffmpeg.
      this.fallbackTried.add(item.id);
      void this.startAt(useMusic.getState().index, this.currentTime);
      return;
    }
    const message = err.name === 'NotSupportedError' || /supported/i.test(err.message) ? `“${item.title}” can’t be played on this system.` : `Couldn’t play “${item.title}”: ${err.message}`;
    useMusic.setState({ playing: false, loading: false, error: message });
    toast('error', message);
    // Keep the queue moving past an unplayable file.
    const nxt = this.nextIndex(useMusic.getState());
    if (nxt != null && nxt !== useMusic.getState().index) setTimeout(() => void this.startAt(nxt), 600);
  }

  private onError(i: number): void {
    if (i !== this.cur) return;
    const s = this.slot;
    if (!s.item || !s.el.src) return;
    this.handleFailure(s.item, new Error(s.el.error?.message || 'Playback error'));
  }

  private onEnded(i: number): void {
    if (i !== this.cur || this.crossfading) return;
    const st = useMusic.getState();
    if (st.repeat === 'one') { this.slot.el.currentTime = 0; void this.slot.el.play(); this.tracker?.restart(); return; }
    this.flushTracker(true);
    const nxt = this.nextIndex(st);
    if (nxt == null) { useMusic.setState({ playing: false, time: 0 }); this.stopTimer(); return; }
    void this.startAt(nxt);
  }

  toggle(): void {
    const st = useMusic.getState();
    if (st.queue.length === 0) return;
    if (!this.slots || !this.slot.el.src) { void this.startAt(Math.max(0, st.index)); return; }
    if (this.slot.el.paused) this.resume(); else this.pause();
  }

  pause(): void {
    if (!this.slots) return;
    this.slot.el.pause();
  }

  resume(): void {
    if (!this.slots) return;
    audioGraph.resume();
    void this.slot.el.play().then(() => { this.startTimer(); if (this.pausedFlush) { clearTimeout(this.pausedFlush); this.pausedFlush = null; } }).catch(() => {});
  }

  /** Stop the music entirely (e.g. when a video starts). */
  stop(): void {
    if (!this.slots) return;
    this.token++;
    this.flushTracker();
    this.stopTimer();
    for (const s of this.slots) { s.el.pause(); this.release(s); }
    useMusic.setState({ playing: false, loading: false });
  }

  next(): void {
    const st = useMusic.getState();
    if (st.queue.length === 0) return;
    const nxt = st.index + 1 < st.queue.length ? st.index + 1 : st.repeat === 'all' ? 0 : null;
    if (nxt == null) { this.seek(0); this.pause(); return; }
    void this.startAt(nxt);
  }

  previous(): void {
    const st = useMusic.getState();
    // Like every player: restart the track if it has been playing a few seconds.
    if (this.currentTime > 3 || st.index === 0) { this.seek(0); return; }
    void this.startAt(st.index - 1);
  }

  seek(t: number): void {
    if (!this.slots) return;
    const s = this.slot;
    const dur = useMusic.getState().duration || Infinity;
    const target = Math.max(0, Math.min(t, dur - 0.05));
    const rel = target - s.offset;
    const buffered = s.el.buffered;
    let inBuffer = false;
    for (let i = 0; i < buffered.length; i++) if (rel >= buffered.start(i) - 0.01 && rel <= buffered.end(i) - 0.1) inBuffer = true;
    if (s.sid && !inBuffer) {
      // Converted streams can't seek arbitrarily: restart the conversion at the new position.
      const item = s.item!;
      void this.load(s, item, target).then(() => { void s.el.play(); this.preloadNext(); });
      useMusic.setState({ time: target, loading: true });
      return;
    }
    s.el.currentTime = rel;
    useMusic.setState({ time: target });
    this.updatePositionState();
  }

  // ---- timer: crossfade / gapless / progress saving -----------------------------

  private startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 40);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    if (!this.slots) return;
    const s = this.slot;
    const st = useMusic.getState();
    if (s.el.paused) return;
    this.tracker?.tick(s.el.playbackRate);
    const audio = useSettings.getState().settings.audio;
    const dur = st.duration;
    if (dur > 0 && !this.crossfading) {
      const remaining = dur - (s.offset + s.el.currentTime);
      const xf = Math.max(0, Math.min(audio.crossfadeSec, dur / 2));
      const trigger = xf > 0 ? xf : audio.gapless ? 0.05 : -1;
      if (trigger >= 0 && remaining <= trigger + 0.04 && st.repeat !== 'one') this.beginTransition(xf);
    }
    // Long recordings remember their place.
    if (s.item && s.item.durationSec > LONG_FORM_SEC && Date.now() - this.lastSave > 10_000) {
      this.lastSave = Date.now();
      const pos = s.offset + s.el.currentTime;
      quiet(invoke('state:progress', { mediaId: s.item.id, positionSec: pos, progress: pos / s.item.durationSec }));
    }
  }

  private beginTransition(crossfadeSec: number): void {
    const st = useMusic.getState();
    const nxt = this.nextIndex(st);
    const incoming = this.other;
    if (nxt == null || !incoming.item || !incoming.ready || incoming.item.id !== st.queue[nxt]?.id) return;
    const outgoing = this.slot;
    this.crossfading = true;
    const t = audioGraph.time;
    if (crossfadeSec > 0) {
      incoming.gain?.gain.cancelScheduledValues(t);
      incoming.gain?.gain.setValueAtTime(0.0001, t);
      incoming.gain?.gain.linearRampToValueAtTime(incoming.rg, t + crossfadeSec);
      outgoing.gain?.gain.cancelScheduledValues(t);
      outgoing.gain?.gain.setValueAtTime(outgoing.rg, t);
      outgoing.gain?.gain.linearRampToValueAtTime(0.0001, t + crossfadeSec);
    }
    void incoming.el.play().catch(() => {});
    this.flushTracker(true);
    this.cur = 1 - this.cur;
    useMusic.setState((cur) => ({ index: nxt, time: 0, duration: incoming.item!.durationSec, history: [incoming.item!, ...cur.history.filter((h) => h.id !== incoming.item!.id)].slice(0, 100) }));
    this.tracker = new ListenTracker(incoming.item, 0);
    this.updateMediaSession(incoming.item);
    setTimeout(() => {
      outgoing.el.pause();
      this.release(outgoing);
      outgoing.item = null;
      outgoing.gain?.gain.setValueAtTime(outgoing.rg, audioGraph.time);
      this.crossfading = false;
      this.preloadNext();
    }, Math.max(80, crossfadeSec * 1000 + 60));
  }

  // ---- listening history -------------------------------------------------------------

  private flushTracker(finished = false): void {
    const t = this.tracker;
    this.tracker = null;
    if (!t) return;
    const rec = t.finish(this.currentTime);
    if (rec) quiet(invoke('history:record', rec));
    if (finished && t.item.durationSec > LONG_FORM_SEC) quiet(invoke('state:progress', { mediaId: t.item.id, positionSec: 0, progress: 1, completed: true }));
  }

  private onPaused(): void {
    // Keep a pause-resume within a minute as one listening session.
    if (this.pausedFlush) clearTimeout(this.pausedFlush);
    this.pausedFlush = setTimeout(() => this.flushTracker(), 60_000);
  }

  flushOnExit(): void { this.flushTracker(); }

  // ---- OS integration -------------------------------------------------------------------

  private updateMediaSession(item: MediaItem): void {
    if (!('mediaSession' in navigator)) return;
    const art = item.hasArt ? [{ src: artUrl(item.id, 'large', item.mtimeMs), sizes: '1024x1024', type: 'image/jpeg' }] : [];
    navigator.mediaSession.metadata = new MediaMetadata({ title: item.title, artist: item.artist ?? item.albumArtist ?? '', album: item.album ?? '', artwork: art });
    this.updatePositionState();
  }

  private updatePositionState(): void {
    if (!('mediaSession' in navigator) || !this.slots) return;
    const d = useMusic.getState().duration;
    if (!d) return;
    try { navigator.mediaSession.setPositionState({ duration: d, playbackRate: this.slot.el.playbackRate, position: Math.min(d, this.currentTime) }); } catch { /* ignore */ }
  }
}

/** Measures how long a track was actually listened to (wall clock) and how much of it was covered. */
class ListenTracker {
  private startedAt = Date.now();
  private watched = 0;
  private last = performance.now();
  private from: number;
  constructor(readonly item: MediaItem, from: number) { this.from = from; }
  tick(rate: number): void {
    const now = performance.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    if (dt < 1) this.watched += dt; // ignore long gaps (background throttling, suspend)
    void rate;
  }
  restart(): void { this.startedAt = Date.now(); this.watched = 0; this.from = 0; this.last = performance.now(); }
  finish(at: number) {
    if (this.watched < 5) return null;
    return { mediaId: this.item.id, startedAt: this.startedAt, watchedSec: this.watched, mediaSec: this.watched, fromSec: this.from, toSec: at, speed: 1 };
  }
}

export const musicEngine = new MusicEngine();

const musicTransport = {
  toggle: () => musicEngine.toggle(),
  play: () => musicEngine.resume(),
  pause: () => musicEngine.pause(),
  next: () => musicEngine.next(),
  previous: () => musicEngine.previous(),
  seekTo: (t: number) => musicEngine.seek(t),
  seekBy: (d: number) => musicEngine.seek(musicEngine.currentTime + d),
  stop: () => musicEngine.stop()
};

export { musicTransport };

export const useMusic = create<MusicState>((set, get) => ({
  queue: [], original: [], index: -1, playing: false, loading: false, time: 0, duration: 0,
  shuffle: false, repeat: 'off', history: [], nowPlayingOpen: false, tab: 'art', error: null,

  playItems: (items, index = 0, opts) => {
    if (items.length === 0) return;
    const wantShuffle = opts?.shuffle ?? get().shuffle;
    const start = Math.max(0, Math.min(index, items.length - 1));
    const first = items[start]!;
    // Starting music always takes over from a playing video.
    void import('./video-engine').then((m) => m.videoEngine.pauseForOtherMedia());
    set({ original: items, queue: wantShuffle ? shuffled(items, first) : items, index: wantShuffle ? 0 : start, shuffle: wantShuffle });
    void musicEngine.startAt(get().index);
  },
  playIndex: (i) => void musicEngine.startAt(i),
  toggle: () => musicEngine.toggle(),
  pause: () => musicEngine.pause(),
  resume: () => musicEngine.resume(),
  next: () => musicEngine.next(),
  previous: () => musicEngine.previous(),
  seek: (t) => musicEngine.seek(t),
  seekBy: (d) => musicEngine.seek(musicEngine.currentTime + d),
  stop: () => musicEngine.stop(),

  setShuffle: (on) => {
    const { queue, original, index } = get();
    const current = queue[index];
    if (on) set({ shuffle: true, original: queue, queue: current ? shuffled(queue, current) : shuffled(queue), index: current ? 0 : index });
    else set({ shuffle: false, queue: original.length ? original : queue, index: Math.max(0, (original.length ? original : queue).findIndex((m) => m.id === current?.id)) });
  },
  setRepeat: (r) => set({ repeat: r }),
  cycleRepeat: () => set({ repeat: ({ off: 'all', all: 'one', one: 'off' } as const)[get().repeat] }),

  playNext: (items) => {
    const { queue, original, index } = get();
    if (queue.length === 0) { get().playItems(items, 0); return; }
    const q = [...queue];
    q.splice(index + 1, 0, ...items);
    const cur = queue[index];
    const o = [...original];
    const oi = o.findIndex((m) => m.id === cur?.id);
    o.splice(oi + 1, 0, ...items);
    set({ queue: q, original: o });
  },
  addToQueue: (items) => {
    if (get().queue.length === 0) { get().playItems(items, 0); return; }
    set({ queue: [...get().queue, ...items], original: [...get().original, ...items] });
  },
  removeAt: (i) => {
    const { queue, index } = get();
    if (i === index) return;
    const q = queue.filter((_, k) => k !== i);
    set({ queue: q, index: i < index ? index - 1 : index });
  },
  move: (from, to) => {
    const { queue, index } = get();
    if (from === to || from === index) return;
    const q = [...queue];
    const [m] = q.splice(from, 1);
    q.splice(to, 0, m!);
    const cur = queue[index]!;
    set({ queue: q, index: q.findIndex((x) => x === cur) });
  },
  clearUpcoming: () => {
    const { queue, index } = get();
    set({ queue: queue.slice(0, index + 1), original: queue.slice(0, index + 1) });
  },

  openNowPlaying: (tab) => set({ nowPlayingOpen: true, ...(tab ? { tab } : {}) }),
  closeNowPlaying: () => set({ nowPlayingOpen: false }),
  setTab: (t) => set({ tab: t }),
  setVolume: (v) => useSettings.getState().update({ audio: { volume: Math.max(0, Math.min(1, v)), muted: false } }),
  toggleMute: () => useSettings.getState().update({ audio: { muted: !useSettings.getState().settings.audio.muted } })
}));

/** Keep the audio graph in sync with settings and reflect queue edits into preloading. */
export function initAudio(): void {
  audioGraph.apply(useSettings.getState().settings.audio);
  useSettings.subscribe((s, prev) => { if (s.settings.audio !== prev.settings.audio) audioGraph.apply(s.settings.audio); });
  window.addEventListener('pagehide', () => musicEngine.flushOnExit());
}
