/**
 * The "active transport" is whichever player (video or music) the user is currently controlling.
 * OS media keys, the Media Session API and the media.* hotkeys all talk to it, so the same Play/Pause
 * key works whether a film or an album is playing.
 */
export interface Transport {
  toggle(): void;
  play(): void;
  pause(): void;
  next(): void;
  previous(): void;
  seekTo(t: number): void;
  seekBy(d: number): void;
  stop(): void;
}

let active: Transport | null = null;

export const setTransport = (t: Transport | null) => { active = t; };
export const getTransport = () => active;

let installed = false;

export function installMediaSession(): void {
  if (installed || !('mediaSession' in navigator)) return;
  installed = true;
  const ms = navigator.mediaSession;
  const set = (a: MediaSessionAction, fn: MediaSessionActionHandler) => { try { ms.setActionHandler(a, fn); } catch { /* unsupported on this platform */ } };
  set('play', () => active?.play());
  set('pause', () => active?.pause());
  set('previoustrack', () => active?.previous());
  set('nexttrack', () => active?.next());
  set('seekto', (d) => { if (d.seekTime != null) active?.seekTo(d.seekTime); });
  set('seekbackward', (d) => active?.seekBy(-(d.seekOffset ?? 10)));
  set('seekforward', (d) => active?.seekBy(d.seekOffset ?? 10));
  set('stop', () => active?.stop());
}
