import { RotateCcw, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { EQ_BANDS } from '@shared/settings';
import { audioGraph, EQ_PRESETS } from '../lib/audio-graph';
import { useSettings } from '../state/settings';
import { toast, useUi } from '../state/ui';
import { Button, Switch } from '../components/ui';

const W = 640, H = 150, DB = 18;
const FREQS = Float32Array.from({ length: 160 }, (_, i) => 20 * Math.pow(1000, i / 159));
const fx = (f: number) => (Math.log(f / 20) / Math.log(1000)) * W;
const dy = (db: number) => H / 2 - (db / DB) * (H / 2);
/** Track fill that grows from the centre (0 dB) toward the slider value. */
const bipolar = (v: number, max: number): React.CSSProperties => {
  const pos = ((v + max) / (2 * max)) * 100;
  const lo = Math.min(pos, 50), hi = Math.max(pos, 50);
  return { '--track': `linear-gradient(to top, var(--fill) ${lo}%, var(--accent-fill) ${lo}%, var(--accent-fill) ${hi}%, var(--fill) ${hi}%)` } as React.CSSProperties;
};
const label = (f: number) => (f >= 1000 ? `${f / 1000}k` : String(f));

/** 10-band graphic equaliser with a preamp, presets, a live response curve and the real-time spectrum behind it. */
export function Equalizer() {
  const eq = useSettings((s) => s.settings.audio.eq);
  const custom = useSettings((s) => s.settings.audio.customPresets);
  const update = useSettings((s) => s.update);
  const spectrum = useRef<SVGPathElement>(null);
  const analyserBins = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const setEq = (patch: Partial<typeof eq>) => update({ audio: { eq: { ...eq, ...patch } } });
  const setBand = (i: number, g: number) => {
    const gains = eq.gains.map((x, k) => (k === i ? g : x));
    setEq({ gains, preset: 'Custom', enabled: true });
  };

  const curve = useMemo(() => {
    // Evaluate the actual biquad chain, so the drawn curve is exactly what you hear.
    const resp = audioGraph.response(FREQS);
    return `M ${Array.from(FREQS, (f, i) => `${fx(f).toFixed(1)} ${dy(Math.max(-DB, Math.min(DB, eq.enabled ? resp[i]! : 0))).toFixed(1)}`).join(' L ')}`;
  }, [eq.gains, eq.enabled]);

  // Live spectrum: the signal after EQ, drawn as a soft filled shape.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const a = audioGraph.analyser;
      if (a && spectrum.current) {
        const bins = (analyserBins.current ??= new Uint8Array(new ArrayBuffer(a.frequencyBinCount)));
        a.getByteFrequencyData(bins);
        const nyq = audioGraph.sampleRate / 2;
        let d = `M 0 ${H}`;
        for (let i = 0; i < 90; i++) {
          const f = 20 * Math.pow(1000, i / 89);
          const bin = Math.min(bins.length - 1, Math.round((f / nyq) * bins.length));
          d += ` L ${fx(f).toFixed(1)} ${(H - (bins[bin]! / 255) * H * 0.9).toFixed(1)}`;
        }
        spectrum.current.setAttribute('d', `${d} L ${W} ${H} Z`);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const apply = (name: string) => {
    const p = [...EQ_PRESETS, ...custom].find((x) => x.name === name);
    if (p) setEq({ preset: p.name, gains: [...p.gains], preamp: p.preamp, enabled: true });
  };
  const isCustom = custom.some((p) => p.name === eq.preset);

  const savePreset = async () => {
    const name = await useUi.getState().prompt({ title: 'Save EQ Preset', message: 'Name this equaliser setting.', value: eq.preset === 'Custom' ? '' : eq.preset, placeholder: 'My preset', confirmLabel: 'Save' });
    if (!name) return;
    if (EQ_PRESETS.some((p) => p.name.toLowerCase() === name.toLowerCase())) return toast('error', 'That name is used by a built-in preset.');
    update({ audio: { customPresets: [...custom.filter((p) => p.name !== name), { name, preamp: eq.preamp, gains: [...eq.gains] }], eq: { ...eq, preset: name } } });
    toast('success', `Saved preset “${name}”`);
  };

  return (
    <div className={`eq ${eq.enabled ? '' : 'is-off'}`}>
      <div className="eq__head">
        <label className="eq__enable"><Switch checked={eq.enabled} onChange={(v) => setEq({ enabled: v })} label="Equaliser" /><span className="t-headline">Equaliser</span></label>
        <select className="field eq__preset" aria-label="Preset" value={eq.preset} onChange={(e) => apply(e.target.value)}>
          {eq.preset === 'Custom' && <option value="Custom">Custom</option>}
          <optgroup label="Presets">{EQ_PRESETS.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</optgroup>
          {custom.length > 0 && <optgroup label="My Presets">{custom.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</optgroup>}
        </select>
        <Button size="sm" icon={Save} onClick={() => void savePreset()}>Save</Button>
        {isCustom && <Button size="sm" icon={Trash2} onClick={() => update({ audio: { customPresets: custom.filter((p) => p.name !== eq.preset), eq: { ...eq, preset: 'Custom' } } })}>Delete</Button>}
        <Button size="sm" icon={RotateCcw} onClick={() => apply('Flat')}>Reset</Button>
      </div>

      <svg className="eq__curve" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Frequency response">
        <path ref={spectrum} className="eq__spectrum" d={`M 0 ${H} L ${W} ${H} Z`} />
        {[-12, -6, 0, 6, 12].map((db) => <line key={db} x1={0} x2={W} y1={dy(db)} y2={dy(db)} className={db === 0 ? 'eq__zero' : 'eq__grid'} />)}
        {EQ_BANDS.map((f) => <line key={f} x1={fx(f)} x2={fx(f)} y1={0} y2={H} className="eq__grid" />)}
        <path d={curve} className="eq__line" />
      </svg>

      <div className="eq__bands">
        <div className="eq__band eq__band--pre">
          <span className="eq__val tabular">{eq.preamp > 0 ? '+' : ''}{eq.preamp.toFixed(1)}</span>
          <input type="range" className="eq__slider" min={-18} max={18} step={0.5} value={eq.preamp} aria-label="Preamp (dB)" orient="vertical" onChange={(e) => setEq({ preamp: Number(e.target.value), preset: 'Custom' })} style={bipolar(eq.preamp, 18)} />
          <span className="eq__freq">Preamp</span>
        </div>
        {EQ_BANDS.map((f, i) => (
          <div key={f} className="eq__band">
            <span className="eq__val tabular">{eq.gains[i]! > 0 ? '+' : ''}{eq.gains[i]!.toFixed(1)}</span>
            <input type="range" className="eq__slider" min={-12} max={12} step={0.5} value={eq.gains[i]} aria-label={`${label(f)} Hz gain (dB)`} orient="vertical" onChange={(e) => setBand(i, Number(e.target.value))} onDoubleClick={() => setBand(i, 0)} style={bipolar(eq.gains[i]!, 12)} />
            <span className="eq__freq">{label(f)}</span>
          </div>
        ))}
      </div>
      <label className="eq__limiter"><Switch checked={eq.limiter} onChange={(v) => setEq({ limiter: v })} label="Prevent clipping" /><span>Peak limiter <span className="secondary">— keeps boosted bands from distorting</span></span></label>
    </div>
  );
}

declare module 'react' {
  interface InputHTMLAttributes<T> { orient?: string }
}
