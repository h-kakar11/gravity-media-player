import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';

type Level = 'debug' | 'info' | 'warn' | 'error';
let logFile: string | null = null;
const verbose = process.env.GRAVITY_DEBUG === '1' || !!process.env.GRAVITY_DEV_URL;

export function initLog(dir: string): void {
  logFile = join(dir, 'gravity.log');
}

function write(level: Level, scope: string, msg: unknown[]): void {
  const text = msg.map((m) => (m instanceof Error ? (m.stack ?? m.message) : typeof m === 'string' ? m : safeJson(m))).join(' ');
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${text}`;
  if (level !== 'debug' || verbose) (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
  if (logFile && level !== 'debug') appendFile(logFile, line + '\n').catch(() => {});
}

function safeJson(v: unknown): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}

export function logger(scope: string) {
  return {
    debug: (...m: unknown[]) => write('debug', scope, m),
    info: (...m: unknown[]) => write('info', scope, m),
    warn: (...m: unknown[]) => write('warn', scope, m),
    error: (...m: unknown[]) => write('error', scope, m)
  };
}
