import type { GravityApi } from '../shared/ipc';

declare global {
  interface Window {
    gravity: GravityApi;
  }
}

export {};
