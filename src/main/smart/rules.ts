import {
  SMART_LIMITS, SMART_SORTS, isGroup, type NumberOp, type SmartDefinition, type SmartGroup, type SmartNode, type SmartRule, type SmartSort, type TextOp
} from '@shared/smart';

/**
 * Smart-playlist rules → SQL.
 *
 * Nothing the user typed ever reaches the SQL text: `parseDefinition` rebuilds the definition from a whitelist of
 * fields, operators and sorts (anything else is rejected), and `compile` emits fixed fragments with `?` placeholders
 * for every value. SQLite's `lower()` is ASCII-only, so text matching is case-insensitive for ASCII only.
 */

export class SmartRuleError extends Error {}

export type SqlParam = string | number;

export interface CompiledSmart {
  /** Boolean SQL expression over `m` (media) and `s` (state, LEFT JOINed). */
  where: string;
  params: SqlParam[];
  orderBy: string;
  limit: number | null;
}

const TEXT_OPS: readonly TextOp[] = ['is', 'isNot', 'contains'];
const NUMBER_OPS: readonly NumberOp[] = ['eq', 'lt', 'lte', 'gt', 'gte', 'between'];

const fail = (msg: string): never => { throw new SmartRuleError(msg); };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function int(v: unknown, label: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return fail(`${label} must be a whole number from ${min} to ${max}`);
  return v;
}

function text(v: unknown, label: string): string {
  if (typeof v !== 'string') return fail(`${label} must be text`);
  const t = v.trim();
  if (!t) return fail(`${label} cannot be empty`);
  if (t.length > SMART_LIMITS.text) return fail(`${label} is too long`);
  return t;
}

function bool(v: unknown, label: string): boolean {
  if (typeof v !== 'boolean') return fail(`${label} must be true or false`);
  return v;
}

function parseRule(n: Record<string, unknown>): SmartRule {
  const field = n.field;
  switch (field) {
    case 'genre':
    case 'artist': {
      if (!TEXT_OPS.includes(n.op as TextOp)) fail(`Unknown operator for ${field}`);
      return { field, op: n.op as TextOp, value: text(n.value, `The ${field}`) };
    }
    case 'year':
    case 'rating': {
      const [min, max] = field === 'year' ? [0, 9999] : [0, 5];
      if (!NUMBER_OPS.includes(n.op as NumberOp)) fail(`Unknown operator for ${field}`);
      const op = n.op as NumberOp;
      const value = int(n.value, `The ${field}`, min, max);
      if (op !== 'between') return { field, op, value };
      const value2 = int(n.value2, `The ${field} range end`, min, max);
      if (value2 < value) fail(`The ${field} range ends before it starts`);
      return { field, op, value, value2 };
    }
    case 'unplayed':
    case 'favorite':
      return { field, value: bool(n.value, field === 'unplayed' ? 'Unplayed' : 'Favourite') };
    case 'addedWithin':
      return { field, days: int(n.days, 'Days', 1, 36_500) };
    default:
      return fail('Unknown rule type');
  }
}

/** Validate untrusted input (IPC, stored JSON) and return a clean copy. Throws `SmartRuleError`. */
export function parseDefinition(input: unknown): SmartDefinition {
  if (!isObj(input)) return fail('Rules are missing');
  let rules = 0;
  const group = (g: unknown, depth: number): SmartGroup => {
    if (!isObj(g) || !Array.isArray(g.items)) return fail('A rule group is malformed');
    if (g.match !== 'all' && g.match !== 'any') return fail('A group must match "all" or "any"');
    if (depth > SMART_LIMITS.depth) return fail(`Groups are nested too deeply (limit ${SMART_LIMITS.depth})`);
    const items: SmartNode[] = g.items.map((n: unknown) => {
      if (!isObj(n)) return fail('A rule is malformed');
      if ('items' in n) return group(n, depth + 1);
      if (++rules > SMART_LIMITS.rules) return fail(`Too many rules (limit ${SMART_LIMITS.rules})`);
      return parseRule(n);
    });
    return { match: g.match, items };
  };
  const root = group(input.root, 1);
  if (rules === 0) fail('Add at least one rule');
  const sort = (input.sort ?? 'title') as SmartSort;
  if (!SMART_SORTS.includes(sort)) fail('Unknown sort order');
  const limit = input.limit == null ? null : int(input.limit, 'The limit', 1, SMART_LIMITS.limit);
  return { root, sort, desc: input.desc === true, limit };
}

