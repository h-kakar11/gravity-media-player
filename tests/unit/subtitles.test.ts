import { describe, expect, it } from 'vitest';
import { activeCues, parseSubtitles, sanitize } from '@shared/subtitles';
import { activeLyricIndex, parseLrc } from '@shared/lyrics';

describe('subtitles', () => {
  it('parses SRT with formatting', () => {
    const cues = parseSubtitles(`1\n00:00:01,000 --> 00:00:03,500\nHello <i>world</i>\nsecond line\n\n2\n00:00:04,000 --> 00:00:05,000\n<font color="red">Red</font> & done\n`);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ start: 1, end: 3.5, html: 'Hello <i>world</i><br>second line' });
    expect(cues[1]!.html).toBe('Red &amp; done');
  });

  it('parses WebVTT with settings and ignores NOTE blocks', () => {
    const cues = parseSubtitles(`WEBVTT\n\nNOTE comment\n\n00:01.000 --> 00:02.000 line:0 align:left\nTop left\n\ncue-id\n01:00:00.000 --> 01:00:01.500\nHour mark\n`);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ anchor: 'top', align: 'left', html: 'Top left' });
    expect(cues[1]!.start).toBe(3600);
  });

  it('parses ASS dialogue, alignment and override tags', () => {
    const ass = `[Script Info]\nTitle: x\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1\nStyle: Sign,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,-1,0,0,100,100,0,0,1,2,0,8,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,Hello, {\\i1}world{\\i0}\\Nnext\nDialogue: 0,0:00:03.00,0:00:04.00,Sign,,0,0,0,,Up top\nDialogue: 0,0:00:05.00,0:00:06.00,Default,,0,0,0,,{\\an9}Corner\nDialogue: 0,0:00:07.00,0:00:08.00,Default,,0,0,0,,{\\p1}m 0 0 l 10 10{\\p0}\n`;
    const cues = parseSubtitles(ass);
    expect(cues).toHaveLength(3);
    expect(cues[0]).toMatchObject({ start: 1, end: 2.5, html: 'Hello, <i>world</i><br>next', anchor: 'bottom' });
    expect(cues[1]).toMatchObject({ anchor: 'top', html: '<i>Up top</i>' });
    expect(cues[2]).toMatchObject({ anchor: 'top', align: 'right' });
  });

  it('finds overlapping active cues', () => {
    const cues = parseSubtitles(`1\n00:00:01,000 --> 00:00:10,000\nlong\n\n2\n00:00:02,000 --> 00:00:03,000\nshort\n`);
    expect(activeCues(cues, 2.5).map((c) => c.html)).toEqual(['long', 'short']);
    expect(activeCues(cues, 5).map((c) => c.html)).toEqual(['long']);
    expect(activeCues(cues, 0.5)).toEqual([]);
    expect(activeCues(cues, 11)).toEqual([]);
  });

  it('sanitises script injection', () => {
    expect(sanitize('<script>alert(1)</script><b>ok</b>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;<b>ok</b>');
    expect(sanitize('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('lyrics', () => {
  it('parses synced LRC with multiple stamps and offset', () => {
    const r = parseLrc(`[ti:Song]\n[offset:500]\n[00:01.00]First\n[00:03.50][00:10.00]Chorus\n[00:05.00]<00:05.00>Word <00:05.50>level\n`);
    expect(r.synced).toBe(true);
    expect(r.lines.map((l) => [l.timeSec, l.text])).toEqual([[0.5, 'First'], [3, 'Chorus'], [4.5, 'Word level'], [9.5, 'Chorus']]);
    expect(activeLyricIndex(r.lines, 3.2)).toBe(1);
    expect(activeLyricIndex(r.lines, 0.1)).toBe(-1);
  });

  it('returns plain lyrics as unsynced', () => {
    const r = parseLrc('line one\nline two');
    expect(r.synced).toBe(false);
    expect(r.lines).toHaveLength(2);
  });
});
