import type { ElectronApplication, Page } from 'playwright-core';

export interface LaunchOptions { userData?: string; args?: string[]; env?: Record<string, string>; size?: [number, number] }
export interface Launched { app: ElectronApplication; page: Page; dataDir: string; errors: string[] }

export function launchApp(opts?: LaunchOptions): Promise<Launched>;
export function invoke<T = unknown>(page: Page, channel: string, ...args: unknown[]): Promise<T>;
export function addLibrary(page: Page, path: string, type?: string): Promise<number>;
export function waitForScan(page: Page, quietMs?: number, timeout?: number): Promise<number>;
export function go(page: Page, route: unknown): Promise<void>;
