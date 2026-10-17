import type { GravityApi, IpcArgs, IpcChannel, IpcEventName, IpcEvents, IpcResult } from '@shared/ipc';

declare global {
  interface Window {
    gravity: GravityApi;
  }
}

/** Typed call into the main process. */
export function invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>> {
  return window.gravity.invoke(channel, ...args);
}

export function on<E extends IpcEventName>(event: E, listener: (payload: IpcEvents[E]) => void): () => void {
  return window.gravity.on(event, listener);
}

export const platform = window.gravity.platform;
export const isMac = platform === 'darwin';
export const pathForFile = (f: File) => window.gravity.pathForFile(f);

/** Fire-and-forget helper for background writes where failure must not interrupt the user. */
export function quiet<T>(p: Promise<T>): void {
  p.catch((err) => console.warn(err));
}
