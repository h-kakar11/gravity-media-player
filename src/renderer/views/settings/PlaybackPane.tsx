import { FolderOpen } from 'lucide-react';
import type { CSSProperties } from 'react';
import { invoke } from '../../api';
import { Button, Segmented, Switch } from '../../components/ui';
import { useApp } from '../../state/app';
import { CommitText, Group, Row, Select, SliderControl, Stepper, useS } from './parts';

const SPEEDS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3, 4, 5];
const FONT_STACK: Record<string, string> = {
  system: 'var(--font-sans)',
  serif: 'var(--font-serif)',
  mono: 'var(--font-mono)',
  rounded: "ui-rounded, 'SF Pro Rounded', 'Nunito', var(--font-sans)"
};

const parseLangs = (v: string) => [...new Set(v.split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];

/** Live sample of the subtitle style over a video-like backdrop. */
function SubtitlePreview() {
  const { s } = useS();
  const st = s.playback.subtitleStyle;
  const style: CSSProperties = {
    fontSize: `${1.25 * st.size}rem`, color: st.color, fontFamily: FONT_STACK[st.font],
    background: `rgba(0,0,0,${st.background})`,
    textShadow: st.outline ? '0 0 2px #000, 0 1px 3px #000, 1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000' : 'none'
  };
  return (
    <div className="sub-preview" aria-hidden="true">
      <span style={{ ...style, marginBottom: `${st.bottom * 2.2}px` }}>Gravity is the quietest of the forces.</span>
    </div>
  );
}

export function PlaybackPane() {
  const { s, update } = useS();
  const info = useApp((x) => x.info);
  const p = s.playback;
  const set = (patch: Partial<typeof p>) => update({ playback: patch });
  const st = p.subtitleStyle;
  const setSt = (patch: Partial<typeof st>) => update({ playback: { subtitleStyle: patch } });
  const hw = (info?.ffmpeg.encoders ?? []).filter((e) => /(videotoolbox|nvenc|qsv|vaapi|amf|_mf)$/.test(e));

  const pickShots = async () => {
    const dir = await invoke('dialog:pickFolder', 'Choose a folder for screenshots');
    if (dir) set({ screenshotFolder: dir });
  };

  return (
    <>
      <Group title="Starting playback">
        <Row label="Resume where you left off" hint="Titles you’ve nearly finished start from the beginning.">
          <Segmented label="Resume" value={p.resume} onChange={(v) => set({ resume: v })} options={[{ value: 'always', label: 'Resume' }, { value: 'never', label: 'Start over' }]} />
        </Row>
        <Row label="Play next episode automatically"><Switch label="Autoplay next" checked={p.autoplayNext} onChange={(v) => set({ autoplayNext: v })} /></Row>
        <Row label="Open in full screen"><Switch label="Open in full screen" checked={p.fullscreenOnPlay} onChange={(v) => set({ fullscreenOnPlay: v })} /></Row>
        <Row label="Keep the screen awake while playing"><Switch label="Keep screen awake" checked={p.keepAwake} onChange={(v) => set({ keepAwake: v })} /></Row>
        <Row label="Switch to the mini player when leaving the window" hint="Handy for following a video while you work."><Switch label="Mini player on leave" checked={p.miniPlayerOnLeave} onChange={(v) => set({ miniPlayerOnLeave: v })} /></Row>
        <Row label="Count a title as watched at" hint="Reaching this point marks it complete and moves on in your history.">
          <SliderControl label="Completion threshold" value={Math.round(p.completeThreshold * 100)} min={50} max={100} step={1} onChange={(v) => set({ completeThreshold: v / 100 })} format={(v) => `${v}%`} />
        </Row>
      </Group>

      <Group title="Speed & skipping" footer="Speed ranges from 0.1× to 5×. The speed dial in the player also accepts exact values.">
        <Row label="Default speed">
          <Select label="Default speed" value={p.defaultSpeed} options={SPEEDS.map((v) => ({ value: v, label: `${v}×` }))} onChange={(v) => set({ defaultSpeed: v })} />
        </Row>
        <Row label="Remember speed between titles" hint="Off: every title starts at the default speed."><Switch label="Remember speed" checked={p.rememberSpeed} onChange={(v) => set({ rememberSpeed: v })} /></Row>
        <Row label="Skip back"><Stepper label="skip back" value={p.skipBackSec} min={1} max={300} step={5} unit=" s" onChange={(v) => set({ skipBackSec: v })} /></Row>
        <Row label="Skip forward"><Stepper label="skip forward" value={p.skipForwardSec} min={1} max={300} step={5} unit=" s" onChange={(v) => set({ skipForwardSec: v })} /></Row>
        <Row label="Seek-bar previews" hint="Show a thumbnail above the timeline while scrubbing."><Switch label="Seek-bar previews" checked={p.seekPreview} onChange={(v) => set({ seekPreview: v })} /></Row>
        <Row label="Hide controls after"><Stepper label="auto-hide delay" value={p.autoHideControlsSec} min={1} max={15} unit=" s" onChange={(v) => set({ autoHideControlsSec: v })} /></Row>
      </Group>

      <Group title="Languages" footer="Language codes such as en, ja, fr or spa, in order of preference. Leave audio empty to use each file’s default track.">
        <Row label="Preferred audio"><CommitText label="Preferred audio languages" width={200} placeholder="File default" value={p.preferredAudioLangs.join(', ')} onCommit={(v) => set({ preferredAudioLangs: parseLangs(v) })} /></Row>
        <Row label="Preferred subtitles"><CommitText label="Preferred subtitle languages" width={200} placeholder="en" value={p.preferredSubtitleLangs.join(', ')} onCommit={(v) => set({ preferredSubtitleLangs: parseLangs(v) })} /></Row>
        <Row label="Subtitles">
          <Select label="Subtitle behaviour" value={p.subtitles} options={[{ value: 'off', label: 'Off unless I turn them on' }, { value: 'auto', label: 'Automatic — when audio isn’t my language' }, { value: 'always', label: 'Always on' }]} onChange={(v) => set({ subtitles: v })} />
        </Row>
      </Group>

      <Group title="Subtitle appearance">
        <SubtitlePreview />
        <Row label="Size"><SliderControl label="Subtitle size" value={Math.round(st.size * 100)} min={50} max={250} step={5} onChange={(v) => setSt({ size: v / 100 })} format={(v) => `${v}%`} /></Row>
        <Row label="Colour">
          <div className="swatches swatches--sm" role="radiogroup" aria-label="Subtitle colour">
            {[['#ffffff', 'White'], ['#ffe27a', 'Yellow'], ['#9fe8ff', 'Cyan'], ['#b5ffb0', 'Green']].map(([c, n]) => (
              <button key={c} type="button" role="radio" aria-checked={st.color === c} aria-label={n} title={n} className={`swatch ${st.color === c ? 'is-on' : ''}`} style={{ background: c, ['--ring' as string]: 'var(--accent)' }} onClick={() => setSt({ color: c! })} />
            ))}
          </div>
        </Row>
        <Row label="Background"><SliderControl label="Subtitle background" value={Math.round(st.background * 100)} min={0} max={100} step={5} onChange={(v) => setSt({ background: v / 100 })} format={(v) => `${v}%`} /></Row>
        <Row label="Font"><Select label="Subtitle font" value={st.font} options={[{ value: 'system', label: 'System' }, { value: 'serif', label: 'Serif' }, { value: 'rounded', label: 'Rounded' }, { value: 'mono', label: 'Monospaced' }]} onChange={(v) => setSt({ font: v })} /></Row>
        <Row label="Outline"><Switch label="Subtitle outline" checked={st.outline} onChange={(v) => setSt({ outline: v })} /></Row>
        <Row label="Distance from bottom"><SliderControl label="Subtitle distance from bottom" value={st.bottom} min={2} max={25} onChange={(v) => setSt({ bottom: v })} format={(v) => `${v}%`} /></Row>
      </Group>

      <Group title="When a file can’t play directly" footer="Gravity plays what your system supports as-is, re-wraps compatible streams without quality loss, and only converts as a last resort — in real time, never writing a converted copy to disk. Converting needs ffmpeg.">
        <Row label="Hardware encoder" hint="Used only when conversion is unavoidable.">
          <Select label="Hardware encoder" value={p.hwaccel} options={[{ value: 'auto', label: 'Automatic' }, { value: 'none', label: 'None — software' }, ...hw.map((e) => ({ value: e, label: e }))]} onChange={(v) => set({ hwaccel: v })} />
        </Row>
        <Row label="Conversion quality">
          <Select label="Conversion quality" value={p.transcodeQuality} options={[{ value: 'fast', label: 'Fast' }, { value: 'balanced', label: 'Balanced' }, { value: 'high', label: 'High quality' }]} onChange={(v) => set({ transcodeQuality: v })} />
        </Row>
        <Row label="Largest converted picture" hint="Lower values need less CPU on weak machines.">
          <Select label="Largest converted picture" value={p.transcodeMaxHeight} options={[{ value: 0, label: 'Same as source' }, { value: 2160, label: '4K' }, { value: 1440, label: '1440p' }, { value: 1080, label: '1080p' }, { value: 720, label: '720p' }, { value: 480, label: '480p' }]} onChange={(v) => set({ transcodeMaxHeight: v })} />
        </Row>
      </Group>

      <Group title="Screenshots">
        <Row label="Save screenshots to" hint={p.screenshotFolder || 'Pictures / Gravity'}>
          <div className="srow__btns">
            <Button size="sm" icon={FolderOpen} onClick={() => void pickShots()}>Choose…</Button>
            {p.screenshotFolder && <Button size="sm" variant="plain" onClick={() => set({ screenshotFolder: '' })}>Use Default</Button>}
          </div>
        </Row>
      </Group>
    </>
  );
}
