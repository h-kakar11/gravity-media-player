import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { clampSettings, DEFAULT_SETTINGS, mergeSettings, type Settings } from '@shared/settings';
import type { DeepPartial } from '@shared/ipc';
import { logger } from './log';

const log = logger('settings');

/**
 * JSON-file backed settings. Reads are synchronous (it is a small file read once at startup);
 * writes are debounced and atomic (temp file + rename) so a crash can't corrupt the config.
 */
export class SettingsStore extends EventEmitter {
  private current: Settings;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string) {
    super();
    this.current = this.load();
  }

  private load(): Settings {
    const base = structuredClone(DEFAULT_SETTINGS);
    if (!existsSync(this.file)) return base;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      return clampSettings(mergeSettings(base, raw));
    } catch (err) {
      log.warn('Could not read settings, using defaults:', err);
      try { renameSync(this.file, `${this.file}.corrupt-${Date.now()}`); } catch { /* ignore */ }
      return base;
    }
  }

  get(): Settings {
    return this.current;
  }

  set(patch: DeepPartial<Settings>): Settings {
    // Replace-style keys: arrays and free-form records come from the patch wholesale.
    this.current = clampSettings(mergeSettings(structuredClone(this.current), patch));
    this.scheduleSave();
    this.emit('changed', this.current);
    return this.current;
  }

  replace(next: Settings): Settings {
    this.current = clampSettings(mergeSettings(structuredClone(DEFAULT_SETTINGS), next));
    this.scheduleSave();
    this.emit('changed', this.current);
    return this.current;
  }

  reset(): Settings {
    return this.replace(structuredClone(DEFAULT_SETTINGS));
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.current, null, 2));
      renameSync(tmp, this.file);
    } catch (err) {
      log.error('Failed to save settings', err);
    }
  }
}
