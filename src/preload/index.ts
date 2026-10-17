import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { GravityApi, IpcEventName } from '../shared/ipc';

/**
 * The only bridge between the sandboxed renderer and the main process. It exposes a typed
 * invoke/on pair and nothing else — no Node, no fs, no arbitrary IPC.
 */
const api: GravityApi = {
  invoke: async (channel, ...args) => {
    try {
      return await ipcRenderer.invoke(`gravity:${channel}`, ...args);
    } catch (err) {
      // Electron prefixes errors with "Error invoking remote method …": keep only the message.
      const msg = (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      throw new Error(msg);
    }
  },
  on: (event: IpcEventName, listener) => {
    const channel = `gravity:event:${event}`;
    const wrapped = (_e: unknown, payload: Parameters<typeof listener>[0]) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return ''; }
  },
  platform: process.platform as GravityApi['platform']
};

contextBridge.exposeInMainWorld('gravity', api);
