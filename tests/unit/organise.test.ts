import { describe, expect, it } from 'vitest';
import { buildPlan, DEFAULT_ORGANISE, safeName, type OrgRow } from '@shared/organise';

const row = (o: Partial<OrgRow> & { id: number; rel: string }): OrgRow => ({
  kind: 'video', vclass: 'movie', ext: 'mkv', title: null, series: null, season: null, episode: null, year: null,
  artist: null, albumArtist: null, album: null, trackNo: null, discNo: null, ...o
});
const opts = { rootId: 1, ...DEFAULT_ORGANISE };
const plan = (rows: OrgRow[], siblings: string[] = [], exists: (p: string) => boolean = () => false) => buildPlan(rows, opts, '/lib', siblings.length ? siblings : rows.map((r) => r.rel), exists);

describe('safeName', () => {
  it('strips characters illegal on Windows and trailing dots', () => {
    expect(safeName('AC/DC: Back in Black?')).toBe('AC DC Back in Black');
    expect(safeName('Ends with dot...')).toBe('Ends with dot');
    expect(safeName('CON')).toBe('CON_');
    expect(safeName('   ')).toBe('Untitled');
  });
});

describe('planner', () => {
  it('lays out movies, episodes and music', () => {
    const p = plan([
      row({ id: 1, rel: 'junk/orbit.study.2021.1080p.mkv', title: 'Orbit Study', year: 2021 }),
      row({ id: 2, rel: 'x/s01e02.mkv', vclass: 'episode', series: 'Signal Lost', season: 1, episode: 2, title: 'Static' }),
      row({ id: 3, rel: 'a.flac', kind: 'audio', vclass: null, ext: 'flac', title: 'Intro', albumArtist: 'The Band', album: 'First', year: 2019, trackNo: 1 }),
      row({ id: 4, rel: 'b.flac', kind: 'audio', vclass: null, ext: 'flac', title: 'Disc Two', albumArtist: 'The Band', album: 'First', year: 2019, trackNo: 3, discNo: 2 })
    ]);
    const to = Object.fromEntries(p.entries.map((e) => [e.id, e.to]));
    expect(to[1]).toBe('Orbit Study (2021)/Orbit Study (2021).mkv');
    expect(to[2]).toBe('Signal Lost/Season 01/Signal Lost - S01E02 - Static.mkv');
    expect(to[3]).toBe('The Band/First (2019)/01 - Intro.flac');
    expect(to[4]).toBe('The Band/First (2019)/2-03 - Disc Two.flac');
  });

  it('unifies spellings of one show and moves matching sidecars', () => {
    const rows = [
      row({ id: 1, rel: 'a/ep1.mkv', vclass: 'episode', series: 'The Expanse', season: 1, episode: 1 }),
      row({ id: 2, rel: 'a/ep2.mkv', vclass: 'episode', series: 'The Expanse', season: 1, episode: 2 }),
      row({ id: 3, rel: 'a/ep3.mkv', vclass: 'episode', series: 'the expanse', season: 1, episode: 3 })
    ];
    const p = plan(rows, ['a/ep1.mkv', 'a/ep2.mkv', 'a/ep3.mkv', 'a/ep1.en.srt', 'a/ep1.nfo', 'a/other.srt']);
    expect(new Set(p.entries.map((e) => e.to.split('/')[0]))).toEqual(new Set(['The Expanse']));
    const e1 = p.entries.find((e) => e.id === 1)!;
    expect(e1.sidecars.map((s) => s.to).sort()).toEqual(['The Expanse/Season 01/The Expanse - S01E01.en.srt', 'The Expanse/Season 01/The Expanse - S01E01.nfo']);
  });

  it('marks tidy files ok, skips unreadable ones and flags collisions', () => {
    const p = plan([
      row({ id: 1, rel: 'Orbit (2021)/Orbit (2021).mkv', title: 'Orbit', year: 2021 }),
      row({ id: 2, rel: 'q/ep.mkv', vclass: 'episode', series: 'Show' }),
      row({ id: 3, rel: 'd1/dup.mkv', title: 'Dup', year: 2000 }),
      row({ id: 4, rel: 'd2/dup.mkv', title: 'Dup', year: 2000 }),
      row({ id: 5, rel: 'n/new.mkv', title: 'Taken', year: 1999 })
    ], undefined, (rel) => rel === 'Taken (1999)/Taken (1999).mkv');
    const st = Object.fromEntries(p.entries.map((e) => [e.id, e.status]));
    expect(st[1]).toBe('ok');
    expect(st[2]).toBe('skip');
    expect([st[3], st[4]].sort()).toEqual(['conflict', 'move']);
    expect(st[5]).toBe('conflict');
  });
});
