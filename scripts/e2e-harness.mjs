// Shared helpers for launching the built app under Playwright (used by e2e tests and screenshot scripts).
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);

export async function launchApp({ userData, args = [], env = {}, size = [1360, 860] } = {}) {
  const root = resolve(new URL('..', import.meta.url).pathname);
  const dataDir = userData ?? mkdtempSync(join(tmpdir(), 'gravity-e2e-'));
  mkdirSync(dataDir, { recursive: true });
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root, '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', ...args],
    env: { ...process.env, GRAVITY_TEST: '1', GRAVITY_USER_DATA: dataDir, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', ...env },
    timeout: 60_000
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows()[0]; win.setSize(w, h); win.center(); }, size);
  await page.waitForSelector('.app', { timeout: 30_000 });
  return { app, page, dataDir, errors };
}

/** Call a main-process IPC channel from the renderer. */
export const invoke = (page, channel, ...args) => page.evaluate(([c, a]) => window.gravity.invoke(c, ...a), [channel, args]);

/** Add a library folder and wait for the first scan to settle. */
export async function addLibrary(page, path, type = 'auto') {
  await invoke(page, 'roots:add', path, type);
  await waitForScan(page);
}

export async function waitForScan(page, quietMs = 800, timeout = 60_000) {
  const start = Date.now();
  await page.waitForTimeout(400);
  let stable = 0;
  let last = -1;
  while (Date.now() - start < timeout) {
    const roots = await invoke(page, 'roots:list');
    const count = roots.reduce((a, r) => a + r.itemCount, 0);
    const scanning = roots.some((r) => r.scanning);
    if (!scanning && count === last && count > 0) { stable += 200; if (stable >= quietMs) return count; } else stable = 0;
    last = count;
    await page.waitForTimeout(200);
  }
  throw new Error('Library scan did not settle');
}

export const go = async (page, route) => {
  await page.evaluate((r) => window.__gravityNavigate?.(r), route);
  await page.waitForTimeout(450);
};
