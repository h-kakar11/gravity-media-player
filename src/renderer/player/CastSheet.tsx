import { Cast, Pause, Play, RefreshCw, Square, Tv, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatDuration } from '@shared/format';
import { useVideoPlayer } from '../lib/video-engine';
import { videoEngine } from '../lib/video-engine';
import { hotkeyCapture } from '../lib/hotkeys';
import { Button, Icon, IconButton, Spinner } from '../components/ui';
import { useApp } from '../state/app';
import { useSettings } from '../state/settings';
import { toast } from '../state/ui';
import { isCasting, useCast } from '../state/cast';
import '../styles/cast.css';

const STATE_LABEL = { idle: '', connecting: 'Connecting…', buffering: 'Buffering…', playing: 'Playing', paused: 'Paused', error: 'Failed' } as const;

/**
 * Mounted while the video player is open. It keeps the cast status in sync, ties a cast to what
 * the player is showing (closing the player or changing title ends it), and hosts the device sheet.
 */
export function CastHost() {
  const enabled = useSettings((s) => s.settings.cast.enabled);
  const open = useCast((c) => c.open);
  const mode = useApp((s) => s.win.mode);
  const itemId = useVideoPlayer((s) => s.item?.id ?? null);
  const castId = useCast((c) => (isCasting(c.status) ? c.status.mediaId : null));

  useEffect(() => useCast.getState().listen(), []);
  // Casting belongs to the player: leaving the player ends it.
  useEffect(() => () => { if (isCasting(useCast.getState().status)) void useCast.getState().control({ type: 'stop' }); }, []);
  useEffect(() => { if (castId != null && itemId != null && castId !== itemId) void useCast.getState().control({ type: 'stop' }); }, [castId, itemId]);
  useEffect(() => { if (!enabled) useCast.getState().hide(); }, [enabled]);

  if (!open || !enabled || mode !== 'normal') return null;
  return createPortal(<CastSheet />, document.body);
}

function CastSheet() {
  const { devices, scanning, status } = useCast();
  const hide = useCast((c) => c.hide);
  const item = useVideoPlayer((s) => s.item);
  const audioIndex = useVideoPlayer((s) => s.audioIndex);
  const casting = isCasting(status);

  useEffect(() => {
    hotkeyCapture.active = true;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); hide(); } };
    document.addEventListener('keydown', key, true);
    return () => { hotkeyCapture.active = false; document.removeEventListener('keydown', key, true); };
  }, [hide]);

  useEffect(() => { if (status.state === 'error' && status.error) toast('error', status.error); }, [status.state, status.error]);

  const begin = async (id: string) => {
    const device = devices.find((d) => d.id === id);
    if (!device || !item) return;
    const startSec = videoEngine.currentTime;
    const player = useVideoPlayer.getState();
    if (player.playing) player.toggle();
    await useCast.getState().start(device, item.id, startSec, audioIndex);
  };

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) hide(); }}>
      <div className="sheet cast" role="dialog" aria-label="Cast to a device">
        <div className="cast__head">
          <h2 className="t-title-3">{casting ? 'Casting' : 'Cast to a device'}</h2>
          <IconButton icon={X} label="Close" onClick={hide} />
        </div>
        {casting ? <NowCasting /> : (
          <>
            <div className="cast__list" role="list" aria-label="Devices">
              {devices.map((d) => (
                <button key={d.id} type="button" role="listitem" className="cast__device" onClick={() => void begin(d.id)} disabled={!item || status.state === 'connecting'}>
                  <Icon as={d.protocol === 'chromecast' ? Cast : Tv} size={20} />
                  <span className="cast__device-text">
                    <span className="truncate" style={{ display: 'block' }}>{d.name}</span>
                    <span className="truncate secondary t-footnote" style={{ display: 'block' }}>{d.protocol === 'chromecast' ? 'Chromecast' : 'DLNA / UPnP'}{d.model ? ` · ${d.model}` : ''}</span>
                  </span>
                </button>
              ))}
              {devices.length === 0 && (
                <div className="cast__empty secondary">{scanning ? 'Looking for devices on your network…' : 'No devices found. Make sure the TV or Chromecast is on and on the same network as this computer.'}</div>
              )}
            </div>
            <div className="sheet__actions">
              <Button onClick={() => void useCast.getState().scan()} disabled={scanning}>{scanning ? <Spinner size={13} /> : <RefreshCw size={14} />} Scan Again</Button>
            </div>
          </>
        )}
        <p className="cast__note t-footnote secondary">
          Experimental. Casting is built from the DLNA and Chromecast protocols and tested against simulated devices; it has not been verified on real TVs or Chromecasts.
          The video is served to the chosen device only, for as long as the cast lasts.
        </p>
      </div>
    </div>
  );
}

function NowCasting() {
  const status = useCast((c) => c.status);
  const [drag, setDrag] = useState<number | null>(null);
  const playing = status.state === 'playing' || status.state === 'buffering' || status.state === 'connecting';
  const busy = status.state === 'connecting' || status.state === 'buffering';
  const shown = drag ?? status.positionSec;
  const duration = Math.max(status.durationSec, 1);
  const control = useCast.getState().control;
  return (
    <div className="cast__now">
      <div>
        <div className="truncate t-headline">{status.title}</div>
        <div className="truncate secondary t-footnote">{status.device?.name} · {STATE_LABEL[status.state]}</div>
      </div>
      <div className="secondary t-footnote">
        <span className="cast__badge">{status.mode === 'direct' ? 'Direct' : status.mode === 'remux' ? 'Repackaged' : 'Converted'}</span> {status.reason}
      </div>
      <div className="cast__transport">
        <button type="button" className="cast__play" aria-label={playing ? 'Pause' : 'Play'} disabled={busy && status.state === 'connecting'} onClick={() => void control({ type: playing ? 'pause' : 'play' })}>
          <Icon as={playing ? Pause : Play} size={20} fill="currentColor" strokeWidth={0} />
        </button>
        <input
          type="range" className="slider" min={0} max={duration} step={1} value={Math.min(shown, duration)} aria-label="Seek on device"
          style={{ '--p': `${(Math.min(shown, duration) / duration) * 100}%` } as React.CSSProperties}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={() => { if (drag != null) void control({ type: 'seek', sec: drag }); setDrag(null); }}
          onKeyUp={() => { if (drag != null) void control({ type: 'seek', sec: drag }); setDrag(null); }}
        />
        <span className="cast__time tabular secondary t-footnote">{formatDuration(shown)}</span>
      </div>
      {status.seekRestarts && <div className="secondary t-footnote">This file is being converted for the device, so a seek restarts the stream and takes a few seconds.</div>}
      <div className="sheet__actions">
        <Button onClick={() => void control({ type: 'stop' })}><Square size={13} fill="currentColor" strokeWidth={0} /> Stop Casting</Button>
      </div>
    </div>
  );
}
