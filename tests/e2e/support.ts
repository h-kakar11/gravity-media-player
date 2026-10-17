import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ElectronApplication, Page } from 'playwright-core';
import type { MediaItem, MediaKind } from '../../src/shared/types';
import { addLibrary, go, invoke as rawInvoke, launchApp } from '../../scripts/e2e-harness.mjs';

type Truthy<T> = Exclude<T, false | 0 | '' | null | undefined>;

export interface TestApp {
  app: ElectronApplication;
  page: Page;
  errors: string[];
  mediaDir: string;
  dataDir: string;
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>;
  go: (route: unknown) => Promise<void>;
  items: (kind?: MediaKind) => Promise<MediaItem[]>;
  find: (title: string, kind?: MediaKind) => Promise<MediaItem>;
  /** Re-run `fn` until it returns a truthy value (or throw after `timeout`). */
  waitFor: <T>(fn: () => Promise<T> | T, opts?: { timeout?: number; interval?: number; message?: string }) => Promise<Truthy<T>>;
  close: () => Promise<void>;
}

export interface StartOptions {
  /** Copy the sample library to a scratch folder and add it (default true). */
  library?: boolean;
  scheme?: 'light' | 'dark';
  size?: [number, number];
}

/** Launches the built app with an isolated profile and (optionally) its own copy of the sample media. */
export async function startApp(opts: StartOptions = {}): Promise<TestApp> {
  const { app, page, errors, dataDir } = await launchApp({ size: opts.size ?? [1360, 880] });
  await page.emulateMedia({ colorScheme: opts.scheme ?? 'dark' });
  let mediaDir = '';
  if (opts.library !== false) {
    const scratch = mkdtempSync(join(tmpdir(), 'gravity-e2e-media-'));
    mediaDir = join(scratch, 'media');
    cpSync(resolve(process.env.GRAVITY_E2E_MEDIA ?? '.e2e/media-src'), mediaDir, { recursive: true });
    await addLibrary(page, mediaDir);
  }
  const invoke = <T = unknown>(channel: string, ...args: unknown[]) => rawInvoke<T>(page, channel, ...args);
  const items = async (kind?: MediaKind) => (await invoke<{ items: MediaItem[] }>('library:query', kind ? { kind } : {})).items;
  const waitFor: TestApp['waitFor'] = async (fn, o = {}) => {
    const end = Date.now() + (o.timeout ?? 20_000);
    let last: unknown;
    while (Date.now() < end) {
      try { const v = await fn(); if (v) return v as never; } catch (err) { last = err; }
      await page.waitForTimeout(o.interval ?? 250);
    }
    throw new Error(`${o.message ?? 'Condition'} not met in time${last ? `: ${(last as Error).message}` : ''}`);
  };
  return {
    app, page, errors, mediaDir, dataDir, invoke, items, waitFor,
    go: (route) => go(page, route),
    find: async (title, kind) => {
      const hit = (await items(kind)).find((m) => m.title.includes(title));
      if (!hit) throw new Error(`No library item titled “${title}”`);
      return hit;
    },
    close: async () => {
      await app.close().catch(() => undefined);
      if (mediaDir) rmSync(resolve(mediaDir, '..'), { recursive: true, force: true });
    }
  };
}

/** Renderer errors that are expected noise in a headless test environment. */
export const IGNORED_ERRORS = [/Autofocus processing was blocked/, /ResizeObserver loop/];
export const realErrors = (errors: string[]) => errors.filter((e) => !IGNORED_ERRORS.some((re) => re.test(e)));
