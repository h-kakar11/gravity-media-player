import { describe, expect, it } from 'vitest';
import { BIN_NAME, buildPlan, cleanStem, DEFAULT_ORGANISE, safeName, type OrgRow } from '@shared/organise';

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

describe('cleanStem', () => {
  it('removes yt-dlp format ids, video ids and junk tags', () => {
    expect(cleanStem('Daft Punk - One More Time (Official Video).f616')).toBe('Daft Punk - One More Time');
    expect(cleanStem('Song Name [dQw4w9WgXcQ]')).toBe('Song Name');
    expect(cleanStem('Song [Lyrics] (HD)')).toBe('Song');
  });
  it('folds fancy letters and only drops a leading number when asked', () => {
    expect(cleanStem('𝐒𝐨𝐧𝐠 𝐍𝐚𝐦𝐞')).toBe('Song Name');
    expect(cleanStem('07 - Song Name')).toBe('07 - Song Name');
    expect(cleanStem('07 - Song Name', true)).toBe('Song Name');
    expect(cleanStem('2 Unlimited - No Limit', true)).toBe('2 Unlimited - No Limit');
  });
});

describe('duplicates and the Gravity Bin', () => {
  const ep = (o: Partial<OrgRow> & { id: number; rel: string }) =>
    row({ vclass: 'episode', series: 'Black Clover', season: 1, episode: 1, size: 1000, durationSec: 1400, height: 1080, ...o });

  it('keeps the best copy and bins the rest when they are the same file', () => {
    const p = plan([
      ep({ id: 1, rel: 'Black Clover S01 1080p x265/ep1.mkv', size: 900, height: 1080 }),
      ep({ id: 2, rel: 'Black Clover S01/ep1.mkv', size: 900, height: 720 }),
      ep({ id: 3, rel: 'Black Clover S01 EMBER/ep1.mkv', size: 900, height: 1080, audioTracks: 2 })
    ]);
    const by = Object.fromEntries(p.entries.map((e) => [e.id, e]));
    expect(by[3]!.status).toBe('move');
    expect(by[3]!.to).toBe('Black Clover/Season 01/Black Clover - S01E01.mkv');
    for (const id of [1, 2]) {
      expect(by[id]!.status).toBe('bin');
      expect(by[id]!.to).toBe(`${BIN_NAME}/${by[id]!.from}`);
      expect(by[id]!.reason).toMatch(/duplicate/i);
    }
    expect(p.counts).toMatchObject({ move: 1, bin: 2 });
  });

  it('never bins a different file that merely wants the same name', () => {
    const p = plan([
      ep({ id: 1, rel: 'a/ep1.mkv', size: 900, durationSec: 1400 }),
      ep({ id: 2, rel: 'b/ep1.mkv', size: 500, durationSec: 600 })
    ]);
    expect(p.entries.map((e) => e.status).sort()).toEqual(['conflict', 'move']);
  });

  it('does not bin anything when sizes are unknown', () => {
    const p = plan([ep({ id: 1, rel: 'a/ep1.mkv', size: null, durationSec: null }), ep({ id: 2, rel: 'b/ep1.mkv', size: null, durationSec: null })]);
    expect(p.counts.bin).toBe(0);
  });

  it('leaves duplicates alone when the option is off', () => {
    const rows = [ep({ id: 1, rel: 'a/ep1.mkv', size: 900 }), ep({ id: 2, rel: 'b/ep1.mkv', size: 900 })];
    const p = buildPlan(rows, { ...opts, duplicates: false }, '/lib', rows.map((r) => r.rel), () => false);
    expect(p.counts.bin).toBe(0);
  });

  it('bins duplicates together with their thumbnails and bins unfinished downloads', () => {
    const rows = [ep({ id: 1, rel: 'a/ep1.mkv', size: 900 }), ep({ id: 2, rel: 'b/ep1.mkv', size: 900, height: 720 })];
    const p = buildPlan(rows, opts, '/lib', ['a/ep1.mkv', 'b/ep1.mkv', 'b/ep1-thumb.jpg', 'b/clip.f401.mp4.part'], () => false);
    const dup = p.entries.find((e) => e.id === 2)!;
    expect(dup.status).toBe('bin');
    expect(dup.sidecars.map((s) => s.to)).toEqual([`${BIN_NAME}/b/ep1-thumb.jpg`]);
    const part = p.entries.find((e) => e.from === 'b/clip.f401.mp4.part')!;
    expect(part).toMatchObject({ status: 'bin', to: `${BIN_NAME}/b/clip.f401.mp4.part` });
  });

  it('bins loose files left in a folder that only held duplicates, and carries art along otherwise', () => {
    const rows = [
      ep({ id: 1, rel: 'Keep/ep1.mkv', size: 900 }),
      ep({ id: 2, rel: 'Dups/ep1.mkv', size: 900, height: 720 }),
      ep({ id: 3, rel: 'Moving/ep2.mkv', episode: 2, size: 800 })
    ];
    const p = buildPlan(rows, opts, '/lib', ['Keep/ep1.mkv', 'Dups/ep1.mkv', 'Dups/folder.jpg', 'Moving/ep2.mkv', 'Moving/poster.jpg'], () => false);
    expect(p.entries.find((e) => e.from === 'Dups/folder.jpg')).toMatchObject({ status: 'bin' });
    expect(p.entries.find((e) => e.from === 'Moving/poster.jpg')).toMatchObject({ status: 'move', to: 'Black Clover/poster.jpg' });
  });
});

