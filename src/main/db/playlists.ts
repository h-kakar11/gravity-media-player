import type { MediaItem, Playlist, PlaylistEntry } from '@shared/types';
import { Db } from './database';
import { mapMedia } from './repo';

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : 0);

const SELECT_ITEM = `
  SELECT m.*, s.favorite AS s_fav, s.rating AS s_rating, s.play_count AS s_plays, s.last_played_at AS s_last,
         s.position AS s_pos, s.progress AS s_prog, s.completed AS s_done, s.notes AS s_notes, s.location AS s_loc,
         pi.id AS entry_id, pi.position AS entry_pos
  FROM playlist_items pi JOIN media m ON m.id = pi.media_id LEFT JOIN state s ON s.media_id = m.id`;

export class PlaylistRepo {
  constructor(private readonly db: Db) {}

  list(): Playlist[] {
    const rows = this.db.all<Row>(
      `SELECT p.*, COUNT(m.id) AS n, COALESCE(SUM(m.duration), 0) AS dur
       FROM playlists p LEFT JOIN playlist_items pi ON pi.playlist_id = p.id LEFT JOIN media m ON m.id = pi.media_id AND m.missing = 0
       GROUP BY p.id ORDER BY p.name COLLATE NOCASE`
    );
    return rows.map((r) => this.map(r));
  }

  private map(r: Row): Playlist {
    const id = num(r.id);
    const art = this.db
      .all<Row>(
        `SELECT m.id FROM playlist_items pi JOIN media m ON m.id = pi.media_id
         WHERE pi.playlist_id = ? AND m.art_src IS NOT NULL AND m.missing = 0 ORDER BY pi.position LIMIT 4`,
        [id]
      )
      .map((x) => num(x.id));
    return {
      id, name: String(r.name), description: String(r.description ?? ''), itemCount: num(r.n), durationSec: num(r.dur),
      createdAt: num(r.created_at), updatedAt: num(r.updated_at), artMediaIds: art
    };
  }

  get(id: number): Playlist {
    const r = this.db.get<Row>(
      `SELECT p.*, COUNT(m.id) AS n, COALESCE(SUM(m.duration), 0) AS dur
       FROM playlists p LEFT JOIN playlist_items pi ON pi.playlist_id = p.id LEFT JOIN media m ON m.id = pi.media_id AND m.missing = 0
       WHERE p.id = ? GROUP BY p.id`,
      [id]
    );
    if (!r) throw new Error('Playlist not found');
    return this.map(r);
  }

  create(name: string, mediaIds: number[] = []): Playlist {
    const now = Date.now();
    const clean = name.trim().slice(0, 120) || 'New Playlist';
    const id = this.db.tx(() => {
      const pid = this.db.run('INSERT INTO playlists (name, created_at, updated_at) VALUES (?, ?, ?)', [clean, now, now]).lastId;
      this.append(pid, mediaIds);
      return pid;
    });
    return this.get(id);
  }

  update(id: number, patch: { name?: string; description?: string }): Playlist {
    if (patch.name !== undefined) this.db.run('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?', [patch.name.trim().slice(0, 120) || 'Playlist', Date.now(), id]);
    if (patch.description !== undefined) this.db.run('UPDATE playlists SET description = ?, updated_at = ? WHERE id = ?', [patch.description.slice(0, 2000), Date.now(), id]);
    return this.get(id);
  }

  delete(id: number): void {
    this.db.run('DELETE FROM playlists WHERE id = ?', [id]);
  }

  items(id: number): PlaylistEntry[] {
    return this.db.all<Row>(`${SELECT_ITEM} WHERE pi.playlist_id = ? ORDER BY pi.position, pi.id`, [id]).map((r) => ({
      entryId: num(r.entry_id), position: num(r.entry_pos), item: mapMedia(r) as MediaItem
    }));
  }

  private append(id: number, mediaIds: number[]): void {
    if (mediaIds.length === 0) return;
    const maxPos = num(this.db.get<Row>('SELECT COALESCE(MAX(position), -1) AS p FROM playlist_items WHERE playlist_id = ?', [id])?.p);
    let pos = maxPos + 1;
    const now = Date.now();
    for (const mid of mediaIds) {
      this.db.run('INSERT INTO playlist_items (playlist_id, media_id, position, added_at) VALUES (?, ?, ?, ?)', [id, mid, pos++, now]);
    }
  }

  add(id: number, mediaIds: number[]): Playlist {
    this.db.tx(() => {
      this.append(id, mediaIds);
      this.db.run('UPDATE playlists SET updated_at = ? WHERE id = ?', [Date.now(), id]);
    });
    return this.get(id);
  }

  remove(id: number, entryIds: number[]): void {
    this.db.tx(() => {
      for (const e of entryIds) this.db.run('DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?', [e, id]);
      this.renumber(id);
    });
  }

  reorder(id: number, entryIds: number[]): void {
    this.db.tx(() => {
      entryIds.forEach((e, i) => this.db.run('UPDATE playlist_items SET position = ? WHERE id = ? AND playlist_id = ?', [i, e, id]));
      this.renumber(id);
    });
  }

  private renumber(id: number): void {
    const rows = this.db.all<Row>('SELECT id FROM playlist_items WHERE playlist_id = ? ORDER BY position, id', [id]);
    rows.forEach((r, i) => this.db.run('UPDATE playlist_items SET position = ? WHERE id = ?', [i, num(r.id)]));
    this.db.run('UPDATE playlists SET updated_at = ? WHERE id = ?', [Date.now(), id]);
  }
}
