import { Expand, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import { useMemo } from 'react';
import { invoke } from '../api';
import { Artwork } from '../components/Artwork';
import { Scrubber } from '../components/Scrubber';
import { Icon, IconButton } from '../components/ui';
import { artistOf } from '../lib/media';
import { musicEngine, useMusic } from '../lib/music-engine';

/** The compact always-on-top music window: artwork, title, transport and a scrubber. */
export function MiniMusic() {
  const s = useMusic();
  const item = s.queue[s.index];
  const getTime = useMemo(() => () => musicEngine.currentTime, []);
  if (!item) return null;
  return (
    <div className="mini glass drag">
      <div className="mini__art"><Artwork mediaId={item.id} hasArt={item.hasArt} title={item.title} kind="audio" shape="square" fit="cover" version={item.mtimeMs} eager /></div>
      <div className="mini__main">
        <div className="mini__text"><div className="truncate mini__title">{item.title}</div><div className="truncate mini__artist">{artistOf(item)}</div></div>
        <div className="mini__transport no-drag">
          <IconButton icon={SkipBack} label="Previous" onClick={() => s.previous()} size={17} />
          <button type="button" className="ctl-play ctl-play--bar" onClick={() => s.toggle()} aria-label={s.playing ? 'Pause' : 'Play'}><Icon as={s.playing ? Pause : Play} size={17} fill="currentColor" strokeWidth={0} /></button>
          <IconButton icon={SkipForward} label="Next" onClick={() => s.next()} size={17} />
        </div>
        <div className="no-drag"><Scrubber duration={s.duration} getTime={getTime} onSeek={(t) => s.seek(t)} label="Seek" /></div>
      </div>
      <div className="mini__btns no-drag">
        <IconButton icon={Expand} label="Back to full window" onClick={() => void invoke('window:setMode', 'normal')} size={14} />
        <IconButton icon={X} label="Stop and close mini player" onClick={() => { s.stop(); void invoke('window:setMode', 'normal'); }} size={14} />
      </div>
    </div>
  );
}
