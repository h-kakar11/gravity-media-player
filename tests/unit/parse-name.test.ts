import { describe, expect, it } from 'vitest';
import { classifyVideo, looksLikeComicPages, parseComicName, parseTrackName, parseVideoName, pickSidecarArt } from '@shared/parse-name';
import { isImageExtForTest } from './helpers';

describe('parseVideoName', () => {
  it('parses scene-style episode names', () => {
    const p = parseVideoName('Breaking.Bad.S02E05.Breakage.1080p.BluRay.x264-GRP');
    expect(p).toMatchObject({ isEpisode: true, series: 'Breaking Bad', season: 2, episode: 5, episodeTitle: 'Breakage' });
  });

  it('parses "Show - S01E02 - Title"', () => {
    const p = parseVideoName('Signal Lost - S01E02 - Static');
    expect(p).toMatchObject({ series: 'Signal Lost', season: 1, episode: 2, title: 'Static' });
  });

  it('parses 1x02 style and ignores resolutions', () => {
    expect(parseVideoName('Some Show 3x07').episode).toBe(7);
    expect(parseVideoName('Holiday Clip 1920x1080').isEpisode).toBe(false);
  });

  it('parses multi-episode files', () => {
    const p = parseVideoName('Show.S01E01-E02.Pilot');
    expect(p).toMatchObject({ episode: 1, episodeEnd: 2 });
  });

  it('uses season folders for loose episode numbers', () => {
    const p = parseVideoName('05 - The One With Gravity', ['Season 2', 'Orbit']);
    expect(p).toMatchObject({ series: 'Orbit', season: 2, episode: 5, title: 'The One With Gravity' });
  });

  it('parses anime releases', () => {
    const p = parseVideoName('[SubGroup] Planet Walker - 07 [1080p][ABCD1234]');
    expect(p).toMatchObject({ series: 'Planet Walker', episode: 7, isEpisode: true });
  });

  it('parses movies with parenthesised years', () => {
    expect(parseVideoName('Neon Drift (2019)')).toMatchObject({ title: 'Neon Drift', year: 2019, isEpisode: false });
  });

  it('parses dotted release names and keeps numeric titles', () => {
    const p = parseVideoName('Blade.Runner.2049.2017.1080p.BluRay.x265');
    expect(p).toMatchObject({ title: 'Blade Runner 2049', year: 2017 });
  });

  it('takes the year from the folder when the file lacks one', () => {
    expect(parseVideoName('movie', ['Orbit Study (2021)']).year).toBe(2021);
  });

  it('classifies', () => {
    expect(classifyVideo(parseVideoName('Home Video'), 300)).toBe('clip');
    expect(classifyVideo(parseVideoName('Home Video'), 7200)).toBe('movie');
    expect(classifyVideo(parseVideoName('Film (1999)'), 300)).toBe('movie');
    expect(classifyVideo(parseVideoName('S01E01'), 300)).toBe('episode');
  });
});

describe('parseTrackName', () => {
  it('handles track numbers and artists', () => {
    expect(parseTrackName('01 - Intro')).toMatchObject({ trackNo: 1, title: 'Intro' });
    expect(parseTrackName('2-05 Second Disc')).toMatchObject({ discNo: 2, trackNo: 5, title: 'Second Disc' });
    expect(parseTrackName('Artist - Song Name')).toMatchObject({ artist: 'Artist', title: 'Song Name' });
    expect(parseTrackName('03. Dots_Here')).toMatchObject({ trackNo: 3 });
    expect(parseTrackName('1999')).toMatchObject({ trackNo: null, title: '1999' });
  });
});

describe('parseComicName', () => {
  it('parses volumes and chapters', () => {
    expect(parseComicName('Planet Walker v03 (Digital)', null)).toMatchObject({ series: 'Planet Walker', volume: 3 });
    expect(parseComicName('Planet Walker - Chapter 12', null)).toMatchObject({ series: 'Planet Walker', chapter: 12 });
    expect(parseComicName('One Piece Vol. 100', null)).toMatchObject({ series: 'One Piece', volume: 100 });
  });
  it('falls back to a trailing number and the parent folder', () => {
    expect(parseComicName('Berserk 12', null)).toMatchObject({ series: 'Berserk', volume: 12 });
    expect(parseComicName('Chapter 4', 'Dungeon Tales')).toMatchObject({ series: 'Dungeon Tales', chapter: 4 });
  });
  it('detects page-numbered folders', () => {
    expect(looksLikeComicPages(['001.jpg', '002.jpg', '003.jpg', '004.jpg', '005.jpg', '006.jpg'])).toBe(true);
    expect(looksLikeComicPages(['holiday.jpg', 'beach.jpg', 'dog.jpg', 'cat.jpg', 'tree.jpg'])).toBe(false);
  });
});

describe('pickSidecarArt', () => {
  it('prefers per-file art then folder art', () => {
    expect(pickSidecarArt('Movie', ['Movie-poster.jpg', 'folder.jpg'], isImageExtForTest)).toBe('Movie-poster.jpg');
    expect(pickSidecarArt('Movie', ['folder.png', 'x.srt'], isImageExtForTest)).toBe('folder.png');
    expect(pickSidecarArt('Movie', ['x.srt'], isImageExtForTest)).toBeNull();
  });
});
