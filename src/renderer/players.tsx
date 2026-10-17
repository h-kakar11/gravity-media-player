import { useEffect } from 'react';
import { MiniMusic } from './music/MiniMusic';
import { MusicBar } from './music/MusicBar';
import { NowPlaying } from './music/NowPlaying';
import { VideoPlayerHost } from './player/VideoPlayer';
import { ReaderHost } from './readers';
import { registerHandlers } from './lib/hotkeys';
import { getTransport } from './lib/transport';
import { useMusic } from './lib/music-engine';
import { useApp } from './state/app';
import { useSettings } from './state/settings';
import { useVideo } from './state/video';

/**
 * Everything that plays or floats above the library: the full-window video player, the music bar,
 * the Now Playing sheet and the compact mini-player layout. Transport hotkeys are routed here so the
 * same keys control music when no video is open.
 */
export function Players() {
  const videoOpen = useVideo((s) => s.open);
  const mode = useApp((s) => s.win.mode);
  const hasMusic = useMusic((s) => s.queue.length > 0);

  useEffect(() => registerHandlers({
    'media.playPause': () => { const t = getTransport(); if (!t) { if (useMusic.getState().queue.length) { useMusic.getState().toggle(); return; } return false; } t.toggle(); },
    'media.next': () => { if (!useMusic.getState().queue.length) return false; useMusic.getState().next(); },
    'media.previous': () => { if (!useMusic.getState().queue.length) return false; useMusic.getState().previous(); },
    'media.seekBack': () => { if (!useMusic.getState().queue.length) return false; useMusic.getState().seekBy(-useSettings.getState().settings.playback.skipBackSec); },
    'media.seekForward': () => { if (!useMusic.getState().queue.length) return false; useMusic.getState().seekBy(useSettings.getState().settings.playback.skipForwardSec); },
    'media.volumeUp': () => { useMusic.getState().setVolume(useSettings.getState().settings.audio.volume + 0.05); },
    'media.volumeDown': () => { useMusic.getState().setVolume(useSettings.getState().settings.audio.volume - 0.05); },
    'media.mute': () => { useMusic.getState().toggleMute(); },
    'media.stop': () => { if (!useMusic.getState().queue.length) return false; useMusic.getState().stop(); },
    'music.shuffle': () => { useMusic.getState().setShuffle(!useMusic.getState().shuffle); },
    'music.repeat': () => { useMusic.getState().cycleRepeat(); },
    'music.nowPlaying': () => { const m = useMusic.getState(); if (m.queue.length) { if (m.nowPlayingOpen) m.closeNowPlaying(); else m.openNowPlaying(); } else return false; },
    'music.lyrics': () => { const m = useMusic.getState(); if (m.queue.length) m.openNowPlaying('lyrics'); else return false; },
    'music.queue': () => { const m = useMusic.getState(); if (m.queue.length) m.openNowPlaying('queue'); else return false; },
    'music.like': () => {
      const it = useMusic.getState().queue[useMusic.getState().index];
      if (!it) return false;
      void import('./lib/actions').then((a) => a.toggleFavorite(it));
    }
  }), []);

  // In mini/overlay mode the library shell is hidden; only the player layout remains.
  useEffect(() => {
    document.documentElement.dataset.windowMode = mode;
  }, [mode]);

  return (
    <>
      <VideoPlayerHost />
      <ReaderHost />
      {mode === 'normal' && <><MusicBar /><NowPlaying /></>}
      {mode === 'mini' && !videoOpen && hasMusic && <MiniMusic />}
    </>
  );
}
