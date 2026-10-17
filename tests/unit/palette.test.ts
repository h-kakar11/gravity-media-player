import { describe, expect, it } from 'vitest';
import { ACTIONS, effectiveKeymap, findConflicts } from '@shared/hotkeys';
import { fuzzyScore, rankEntries } from '@shared/palette';

describe('command palette ranking', () => {
  it('matches nothing when characters are missing', () => {
    expect(fuzzyScore('zq', 'Settings')).toBeNull();
  });

  it('keeps everything in order for an empty query', () => {
    const items = [{ label: 'B' }, { label: 'A' }];
    expect(rankEntries(items, '  ').map((i) => i.label)).toEqual(['B', 'A']);
  });

  it('ranks word-start substrings above mid-word and scattered matches', () => {
    const items = [{ label: 'Rescan Library' }, { label: 'Statistics' }, { label: 'Go to Stats' }, { label: 'Settings' }];
    const out = rankEntries(items, 'stat').map((i) => i.label);
    expect(out.slice(0, 2).sort()).toEqual(['Go to Stats', 'Statistics']);
    expect(out).not.toContain('Rescan Library');
  });

  it('prefers an exact label over a longer one', () => {
    const out = rankEntries([{ label: 'Mini Player Window' }, { label: 'Mini Player' }], 'mini player');
    expect(out[0]!.label).toBe('Mini Player');
  });

  it('matches keywords but ranks label hits first', () => {
    const items = [{ label: 'Settings', keywords: 'preferences options' }, { label: 'Preferences Guide' }];
    const out = rankEntries(items, 'prefer');
    expect(out.map((i) => i.label)).toEqual(['Preferences Guide', 'Settings']);
  });

  it('supports subsequence queries', () => {
    expect(rankEntries([{ label: 'Toggle Full Screen' }], 'tfs')).toHaveLength(1);
  });

  it('respects the limit', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ label: `Item ${i}` }));
    expect(rankEntries(items, 'item', 3)).toHaveLength(3);
  });
});

describe('palette hotkey', () => {
  it('is registered once and does not collide with another binding', () => {
    expect(ACTIONS.filter((a) => a.id === 'app.palette')).toHaveLength(1);
    expect(effectiveKeymap({})['app.palette']).toEqual(['mod+k']);
    expect(findConflicts(effectiveKeymap({}))).toEqual([]);
  });
});
