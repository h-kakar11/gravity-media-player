import { useEffect, useState } from 'react';
import { Equalizer } from '../../music/Equalizer';
import { Segmented, Switch } from '../../components/ui';
import { Group, Row, Select, SliderControl, useS } from './parts';

/** Output devices the browser engine can route audio to. Labels can be empty until the OS grants access. */
function useOutputDevices() {
  const [devices, setDevices] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        const outs = all.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
        if (alive) setDevices(outs.map((d, i) => ({ id: d.deviceId, label: d.label || `Output ${i + 1}` })));
      } catch { if (alive) setDevices([]); }
    };
    void load();
    navigator.mediaDevices?.addEventListener?.('devicechange', load);
    return () => { alive = false; navigator.mediaDevices?.removeEventListener?.('devicechange', load); };
  }, []);
  return devices;
}

export function AudioPane() {
  const { s, update } = useS();
  const a = s.audio;
  const set = (p: Partial<typeof a>) => update({ audio: p });
  const devices = useOutputDevices();
  const ly = s.lyrics;
  const setLy = (p: Partial<typeof ly>) => update({ lyrics: p });
  return (
    <>
      <Group title="Playback" footer="Crossfade and gapless apply to music. Gapless keeps live albums and concept records seamless.">
        <Row label="Gapless playback"><Switch label="Gapless playback" checked={a.gapless} onChange={(v) => set({ gapless: v })} /></Row>
        <Row label="Crossfade"><SliderControl label="Crossfade" value={a.crossfadeSec} min={0} max={12} onChange={(v) => set({ crossfadeSec: v })} format={(v) => (v === 0 ? 'Off' : `${v} s`)} /></Row>
        <Row label="Sound check (ReplayGain)" hint="Evens out loudness between tracks using tags in your files. Quiet masters are never boosted into clipping.">
          <Segmented label="ReplayGain" value={a.replayGain} onChange={(v) => set({ replayGain: v })} options={[{ value: 'track', label: 'On' }, { value: 'off', label: 'Off' }]} />
        </Row>
        <Row label="Lyrics" hint="Synced lyrics from .lrc files or tags, shown in Now Playing."><Switch label="Show lyrics" checked={a.lyrics} onChange={(v) => set({ lyrics: v })} /></Row>
        <Row label="Online lyrics (LRCLIB)" hint="Looks up time-synced lyrics at lrclib.net when a song has none. Sends only the title, artist, album and duration of the song you open. Off by default."><Switch label="Look up lyrics on LRCLIB" checked={ly.lrclib} onChange={(v) => setLy({ lrclib: v })} /></Row>
        {ly.lrclib && <Row label="Save found lyrics" hint="Write synced lyrics next to the song as a .lrc file the first time they’re found. Never overwrites an existing file."><Switch label="Save LRCLIB lyrics as .lrc" checked={ly.autoSave} onChange={(v) => setLy({ autoSave: v })} /></Row>}
        <Row label="Visualiser" hint="Spectrum behind the equaliser and on Now Playing."><Switch label="Show visualizer" checked={a.visualizer} onChange={(v) => set({ visualizer: v })} /></Row>
      </Group>

      <Group title="Output" footer="Audio is processed in 32-bit floating point and delivered to your system mixer. Exclusive or bit-perfect output isn’t available from this app’s engine.">
        <Row label="Output device">
          <Select label="Output device" value={a.outputDeviceId} options={[{ value: '', label: 'System default' }, ...devices.map((d) => ({ value: d.id, label: d.label }))]} onChange={(v) => set({ outputDeviceId: v })} />
        </Row>
        <Row label="Night mode" hint="Compresses loud scenes and lifts quiet dialogue — for late-night viewing. Applies to video and music.">
          <Select label="Night mode" value={a.nightMode} options={[{ value: 'off', label: 'Off' }, { value: 'light', label: 'Light' }, { value: 'strong', label: 'Strong' }]} onChange={(v) => set({ nightMode: v })} />
        </Row>
        <Row label="Mono"><Switch label="Mono output" checked={a.mono} onChange={(v) => set({ mono: v })} /></Row>
        <Row label="Balance"><SliderControl label="Balance" value={Math.round(a.balance * 100)} min={-100} max={100} onChange={(v) => set({ balance: v / 100 })} format={(v) => (v === 0 ? 'Centre' : v < 0 ? `${-v}% left` : `${v}% right`)} /></Row>
      </Group>

      <Group title="Equaliser" footer="Ten bands with a preamp, a soft limiter and a response curve drawn from the actual filters. It applies to music and video, and presets can be saved.">
        <div className="eq-panel glass-dark"><Equalizer /></div>
      </Group>
    </>
  );
}
