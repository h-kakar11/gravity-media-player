import { describe, expect, it } from 'vitest';
import { compareUpNext, planShow, type EpisodeRow } from '../../src/main/watch/upnext';

let id = 0;
/** One episode file. `state` is how far the viewer got; `last` is when they last played it. */
function ep(season: number | null, episode: number | null, state: 'new' | 'started' | 'done' = 'new', extra: Partial<EpisodeRow> = {}): EpisodeRow {
  return {
    id: ++id, season, episode, addedAt: 1000, completed: state === 'done', started: state === 'started',
    lastPlayedAt: state === 'new' ? null : 5000, ...extra
  };
}
const season = (s: number, n: number, played: number) => Array.from({ length: n }, (_, i) => ep(s, i + 1, i < played ? 'done' : 'new'));

describe('planShow: the next episode', () => {
  it('has nothing to suggest for a show nobody has started', () => {
    const p = planShow(season(1, 5, 0), null);
    expect(p).toMatchObject({ inProgress: false, next: null, playedCount: 0, episodeCount: 5, lastPlayedAt: 0 });
  });

  it('suggests the episode after the last one finished', () => {
    const rows = season(1, 5, 2);
    const p = planShow(rows, null);
    expect(p.inProgress).toBe(true);
    expect(p.next).toMatchObject({ rowId: rows[2]!.id, season: 1, episode: 3 });
    expect(p).toMatchObject({ playedCount: 2, episodeCount: 5, lastPlayedAt: 5000 });
  });

  it('continues from the furthest episode reached, not the first gap', () => {
    const rows = [ep(1, 1, 'done'), ep(1, 2), ep(1, 3), ep(1, 4, 'done'), ep(1, 5), ep(1, 6)];
    expect(planShow(rows, null).next).toMatchObject({ episode: 5 });
  });

  it('treats a partly watched episode as reached, leaving it to Continue Watching', () => {
    const rows = [ep(1, 1, 'done'), ep(1, 2, 'started'), ep(1, 3), ep(1, 4)];
    const p = planShow(rows, null);
    expect(p.inProgress).toBe(true);
    expect(p.next).toMatchObject({ episode: 3 });
  });

  it('counts a show whose only watched episode is partial as in progress', () => {
    const rows = [ep(1, 1, 'started'), ep(1, 2)];
    expect(planShow(rows, null)).toMatchObject({ inProgress: true, next: { episode: 2 }, playedCount: 0 });
  });

  it('has no next episode once the last one is finished or in progress', () => {
    expect(planShow(season(1, 3, 3), null)).toMatchObject({ inProgress: true, next: null, playedCount: 3 });
    expect(planShow([ep(1, 1, 'done'), ep(1, 2, 'started')], null).next).toBeNull();
  });

  it('rolls over into the next season', () => {
    const rows = [...season(1, 3, 3), ...season(2, 3, 0)];
    expect(planShow(rows, null).next).toMatchObject({ season: 2, episode: 1 });
  });

  it('orders by season then episode regardless of input order', () => {
    const rows = [ep(2, 1), ep(1, 2), ep(1, 1, 'done'), ep(2, 2), ep(1, 3)];
    expect(planShow(rows, null).next).toMatchObject({ season: 1, episode: 2 });
  });

  it('treats a missing season as season 1', () => {
    const a = ep(null, 1, 'done');
    const b = ep(1, 2);
    expect(planShow([a, b], null)).toMatchObject({ episodeCount: 2, next: { rowId: b.id, season: 1, episode: 2 } });
  });

  it('shares one slot between copies of an episode', () => {
    const copyA = ep(1, 2, 'done');
    const copyB = ep(1, 2); // a second file (say a different rip) that was never played
    const three = ep(1, 3);
    const p = planShow([ep(1, 1, 'done'), copyA, copyB, three], null);
    expect(p.episodeCount).toBe(3);
    expect(p.playedCount).toBe(2);
    expect(p.next).toMatchObject({ rowId: three.id, episode: 3 });
  });

  it('plays the lowest-id copy when several files hold the next episode', () => {
    const low = ep(1, 2);
    const high = ep(1, 2);
    expect(planShow([ep(1, 1, 'done'), high, low], null).next?.rowId).toBe(low.id);
  });

  it('ignores files with no episode number', () => {
    const p = planShow([ep(1, 1, 'done'), ep(1, null), ep(1, 2)], null);
    expect(p.episodeCount).toBe(2);
    expect(p.next).toMatchObject({ episode: 2 });
    expect(planShow([ep(1, null, 'done'), ep(1, null)], null)).toMatchObject({ inProgress: false, next: null, episodeCount: 0 });
  });

  it('never suggests, or counts progress from, season 0 specials', () => {
    const only = planShow([ep(0, 1, 'done'), ep(1, 1), ep(1, 2)], null);
    expect(only).toMatchObject({ inProgress: false, next: null, episodeCount: 2, playedCount: 0 });

    const rows = [ep(1, 1, 'done'), ep(0, 1), ep(1, 2)];
    expect(planShow(rows, null).next).toMatchObject({ season: 1, episode: 2 });
    expect(planShow([ep(1, 1, 'done'), ep(1, 2, 'done'), ep(0, 1)], null)).toMatchObject({ next: null, episodeCount: 2, playedCount: 2 });
  });

  it('survives an empty show', () => {
    expect(planShow([], 1)).toEqual({ episodeCount: 0, playedCount: 0, lastPlayedAt: 0, inProgress: false, next: null, newEpisodes: 0 });
  });

  it('reports the most recent playback of any episode', () => {
    const p = planShow([ep(1, 1, 'done', { lastPlayedAt: 100 }), ep(1, 2, 'done', { lastPlayedAt: 900 }), ep(1, 3, 'done', { lastPlayedAt: 300 })], null);
    expect(p.lastPlayedAt).toBe(900);
  });
});

