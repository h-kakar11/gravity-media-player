import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings } from '../../src/shared/settings';
import { welcomeDecision } from '../../src/shared/welcome';

describe('welcomeDecision', () => {
  it('waits for the folder list before deciding', () => {
    expect(welcomeDecision(false, false, 0)).toBe('hide');
  });
  it('greets an empty library once', () => {
    expect(welcomeDecision(false, true, 0)).toBe('show');
    expect(welcomeDecision(true, true, 0)).toBe('hide');
  });
  it('quietly retires itself for someone who already has folders', () => {
    expect(welcomeDecision(false, true, 3)).toBe('mark-done');
    expect(welcomeDecision(true, true, 3)).toBe('hide');
  });
  it('is not done by default and remembers being dismissed', () => {
    expect(DEFAULT_SETTINGS.welcome.done).toBe(false);
    expect(mergeSettings(structuredClone(DEFAULT_SETTINGS), { welcome: { done: true } }).welcome.done).toBe(true);
  });
});
