import {
  ArrowDown, ArrowUp, AudioLines, Camera, Cast, Captions, ChevronsLeftRightEllipsis, Expand, Gauge, ListMusic, ListVideo, Maximize, Mic2, PanelTopOpen, Pause, PictureInPicture2,
  Play, Repeat, RotateCcw, RotateCw, ScanLine, Shuffle, SkipBack, SkipForward, SlidersVertical, Volume2, X, type LucideIcon
} from 'lucide-react';
import { DEFAULT_SETTINGS, MUSIC_CONTROL_IDS, VIDEO_CONTROL_IDS } from '@shared/settings';
import { Button, Icon, IconButton } from '../../components/ui';
import { Group, Row, Select, moveItem, useS } from './parts';

const VIDEO: Record<string, { label: string; icon: LucideIcon }> = {
  skipBack: { label: 'Skip back', icon: RotateCcw },
  playPause: { label: 'Play / pause', icon: Play },
  skipForward: { label: 'Skip forward', icon: RotateCw },
  next: { label: 'Next', icon: SkipForward },
  previous: { label: 'Previous', icon: SkipBack },
  volume: { label: 'Volume', icon: Volume2 },
  speed: { label: 'Speed', icon: Gauge },
  audio: { label: 'Audio track', icon: AudioLines },
  subtitles: { label: 'Subtitles', icon: Captions },
  chapters: { label: 'Chapters', icon: ListVideo },
  pip: { label: 'Picture in Picture', icon: PictureInPicture2 },
  mini: { label: 'Mini player', icon: PanelTopOpen },
  overlay: { label: 'Overlay window', icon: ScanLine },
  screenshot: { label: 'Screenshot', icon: Camera },
  stats: { label: 'Playback stats', icon: ChevronsLeftRightEllipsis },
  aspect: { label: 'Aspect ratio', icon: Expand },
  cast: { label: 'Cast to device', icon: Cast },
  fullscreen: { label: 'Full screen', icon: Maximize }
};

const MUSIC: Record<string, { label: string; icon: LucideIcon }> = {
  shuffle: { label: 'Shuffle', icon: Shuffle },
  previous: { label: 'Previous', icon: SkipBack },
  playPause: { label: 'Play / pause', icon: Pause },
  next: { label: 'Next', icon: SkipForward },
  repeat: { label: 'Repeat', icon: Repeat },
  volume: { label: 'Volume', icon: Volume2 },
  lyrics: { label: 'Lyrics', icon: Mic2 },
  queue: { label: 'Queue', icon: ListMusic },
  eq: { label: 'Equaliser', icon: SlidersVertical },
  mini: { label: 'Mini player', icon: PanelTopOpen }
};

function Editor({ title, defs, all, value, onChange, defaults }: {
  title: string; defs: Record<string, { label: string; icon: LucideIcon }>; all: readonly string[]; value: string[]; onChange: (v: string[]) => void; defaults: string[];
}) {
  const missing = all.filter((id) => !value.includes(id));
  return (
    <Group
      title={title}
      footer="Controls without anything to act on (for example Audio track on a file with one track) hide themselves automatically."
      action={<Button size="sm" variant="plain" onClick={() => onChange([...defaults])}>Reset</Button>}
    >
      <div className="cpreview" aria-label={`${title} preview`}>
        {value.map((id) => { const d = defs[id]; return d ? <span key={id} className={`cpreview__btn ${id === 'playPause' ? 'is-play' : ''}`} title={d.label}><Icon as={d.icon} size={id === 'playPause' ? 20 : 17} /></span> : null; })}
        {value.length === 0 && <span className="secondary t-footnote">No controls — add some below.</span>}
      </div>
      {value.map((id, i) => {
        const d = defs[id];
        if (!d) return null;
        return (
          <div className="srow srow--compact" key={id}>
            <div className="srow__text sorder__label"><Icon as={d.icon} size={16} className="secondary" /><span>{d.label}</span></div>
            <div className="srow__ctl">
              <IconButton icon={ArrowUp} label={`Move ${d.label} earlier`} disabled={i === 0} onClick={() => onChange(moveItem(value, i, -1))} />
              <IconButton icon={ArrowDown} label={`Move ${d.label} later`} disabled={i === value.length - 1} onClick={() => onChange(moveItem(value, i, 1))} />
              <IconButton icon={X} label={`Remove ${d.label}`} onClick={() => onChange(value.filter((x) => x !== id))} />
            </div>
          </div>
        );
      })}
      {missing.length > 0 && (
        <Row label="Add a control">
          <Select label={`Add a ${title.toLowerCase()}`} value="" options={[{ value: '', label: 'Choose…' }, ...missing.map((id) => ({ value: id, label: defs[id]?.label ?? id }))]} onChange={(v) => { if (v) onChange([...value, v]); }} />
        </Row>
      )}
    </Group>
  );
}

export function ControlsPane() {
  const { s, update } = useS();
  return (
    <>
      <p className="secondary t-subhead settings__lede">Pick which buttons the players show, and in what order. The play button stays in the middle; volume sits on the left; everything else lines up on the right.</p>
      <Editor title="Video player" defs={VIDEO} all={VIDEO_CONTROL_IDS} value={s.controls.video} defaults={DEFAULT_SETTINGS.controls.video} onChange={(video) => update({ controls: { video } })} />
      <Editor title="Music player" defs={MUSIC} all={MUSIC_CONTROL_IDS} value={s.controls.music} defaults={DEFAULT_SETTINGS.controls.music} onChange={(music) => update({ controls: { music } })} />
    </>
  );
}
