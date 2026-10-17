import { describe, expect, it } from 'vitest';
import { parseNfo } from '../../src/main/library/nfo';

describe('parseNfo', () => {
  it('reads a movie nfo', () => {
    const n = parseNfo(`<?xml version="1.0"?><movie><title>Orbit Study</title><year>2021</year><plot>Two &amp; two.</plot><genre>Sci-Fi</genre><genre>Drama</genre></movie>`);
    expect(n).toMatchObject({ title: 'Orbit Study', year: 2021, genres: ['Sci-Fi', 'Drama'] });
    expect(n?.plot).toBe('Two & two.');
  });
  it('reads an episode nfo', () => {
    const n = parseNfo('<episodedetails><title>Pilot</title><season>1</season><episode>2</episode><showtitle>Signal Lost</showtitle></episodedetails>');
    expect(n).toMatchObject({ season: 1, episode: 2, showTitle: 'Signal Lost' });
  });
  it('rejects garbage', () => {
    expect(parseNfo('not xml')).toBeNull();
    expect(parseNfo('<html></html>')).toBeNull();
  });
});
