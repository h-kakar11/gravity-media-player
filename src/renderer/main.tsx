import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/base.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/views.css';
import './styles/player.css';
import './styles/readers.css';
import './styles/settings.css';
import './styles/stats.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Test hook: lets end-to-end tests drive the router without clicking through the UI.
import { navigate, useRouter } from './state/router';
(window as unknown as { __gravityNavigate: typeof navigate }).__gravityNavigate = navigate;
import { useVideoPlayer } from './lib/video-engine';
const w = window as unknown as Record<string, unknown>;
w.__playVideo = (item: import('@shared/types').MediaItem, startSec?: number) => useVideoPlayer.getState().play([item], 0, startSec != null ? { startSec } : undefined);
w.__videoApi = () => useVideoPlayer.getState();
w.__videoState = () => { const s = useVideoPlayer.getState(); return { phase: s.phase, mode: s.session?.mode, reason: s.session?.reason, offset: s.session?.offsetSec, time: s.time, duration: s.duration, speed: s.speed, audio: s.audioIndex, subs: s.subtitleTracks.length, cues: s.cues.length, sprite: !!s.sprite, err: s.error }; };
import { useMusic } from './lib/music-engine';
import { audioGraph } from './lib/audio-graph';
w.__music = () => useMusic.getState();
w.__audioGraph = () => audioGraph;
import { useReader } from './state/reader';
w.__reader = () => useReader.getState();
w.__route = () => useRouter.getState().route;
