import { describe, expect, it } from 'vitest';
import { emptyDefinition, type SmartDefinition, type SmartRule } from '@shared/smart';
import { compile, parseDefinition, SmartRuleError } from '../../src/main/smart/rules';

const def = (items: unknown[], match: 'all' | 'any' = 'all', extra: Record<string, unknown> = {}) => ({ ...emptyDefinition(), root: { match, items }, ...extra }) as SmartDefinition;
const one = (rule: SmartRule) => def([rule]);

describe('parseDefinition', () => {
  it('accepts every rule type and returns a clean copy', () => {
    const input = def([
      { field: 'genre', op: 'is', value: ' Rock ', junk: 1 },
      { field: 'artist', op: 'contains', value: 'abba' },
      { field: 'year', op: 'between', value: 1990, value2: 1999 },
      { field: 'rating', op: 'gte', value: 4 },
      { field: 'unplayed', value: true },
      { field: 'addedWithin', days: 30 },
      { field: 'favorite', value: false },
      { match: 'any', items: [{ field: 'year', op: 'lt', value: 1970 }] }
    ]);
    const out = parseDefinition(input);
    expect(out.root.items).toHaveLength(8);
    expect(out.root.items[0]).toEqual({ field: 'genre', op: 'is', value: 'Rock' });
  });

  it.each([
    ['unknown field', def([{ field: 'path', op: 'is', value: 'x' }])],
    ['unknown text op', def([{ field: 'genre', op: 'LIKE', value: 'x' }])],
    ['unknown number op', def([{ field: 'year', op: '=1; DROP TABLE media', value: 1 }])],
    ['empty text', def([{ field: 'genre', op: 'is', value: '   ' }])],
    ['non-string text', def([{ field: 'genre', op: 'is', value: 5 }])],
    ['fractional year', def([{ field: 'year', op: 'eq', value: 1999.5 }])],
    ['NaN year', def([{ field: 'year', op: 'eq', value: Number.NaN }])],
    ['string year', def([{ field: 'year', op: 'eq', value: '1999 OR 1=1' }])],
    ['rating above 5', def([{ field: 'rating', op: 'eq', value: 6 }])],
    ['negative rating', def([{ field: 'rating', op: 'gt', value: -1 }])],
    ['between without end', def([{ field: 'year', op: 'between', value: 1990 }])],
    ['reversed range', def([{ field: 'year', op: 'between', value: 2000, value2: 1990 }])],
    ['zero days', def([{ field: 'addedWithin', days: 0 }])],
    ['string flag', def([{ field: 'favorite', value: 'yes' }])],
    ['no rules', def([])],
    ['only empty groups', def([{ match: 'all', items: [] }])],
    ['bad connective', def([{ field: 'favorite', value: true }], 'xor' as 'all')],
    ['unknown sort', def([{ field: 'favorite', value: true }], 'all', { sort: 'title; DROP' })],
    ['zero limit', def([{ field: 'favorite', value: true }], 'all', { limit: 0 })],
    ['huge limit', def([{ field: 'favorite', value: true }], 'all', { limit: 1e9 })],
    ['not an object', 'rules'],
    ['null', null],
    ['array rule', def([[]])]
  ])('rejects %s', (_label, input) => {
    expect(() => parseDefinition(input)).toThrow(SmartRuleError);
  });

  it('limits nesting depth and rule count', () => {
    let g: unknown = { match: 'all', items: [{ field: 'favorite', value: true }] };
    for (let i = 0; i < 8; i++) g = { match: 'all', items: [g] };
    expect(() => parseDefinition({ ...emptyDefinition(), root: g })).toThrow(/nested too deeply/);
    const many = Array.from({ length: 61 }, () => ({ field: 'favorite', value: true }));
    expect(() => parseDefinition(def(many))).toThrow(/Too many rules/);
  });

  it('allows an empty nested group alongside real rules', () => {
    expect(() => parseDefinition(def([{ field: 'favorite', value: true }, { match: 'any', items: [] }]))).not.toThrow();
  });
});

describe('compile', () => {
  const c = (d: SmartDefinition, now = 1_000_000_000) => compile(parseDefinition(d), now);

  it('uses placeholders for every value and keeps user text out of the SQL', () => {
    const evil = "x'; DROP TABLE media; --";
    const out = c(def([{ field: 'genre', op: 'is', value: evil }, { field: 'artist', op: 'contains', value: evil }]));
    expect(out.where).not.toContain('DROP');
    expect(out.where).not.toContain(evil);
    expect(out.params.filter((p) => p === evil)).toHaveLength(4);
    expect((out.where.match(/\?/g) ?? []).length).toBe(out.params.length);
  });

  it('joins rules with the group connective and nests groups with parentheses', () => {
    const all = c(def([{ field: 'favorite', value: true }, { field: 'unplayed', value: true }], 'all')).where;
    expect(all).toMatch(/ AND /);
    expect(all).not.toMatch(/ OR /);
    const nested = c(def([{ field: 'favorite', value: true }, { match: 'any', items: [{ field: 'year', op: 'lt', value: 1980 }, { field: 'rating', op: 'gte', value: 5 }] }])).where;
    expect(nested).toMatch(/^\(.* AND \(.* OR .*\)\)$/);
  });

  it('turns "added within N days" into an absolute cutoff', () => {
    const now = 100 * 86_400_000;
    expect(c(one({ field: 'addedWithin', days: 10 }), now).params).toEqual([90 * 86_400_000]);
  });

  it('orders by whitelisted expressions and passes the limit through', () => {
    expect(c(def([{ field: 'favorite', value: true }], 'all', { sort: 'rating', desc: true, limit: 25 }))).toMatchObject({ limit: 25, orderBy: expect.stringContaining('rating') });
    expect(c(def([{ field: 'favorite', value: true }], 'all', { sort: 'added' })).orderBy).toContain('added_at ASC');
  });

  it('keeps number rules bound as numbers', () => {
    expect(c(one({ field: 'year', op: 'between', value: 1990, value2: 1999 })).params).toEqual([1990, 1999]);
  });
});
