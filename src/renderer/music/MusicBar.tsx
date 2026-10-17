import { ChevronUp, ListMusic, Mic2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react';
import { useMemo } from 'react';
import { Artwork } from '../components/Artwork';
import { Scrubber } from '../components/Scrubber';
import { Icon, IconButton } from '../components/ui';
import { musicEngine, useMusic } from '../lib/music-engine';
import { artistOf } from '../lib/media';
import { useSettings } from '../state/settings';
import { useVideo } from '../state/video';
import { useApp } from '../state/app';

export function VolumeControl({ compact }: { compact?: boolean }) {
  const audio = useSettings((s) => s.settings.audio);
  const set = useMusic((s) => s.setVolume);
  const mute = useMusic((s) => s.toggleMute);
  const VolIcon = audio.muted || audio.volume === 0 ? VolumeX : audio.volume < 0.45 ? Volume1 : Volume2;
  return (
    <div className={`vol ${compact ? 'vol--compact' : ''}`}>
      <IconButton icon={VolIcon} label={audio.muted ? 'Unmute' : 'Mute'} onClick={mute} />
      <input type="range" className="slider vol__slider" min={0} max={100} value={audio.muted ? 0 : Math.round(audio.volume * 100)} aria-label="Volume" style={{ '--p': `${audio.muted ? 0 : audio.volume * 100}%` } as React.CSSProperties} onChange={(e) => set(Number(e.target.value) / 100)} />
    </div>
  );
}

/** Floating glass player that stays above the library while music plays. */
export function MusicBar() {
  const queue = useMusic((s) => s.queue);
  const index = useMusic((s) => s.index);
  const playing = useMusic((s) => s.playing);
  const loading = useMusic((s) => s.loading);
  const duration = useMusic((s) => s.duration);
  const shuffle = useMusic((s) => s.shuffle);
  const repeat = useMusic((s) => s.repeat);
  const m = useMusic.getState();
  const videoOpen = useVideo((s) => s.open);
  const mode = useApp((s) => s.win.mode);
  const nowOpen = useMusic((s) => s.nowPlayingOpen);
  const item = queue[index];
  const getTime = useMemo(() => () => musicEngine.currentTime, []);
  if (!item || videoOpen || mode !== 'normal' || nowOpen) return null;

  return (
    <div className="mbar glass" role="region" aria-label="Music player">
      <button type="button" className="mbar__now" onClick={() => m.openNowPlaying('art')} aria-label="Open Now Playing">
        <div className="mbar__art"><Artwork mediaId={item.id} hasArt={item.hasArt} title={item.title} kind="audio" shape="square" fit="cover" version={item.mtimeMs} eager /></div>
        <div className="mbar__text">
          <div className="truncate mbar__title">{item.title}</div>
          <div className="truncate mbar__artist">{artistOf(item)}{item.album ? ` — ${item.album}` : ''}</div>
        </div>
      </button>
      <div className="mbar__center">
        <div className="mbar__transport">
          <IconButton icon={Shuffle} label="Shuffle" active={shuffle} onClick={() => m.setShuffle(!shuffle)} size={15} />
          <IconButton icon={SkipBack} label="Previous" onClick={() => m.previous()} size={19} />
          <button type="button" className="ctl-play ctl-play--bar" onClick={() => m.toggle()} aria-label={playing ? 'Pause' : 'Play'}>{loading && !playing ? <span className="spinner" style={{ width: 16, height: 16 }} /> : <Icon as={playing ? Pause : Play} size={19} fill="currentColor" strokeWidth={0} />}</button>
          <IconButton icon={SkipForward} label="Next" onClick={() => m.next()} size={19} />
          <IconButton icon={repeat === 'one' ? Repeat1 : Repeat} label={`Repeat: ${repeat}`} active={repeat !== 'off'} onClick={() => m.cycleRepeat()} size={15} />
        </div>
        <Scrubber duration={duration} getTime={getTime} onSeek={(t) => m.seek(t)} showTimes label="Seek" />
      </div>
      <div className="mbar__right">
        <IconButton icon={Mic2} label="Lyrics" onClick={() => m.openNowPlaying('lyrics')} size={16} />
        <IconButton icon={ListMusic} label="Queue" onClick={() => m.openNowPlaying('queue')} size={16} />
        <VolumeControl compact />
        <IconButton icon={ChevronUp} label="Open Now Playing" onClick={() => m.openNowPlaying('art')} size={17} />
      </div>
    </div>
  );
}
