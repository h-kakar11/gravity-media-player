import { SMART_LIMITS, type SmartDefinition, type SmartPlaylist, type SmartPreview } from '@shared/smart';
import type { PlaylistEntry } from '@shared/types';
import type { Db } from '../db/database';
import { mapMedia } from '../db/repo';
import { compile, parseDefinition, SmartRuleError } from './rules';

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : 0);

/** Only playable kinds, only files that are present. */
const BASE = `FROM media m LEFT JOIN state s ON s.media_id = m.id WHERE m.missing = 0 AND m.kind IN ('video', 'audio')`;
const SELECT_ITEM = `SELECT m.*, s.favorite AS s_fav, s.rating AS s_rating, s.play_count AS s_plays, s.last_played_at AS s_last,
  s.position AS s_pos, s.progress AS s_prog, s.completed AS s_done, s.notes AS s_notes, s.location AS s_loc`;

function cleanName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) throw new SmartRuleError('Give the smart playlist a name');
  const n = name.trim();
  if (n.length > SMART_LIMITS.name) throw new SmartRuleError('That name is too long');
  return n;
}

/**
 * Smart playlists are stored as rules only; membership is computed from the library every time it is asked for, so
 * it follows ratings, plays and new files without any bookkeeping.
 */
export class SmartPlaylistService {
  constructor(private readonly db: Db, private readonly clock: () => number = Date.now) {}

  list(): SmartPlaylist[] {
    return this.db.all<Row>('SELECT * FROM smart_playlists ORDER BY name COLLATE NOCASE, id').map((r) => this.map(r));
  }

  get(id: number): SmartPlaylist {
    const r = this.db.get<Row>('SELECT * FROM smart_playlists WHERE id = ?', [id]);
    if (!r) throw new SmartRuleError('That smart playlist no longer exists');
    return this.map(r);
  }

  create(name: string, definition: unknown, description = ''): SmartPlaylist {
    const n = cleanName(name);
    const def = parseDefinition(definition);
    const now = this.clock();
    const { lastId } = this.db.run(
      'INSERT INTO smart_playlists (name, description, definition, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [n, String(description).slice(0, 2000), JSON.stringify(def), now, now]
    );
    return this.get(lastId);
  }

  update(id: number, patch: { name?: string; description?: string; definition?: unknown }): SmartPlaylist {
    this.get(id);
    const sets: string[] = [];
    const params: (string | number)[] = [];
    if (patch.name !== undefined) { sets.push('name = ?'); params.push(cleanName(patch.name)); }
    if (patch.description !== undefined) { sets.push('description = ?'); params.push(String(patch.description).slice(0, 2000)); }
    if (patch.definition !== undefined) { sets.push('definition = ?'); params.push(JSON.stringify(parseDefinition(patch.definition))); }
    if (sets.length) this.db.run(`UPDATE smart_playlists SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, this.clock(), id]);
    return this.get(id);
  }

  delete(id: number): void {
    this.db.run('DELETE FROM smart_playlists WHERE id = ?', [id]);
  }

  /** Current members, in the playlist's own order. A playlist whose stored rules are unreadable has no members. */
  items(id: number): PlaylistEntry[] {
    const r = this.db.get<Row>('SELECT definition FROM smart_playlists WHERE id = ?', [id]);
    if (!r) throw new SmartRuleError('That smart playlist no longer exists');
    const def = this.read(r.definition);
    if (!def.def) return [];
    return this.run(def.def, 5_000).map((m, i) => ({ entryId: m.id, position: i, item: m }));
  }

  /** Evaluate unsaved rules for the editor: total count/duration plus the first few matches. */
  preview(definition: unknown, sample = 12): SmartPreview {
    const def = parseDefinition(definition);
    const c = compile(def, this.clock());
    const total = this.db.get<Row>(`SELECT COUNT(*) AS n, COALESCE(SUM(m.duration), 0) AS dur FROM (SELECT m.id, m.duration ${BASE} AND ${c.where} ${c.limit ? `ORDER BY ${c.orderBy} LIMIT ${Math.trunc(c.limit)}` : ''}) m`, c.params);
    return { count: num(total?.n), durationSec: num(total?.dur), items: this.run(def, Math.min(sample, 50)) };
  }

  private read(raw: unknown): { def: SmartDefinition | null; error: string | null } {
    try { return { def: parseDefinition(JSON.parse(String(raw))), error: null }; }
    catch (err) { return { def: null, error: err instanceof Error ? err.message : 'The rules could not be read' }; }
  }

  private run(def: SmartDefinition, cap: number) {
    const c = compile(def, this.clock());
    const limit = Math.min(c.limit ?? cap, cap);
    return this.db.all<Row>(`${SELECT_ITEM} ${BASE} AND ${c.where} ORDER BY ${c.orderBy} LIMIT ${Math.trunc(limit)}`, c.params).map(mapMedia);
  }

  private map(r: Row): SmartPlaylist {
    const id = num(r.id);
    const { def, error } = this.read(r.definition);
    let count = 0;
    let dur = 0;
    let art: number[] = [];
    if (def) {
      try {
        const c = compile(def, this.clock());
        const lim = c.limit ? ` ORDER BY ${c.orderBy} LIMIT ${Math.trunc(c.limit)}` : '';
        const t = this.db.get<Row>(`SELECT COUNT(*) AS n, COALESCE(SUM(m.duration), 0) AS dur FROM (SELECT m.id, m.duration ${BASE} AND ${c.where}${lim}) m`, c.params);
        count = num(t?.n);
        dur = num(t?.dur);
        art = this.db.all<Row>(`SELECT m.id ${BASE} AND ${c.where} AND m.art_src IS NOT NULL ORDER BY ${c.orderBy} LIMIT 4`, c.params).map((x) => num(x.id));
      } catch { /* a bad row must not break the sidebar */ }
    }
    return {
      id, name: String(r.name), description: String(r.description ?? ''),
      definition: def ?? { root: { match: 'all', items: [] }, sort: 'title', desc: false, limit: null },
      itemCount: count, durationSec: dur, createdAt: num(r.created_at), updatedAt: num(r.updated_at), artMediaIds: art, error
    };
  }
}
