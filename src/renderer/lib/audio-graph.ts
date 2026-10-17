import { EQ_BANDS, type Settings } from '@shared/settings';

export interface EqPreset { name: string; preamp: number; gains: number[] }

/** Built-in presets (10 bands: 31 Hz … 16 kHz). Gains in dB. */
export const EQ_PRESETS: EqPreset[] = [
  { name: 'Flat', preamp: 0, gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: 'Bass Boost', preamp: -4, gains: [6, 5.5, 4.5, 2.5, 0.5, 0, 0, 0, 0, 0] },
  { name: 'Bass Reducer', preamp: 0, gains: [-6, -5, -3.5, -1.5, 0, 0, 0, 0, 0, 0] },
  { name: 'Treble Boost', preamp: -4, gains: [0, 0, 0, 0, 0, 1, 2.5, 4.5, 5.5, 6] },
  { name: 'Vocal', preamp: -2, gains: [-3, -2.5, -1.5, 0.5, 3, 3.5, 3, 1.5, 0, -1.5] },
  { name: 'Rock', preamp: -3, gains: [4.5, 3.5, 2, -1, -2, -0.5, 2, 3.5, 4.5, 5] },
  { name: 'Pop', preamp: -2, gains: [-1.5, 1, 3, 3.5, 2.5, 0, -1.5, -1.5, -1, -1] },
  { name: 'Jazz', preamp: -2, gains: [3, 2, 1, 2, -1.5, -1.5, 0, 1.5, 2.5, 3.5] },
  { name: 'Classical', preamp: -2, gains: [4, 3, 2.5, 2, -1, -1, 0, 2, 3, 3.5] },
  { name: 'Electronic', preamp: -3, gains: [5, 4.5, 1.5, 0, -2, 2, 1, 1.5, 4.5, 5] },
  { name: 'Late Night', preamp: -1, gains: [2, 1.5, 0.5, 0, 0, 1, 1.5, 1, -0.5, -2] },
  { name: 'Spoken Word', preamp: -2, gains: [-4, -3, -1, 1.5, 3, 4, 3.5, 2, 0, -3] }
];

/** Fixed Q for peaking bands: one-octave bandwidth between ISO centre frequencies. */
const PEAK_Q = 1.41;

const dbToGain = (db: number) => Math.pow(10, db / 20);

/**
 * One Web Audio graph shared by music and video:
 *
 *   source → trim → preamp → 10-band EQ → night-mode compressor → limiter → [mono] → balance → master → analyser → output
 *
 * All processing happens in 32-bit float, so boosting a band can't clip until the limiter —
 * which is why the EQ here sounds cleaner than 16-bit-domain equalisers. Parameter changes are
 * smoothed with short ramps to avoid zipper noise.
 */
class AudioGraph {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private preamp!: GainNode;
  private bands: BiquadFilterNode[] = [];
  private night!: DynamicsCompressorNode;
  private limiter!: DynamicsCompressorNode;
  private monoNode!: GainNode;
  private panner!: StereoPannerNode;
  private nightMakeup!: GainNode;
  analyser!: AnalyserNode;
  private input!: GainNode;
  private sources = new Map<HTMLMediaElement, { source: MediaElementAudioSourceNode; gain: GainNode }>();
  private volume = 0.8;
  private muted = false;
  private sinkId = '';

  private ensure(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext({ latencyHint: 'playback' });
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.preamp = ctx.createGain();
    this.bands = EQ_BANDS.map((f, i) => {
      const b = ctx.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
      b.frequency.value = f;
      b.Q.value = PEAK_Q;
      b.gain.value = 0;
      return b;
    });
    this.night = ctx.createDynamicsCompressor();
    this.nightMakeup = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.monoNode = ctx.createGain();
    this.panner = ctx.createStereoPanner();
    this.master = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.82;
    this.analyser.minDecibels = -92;
    this.analyser.maxDecibels = -12;

    this.input.connect(this.preamp);
    let prev: AudioNode = this.preamp;
    for (const b of this.bands) { prev.connect(b); prev = b; }
    prev.connect(this.night);
    this.night.connect(this.nightMakeup);
    this.nightMakeup.connect(this.limiter);
    this.limiter.connect(this.monoNode);
    this.monoNode.connect(this.panner);
    this.panner.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    this.setNight('off');
    this.setLimiter(true);
    this.setMono(false);
    this.master.gain.value = this.muted ? 0 : this.volume * this.volume;
    if (this.sinkId) void this.applySink();
    return ctx;
  }

  /** Route a media element through the graph (an element can only be connected once). */
  attach(el: HTMLMediaElement): GainNode {
    const ctx = this.ensure();
    const hit = this.sources.get(el);
    if (hit) return hit.gain;
    const source = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    source.connect(gain);
    gain.connect(this.input);
    this.sources.set(el, { source, gain });
    return gain;
  }

