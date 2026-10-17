import { create } from 'zustand';
import { IDLE_CAST, type CastCommand, type CastDevice, type CastStatus } from '@shared/cast';
import { invoke, on } from '../api';

interface CastStore {
  /** Whether the device sheet is showing. */
  open: boolean;
  devices: CastDevice[];
  scanning: boolean;
  status: CastStatus;
  show: () => void;
  hide: () => void;
  scan: () => Promise<void>;
  start: (device: CastDevice, mediaId: number, startSec: number, audioIndex: number) => Promise<void>;
  control: (cmd: CastCommand) => Promise<void>;
  /** Subscribe to status pushes from the main process. Returns the unsubscribe function. */
  listen: () => () => void;
}

export const isCasting = (s: CastStatus) => s.state !== 'idle' && s.state !== 'error';

export const useCast = create<CastStore>((set, get) => ({
  open: false,
  devices: [],
  scanning: false,
  status: IDLE_CAST,
  show: () => { set({ open: true }); if (!isCasting(get().status)) void get().scan(); },
  hide: () => set({ open: false }),
  async scan() {
    set({ scanning: true });
    try { set({ devices: await invoke('cast:discover') }); } catch (err) { set({ status: { ...IDLE_CAST, state: 'error', error: (err as Error).message } }); }
    set({ scanning: false });
  },
  async start(device, mediaId, startSec, audioIndex) {
    set({ status: { ...IDLE_CAST, state: 'connecting', device } });
    try { set({ status: await invoke('cast:start', device.id, mediaId, startSec, audioIndex) }); } catch { /* the error status arrives as an event */ }
  },
  async control(cmd) {
    try { set({ status: await invoke('cast:control', cmd) }); } catch { /* the error status arrives as an event */ }
  },
  listen() {
    void invoke('cast:status').then((status) => set({ status })).catch(() => {});
    return on('cast:status', (status) => set({ status }));
  }
}));
