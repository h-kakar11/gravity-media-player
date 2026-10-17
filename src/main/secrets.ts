import type { Settings } from '@shared/settings';

/**
 * Credentials kept in settings.json. They are blanked in exported settings and are never taken from an
 * imported file, so sharing or restoring a settings file cannot leak or overwrite them. New credentials
 * go in this list and nowhere else.
 */
export const SECRET_PATHS: readonly (readonly [keyof Settings, string])[] = [
  ['metadata', 'tmdbKey'],
  ['metadata', 'openSubtitlesKey'],
  ['metadata', 'openSubtitlesUser'],
  ['metadata', 'openSubtitlesPass']
];

type Bag = Record<string, Record<string, unknown> | undefined>;

export function redactSecrets(settings: Settings): Settings {
  const out = structuredClone(settings) as unknown as Bag;
  for (const [group, key] of SECRET_PATHS) if (out[group]) out[group]![key] = '';
  return out as unknown as Settings;
}

/** Copy the local credentials over whatever an imported file contained. */
export function restoreSecrets(imported: Settings, local: Settings): Settings {
  const next = imported as unknown as Bag;
  const mine = local as unknown as Bag;
  for (const [group, key] of SECRET_PATHS) if (next[group]) next[group]![key] = mine[group]?.[key] ?? '';
  return imported;
}