describe('planShow: new episodes', () => {
  const at = (season: number, episode: number, addedAt: number, state: 'new' | 'started' | 'done' = 'new') => ep(season, episode, state, { addedAt });

  it('has no baseline, so nothing is new, for a show that is not followed', () => {
    const p = planShow([at(1, 1, 100), at(1, 2, 200)], null);
    expect(p.newEpisodes).toBe(0);
  });

  it('counts unplayed episodes that arrived after the baseline', () => {
    const rows = [at(1, 1, 100, 'done'), at(1, 2, 150), at(1, 3, 300), at(1, 4, 400)];
    expect(planShow(rows, 200).newEpisodes).toBe(2);
  });

  it('does not count episodes that arrived at or before the baseline', () => {
    const rows = [at(1, 1, 100), at(1, 2, 200), at(1, 3, 201)];
    expect(planShow(rows, 200).newEpisodes).toBe(1);
  });

  it('stops counting an episode once it has been played or started', () => {
    const rows = [at(1, 1, 100, 'done'), at(1, 2, 300, 'done'), at(1, 3, 300, 'started'), at(1, 4, 300)];
    expect(planShow(rows, 200).newEpisodes).toBe(1);
  });

  it('uses the earliest copy, so a late duplicate of an old episode is not news', () => {
    const rows = [at(1, 1, 100, 'done'), at(1, 2, 100), at(1, 2, 500)];
    expect(planShow(rows, 200).newEpisodes).toBe(0);
  });

  it('counts a new special, but never suggests it', () => {
    const rows = [at(1, 1, 100, 'done'), at(0, 1, 300)];
    const p = planShow(rows, 200);
    expect(p.newEpisodes).toBe(1);
    expect(p.next).toBeNull();
  });

  it('flags the suggested episode when it is itself new', () => {
    const fresh = [at(1, 1, 100, 'done'), at(1, 2, 300)];
    expect(planShow(fresh, 200).next).toMatchObject({ episode: 2, isNew: true });
    const old = [at(1, 1, 100, 'done'), at(1, 2, 150), at(1, 3, 300)];
    const p = planShow(old, 200);
    expect(p.next).toMatchObject({ episode: 2, isNew: false });
    expect(p.newEpisodes).toBe(1);
  });

  it('accepts a baseline of zero', () => {
    expect(planShow([at(1, 1, 5)], 0).newEpisodes).toBe(1);
  });
});

describe('compareUpNext', () => {
  const show = (key: string, title: string, lastPlayedAt: number) => ({ key, title, lastPlayedAt });
  it('puts the most recently watched show first', () => {
    const list = [show('a', 'A', 10), show('b', 'B', 30), show('c', 'C', 20)].sort(compareUpNext);
    expect(list.map((s) => s.key)).toEqual(['b', 'c', 'a']);
  });
  it('breaks ties by title, then key, so the order never shuffles', () => {
    const list = [show('z', 'Zed', 5), show('a2', 'alpha', 5), show('a1', 'Alpha', 5)].sort(compareUpNext);
    expect(list.map((s) => s.key)).toEqual(['a1', 'a2', 'z']);
  });
});