describe('messy real-world names', () => {
  it('turns unnumbered extras into Specials and drops placeholder episode titles', () => {
    const p = plan([
      row({ id: 1, rel: 'Black Clover Extras/Black Clover - Opening 1.mkv', vclass: 'episode', series: 'Black Clover', season: 0, episode: null, title: 'Black Clover - Opening 1' }),
      row({ id: 2, rel: 'x/a.mkv', vclass: 'episode', series: 'One-Punch Man', season: 3, episode: 7, title: 'Episode 7' })
    ]);
    const to = Object.fromEntries(p.entries.map((e) => [e.id, e.to]));
    expect(to[1]).toBe('Black Clover/Specials/Black Clover - Opening 1.mkv');
    expect(to[2]).toBe('One-Punch Man/Season 03/One-Punch Man - S03E07.mkv');
  });

  it('cleans music in place when it has no tags, without inventing Unknown Artist folders', () => {
    const p = plan([
      row({ id: 1, rel: 'Music/Song A (Official Video).f616.mp4', vclass: 'clip', ext: 'mp4' }),
      row({ id: 2, rel: 'Music/Song B.mp3', kind: 'audio', vclass: null, ext: 'mp3' }),
      row({ id: 3, rel: 'Music/Tagged.mp3', kind: 'audio', vclass: null, ext: 'mp3', title: 'Tagged', artist: 'Band' })
    ]);
    const to = Object.fromEntries(p.entries.map((e) => [e.id, e.to]));
    expect(to[1]).toBe('Music/Song A.mp4');
    expect(p.entries.find((e) => e.id === 2)!.status).toBe('ok');
    expect(to[3]).toBe('Band/Tagged.mp3');
    expect(p.entries.some((e) => /unknown/i.test(e.to))).toBe(false);
  });

  it('treats leading numbers as playlist order only in folders where several files share one', () => {
    const p = plan([
      row({ id: 1, rel: 'M/12 - Alpha.mp3', kind: 'audio', vclass: null, ext: 'mp3' }),
      row({ id: 2, rel: 'M/12 - Beta.mp3', kind: 'audio', vclass: null, ext: 'mp3' }),
      row({ id: 3, rel: 'M/07 - Gamma.mp3', kind: 'audio', vclass: null, ext: 'mp3' }),
      row({ id: 4, rel: 'Album/01 - One.mp3', kind: 'audio', vclass: null, ext: 'mp3' }),
      row({ id: 5, rel: 'Album/02 - Two.mp3', kind: 'audio', vclass: null, ext: 'mp3' })
    ]);
    const to = Object.fromEntries(p.entries.map((e) => [e.id, e.to]));
    expect([to[1], to[2], to[3]]).toEqual(['M/Alpha.mp3', 'M/Beta.mp3', 'M/Gamma.mp3']);
    expect([to[4], to[5]]).toEqual(['Album/01 - One.mp3', 'Album/02 - Two.mp3']);
  });
});

describe('sections', () => {
  const show = (id: number, rel: string, series: string, e: number) => row({ id, rel, vclass: 'episode', series, season: 1, episode: e, size: 100 + id, durationSec: 1400 + id * 100 });

  it('keeps files inside a folder that holds several titles, and moves a single title up', () => {
    const p = plan([
      show(1, 'anime/Show A S01 1080p/a1.mkv', 'Show A', 1),
      show(2, 'anime/Show B S01/b1.mkv', 'Show B', 1),
      show(3, 'Show C S01 x265/c1.mkv', 'Show C', 1),
      row({ id: 4, rel: 'movies/dl/orbit.2021.mkv', title: 'Orbit', year: 2021 })
    ]);
    const to = Object.fromEntries(p.entries.map((e) => [e.id, e.to]));
    expect(to[1]).toBe('anime/Show A/Season 01/Show A - S01E01.mkv');
    expect(to[2]).toBe('anime/Show B/Season 01/Show B - S01E01.mkv');
    expect(to[3]).toBe('Show C/Season 01/Show C - S01E01.mkv');
    expect(to[4]).toBe('Orbit (2021)/Orbit (2021).mkv');
  });

  it('stays put once tidy, even when only one title is left in the section', () => {
    const p = plan([show(1, 'anime/Show A/Season 01/Show A - S01E01.mkv', 'Show A', 1)]);
    expect(p.entries[0]).toMatchObject({ status: 'ok' });
  });

  it('carries leftover artwork to the title folder inside the section', () => {
    const rows = [show(1, 'anime/Show A S01/a1.mkv', 'Show A', 1), show(2, 'anime/Show B/b1.mkv', 'Show B', 1)];
    const p = buildPlan(rows, opts, '/lib', ['anime/Show A S01/a1.mkv', 'anime/Show A S01/poster.jpg', 'anime/Show B/b1.mkv'], () => false);
    expect(p.entries.find((e) => e.from === 'anime/Show A S01/poster.jpg')).toMatchObject({ status: 'move', to: 'anime/Show A/poster.jpg' });
  });
});
