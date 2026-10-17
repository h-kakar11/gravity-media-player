import { describe, expect, it } from 'vitest';
import { buildSpreads, spreadIndexOf } from '@shared/spreads';

describe('buildSpreads', () => {
  const none = () => false;
  it('pairs pages after a lone cover', () => {
    expect(buildSpreads(6, none, true)).toEqual([[0], [1, 2], [3, 4], [5]]);
  });
  it('pairs from the first page when the cover is not special', () => {
    expect(buildSpreads(5, none, false)).toEqual([[0, 1], [2, 3], [4]]);
  });
  it('shows landscape pages alone and re-pairs after them', () => {
    const wide = new Set([3]);
    expect(buildSpreads(8, (i) => wide.has(i), true)).toEqual([[0], [1, 2], [3], [4, 5], [6, 7]]);
  });
  it('does not pair a page with a following landscape page', () => {
    const wide = new Set([2]);
    expect(buildSpreads(4, (i) => wide.has(i), false)).toEqual([[0, 1], [2], [3]]);
  });
  it('finds the spread containing a page', () => {
    const s = buildSpreads(6, none, true);
    expect(spreadIndexOf(s, 0)).toBe(0);
    expect(spreadIndexOf(s, 2)).toBe(1);
    expect(spreadIndexOf(s, 5)).toBe(3);
    expect(spreadIndexOf(s, 99)).toBe(0);
  });
});