// SQL fragments are constants; only `?` placeholders carry data.
const GENRE_TOKENS = `(';' || replace(replace(replace(replace(lower(COALESCE(m.genre, '')), ' / ', ';'), '/', ';'), ', ', ';'), '; ', ';') || ';')`;
const NEVER_PLAYED = `(COALESCE(s.play_count, 0) = 0 AND COALESCE(s.completed, 0) = 0 AND s.last_played_at IS NULL)`;

function textRule(r: Extract<SmartRule, { op: TextOp }>, params: SqlParam[]): string {
  const v = r.value;
  let sql: string;
  if (r.field === 'genre') {
    if (r.op === 'contains') { params.push(v); sql = `instr(lower(COALESCE(m.genre, '')), lower(?)) > 0`; }
    else { params.push(v, v); sql = `(lower(COALESCE(m.genre, '')) = lower(?) OR instr(${GENRE_TOKENS}, ';' || lower(?) || ';') > 0)`; }
  } else if (r.op === 'contains') {
    params.push(v, v);
    sql = `(instr(lower(COALESCE(m.artist, '')), lower(?)) > 0 OR instr(lower(COALESCE(m.album_artist, '')), lower(?)) > 0)`;
  } else {
    params.push(v, v);
    sql = `(lower(COALESCE(m.artist, '')) = lower(?) OR lower(COALESCE(m.album_artist, '')) = lower(?))`;
  }
  return r.op === 'isNot' ? `NOT ${sql}` : sql;
}

function numberRule(col: string, r: Extract<SmartRule, { op: NumberOp }>, params: SqlParam[]): string {
  switch (r.op) {
    case 'eq': params.push(r.value); return `${col} = ?`;
    case 'lt': params.push(r.value); return `${col} < ?`;
    case 'lte': params.push(r.value); return `${col} <= ?`;
    case 'gt': params.push(r.value); return `${col} > ?`;
    case 'gte': params.push(r.value); return `${col} >= ?`;
    case 'between': params.push(r.value, r.value2 ?? r.value); return `${col} BETWEEN ? AND ?`;
  }
}

function ruleSql(r: SmartRule, now: number, params: SqlParam[]): string {
  switch (r.field) {
    case 'genre':
    case 'artist': return textRule(r, params);
    // A NULL year never satisfies a year rule (it is "unknown", not "zero").
    case 'year': return `(m.year IS NOT NULL AND ${numberRule('m.year', r, params)})`;
    case 'rating': return `(${numberRule('COALESCE(s.rating, 0)', r, params)})`;
    case 'unplayed': return r.value ? NEVER_PLAYED : `NOT ${NEVER_PLAYED}`;
    case 'favorite': return r.value ? `COALESCE(s.favorite, 0) = 1` : `COALESCE(s.favorite, 0) = 0`;
    case 'addedWithin': params.push(now - r.days * 86_400_000); return `m.added_at >= ?`;
  }
}

function groupSql(g: SmartGroup, now: number, params: SqlParam[]): string {
  // An empty group is the identity of its connective (all → true, any → false); validation keeps whole playlists non-empty.
  if (g.items.length === 0) return g.match === 'all' ? '1' : '0';
  const parts = g.items.map((n) => (isGroup(n) ? groupSql(n, now, params) : ruleSql(n, now, params)));
  return `(${parts.join(g.match === 'all' ? ' AND ' : ' OR ')})`;
}

function orderSql(sort: SmartSort, desc: boolean): string {
  const dir = desc ? 'DESC' : 'ASC';
  switch (sort) {
    case 'added': return `m.added_at ${dir}, m.id`;
    case 'played': return `s.last_played_at ${dir} NULLS LAST, m.id`;
    case 'year': return `m.year ${dir} NULLS LAST, m.sort_title, m.id`;
    case 'rating': return `COALESCE(s.rating, 0) ${dir}, m.sort_title, m.id`;
    case 'random': return `random()`;
    default: return `m.sort_title COLLATE NOCASE ${dir}, m.id`;
  }
}

/** `def` must come from `parseDefinition`. */
export function compile(def: SmartDefinition, now: number): CompiledSmart {
  const params: SqlParam[] = [];
  const where = groupSql(def.root, now, params);
  return { where, params, orderBy: orderSql(def.sort, def.desc), limit: def.limit };
}