  resume(): void {
    const ctx = this.ensure();
    if (ctx.state === 'suspended') void ctx.resume();
  }

  private ramp(param: AudioParam, value: number, tc = 0.02): void {
    const ctx = this.ctx;
    if (!ctx) return;
    param.cancelScheduledValues(ctx.currentTime);
    param.setTargetAtTime(value, ctx.currentTime, tc);
  }

  setVolume(v: number, muted: boolean): void {
    this.volume = v;
    this.muted = muted;
    if (this.ctx) this.ramp(this.master.gain, muted ? 0 : v * v, 0.03);
  }

  setEq(eq: Settings['audio']['eq']): void {
    this.ensure();
    this.ramp(this.preamp.gain, eq.enabled ? dbToGain(eq.preamp) : 1);
    this.bands.forEach((b, i) => this.ramp(b.gain, eq.enabled ? (eq.gains[i] ?? 0) : 0));
    this.setLimiter(eq.limiter);
  }

  setLimiter(on: boolean): void {
    const l = this.limiter;
    const t = this.ctx!.currentTime;
    l.threshold.setValueAtTime(on ? -1.5 : 0, t);
    l.knee.setValueAtTime(on ? 0 : 0, t);
    l.ratio.setValueAtTime(on ? 20 : 1, t);
    l.attack.setValueAtTime(0.002, t);
    l.release.setValueAtTime(0.12, t);
  }

  /** Night mode evens out loud scenes and quiet dialogue — handy when others are asleep. */
  setNight(mode: 'off' | 'light' | 'strong'): void {
    this.ensure();
    const n = this.night;
    const t = this.ctx!.currentTime;
    const cfg = { off: { th: 0, knee: 0, ratio: 1, make: 1 }, light: { th: -26, knee: 24, ratio: 3.5, make: dbToGain(4) }, strong: { th: -34, knee: 20, ratio: 9, make: dbToGain(9) } }[mode];
    n.threshold.setValueAtTime(cfg.th, t);
    n.knee.setValueAtTime(cfg.knee, t);
    n.ratio.setValueAtTime(cfg.ratio, t);
    n.attack.setValueAtTime(0.004, t);
    n.release.setValueAtTime(0.28, t);
    this.ramp(this.nightMakeup.gain, cfg.make, 0.05);
  }

  setMono(on: boolean): void {
    this.ensure();
    this.monoNode.channelCount = on ? 1 : 2;
    this.monoNode.channelCountMode = on ? 'explicit' : 'max';
    this.monoNode.channelInterpretation = 'speakers';
  }

  setBalance(b: number): void {
    this.ensure();
    this.ramp(this.panner.pan, Math.max(-1, Math.min(1, b)));
  }

  /** Frequency response of the EQ stage (dB at each requested frequency) for drawing the curve. */
  response(freqs: Float32Array<ArrayBuffer>): Float32Array {
    this.ensure();
    const total = new Float32Array(freqs.length);
    const mag = new Float32Array(new ArrayBuffer(freqs.length * 4));
    const phase = new Float32Array(new ArrayBuffer(freqs.length * 4));
    for (const b of this.bands) {
      b.getFrequencyResponse(freqs, mag, phase);
      for (let i = 0; i < total.length; i++) total[i]! += 20 * Math.log10(Math.max(mag[i]!, 1e-6));
    }
    return total;
  }

  async setSink(deviceId: string): Promise<void> {
    this.sinkId = deviceId;
    if (this.ctx) await this.applySink();
  }

  private async applySink(): Promise<void> {
    const ctx = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    try {
      if (ctx?.setSinkId) await ctx.setSinkId(this.sinkId || '');
    } catch (err) {
      console.warn('Could not switch audio output', err);
    }
  }

  get sampleRate(): number { return this.ctx?.sampleRate ?? 48000; }
  get state(): string { return this.ctx?.state ?? 'closed'; }
  get time(): number { return this.ctx?.currentTime ?? 0; }

  /** Push every audio setting into the graph. */
  apply(a: Settings['audio']): void {
    this.ensure();
    this.setVolume(a.volume, a.muted);
    this.setEq(a.eq);
    this.setNight(a.nightMode);
    this.setMono(a.mono);
    this.setBalance(a.balance);
    void this.setSink(a.outputDeviceId);
  }

  gainFor(el: HTMLMediaElement): GainNode | null {
    return this.sources.get(el)?.gain ?? null;
  }
}

export const audioGraph = new AudioGraph();
export const replayGainToLinear = (db: number | null, mode: 'off' | 'track'): number => {
  if (mode === 'off' || db == null) return 1;
  // Cap boosts so quiet masters aren't pushed into the limiter.
  return dbToGain(Math.max(-18, Math.min(6, db)));
};
