/**
 * Subtitle parsing for SRT, WebVTT and ASS/SSA. The player renders cues in its own overlay
 * (so size, colour, background, position and delay are fully user-configurable), which means
 * every source format is normalised to the same Cue shape here.
 */

export interface Cue {
  start: number;
  end: number;
  /** Sanitised markup: only <i>, <b>, <u> and <br> survive. */
  html: string;
  /** Vertical anchor. ASS \an7-9 and VTT line:0..n map to 'top'. */
  anchor: 'bottom' | 'top' | 'middle';
  align: 'left' | 'center' | 'right';
}

export type SubtitleFormat = 'srt' | 'vtt' | 'ass';

export function detectSubtitleFormat(text: string, hint?: string): SubtitleFormat {
  const h = hint?.toLowerCase();
  if (h === 'vtt' || h === 'webvtt') return 'vtt';
  if (h === 'ass' || h === 'ssa') return 'ass';
  if (h === 'srt' || h === 'subrip') return 'srt';
  const head = text.slice(0, 400);
  if (/^﻿?WEBVTT/.test(head)) return 'vtt';
  if (/\[Script Info\]/i.test(head) || /^\[V4\+? Styles\]/im.test(text.slice(0, 4000))) return 'ass';
  return 'srt';
}

export function parseSubtitles(input: string, hint?: string): Cue[] {
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const fmt = detectSubtitleFormat(text, hint);
  const cues = fmt === 'ass' ? parseAss(text) : parseSrtOrVtt(text);
  cues.sort((a, b) => a.start - b.start || a.end - b.end);
  return cues;
}

// ---------------------------------------------------------------------------

const TIME = /(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function toSeconds(h: string | undefined, m: string, s: string, ms: string): number {
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
}

function parseSrtOrVtt(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.split(/\n{2,}/);
  const arrow = new RegExp(`(${TIME.source})\\s*-->\\s*(${TIME.source})(.*)`);
  for (const block of blocks) {
    const lines = block.split('\n');
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const m = arrow.exec(lines[ti]!);
    if (!m) continue;
    // Groups: 1=full start, 2..5 start parts, 6=full end, 7..10 end parts, 11=settings
    const start = toSeconds(m[2], m[3]!, m[4]!, m[5]!);
    const end = toSeconds(m[7], m[8]!, m[9]!, m[10]!);
    const settings = m[11] ?? '';
    const body = lines.slice(ti + 1).join('\n');
    const html = sanitize(body);
    if (!html.trim()) continue;
    let anchor: Cue['anchor'] = 'bottom';
    let align: Cue['align'] = 'center';
    const lineSet = /line:(-?\d+(?:\.\d+)?)(%?)/.exec(settings);
    if (lineSet) {
      const v = Number(lineSet[1]);
      if (lineSet[2] === '%') anchor = v < 33 ? 'top' : v < 66 ? 'middle' : 'bottom';
      else anchor = v >= 0 && v < 4 ? 'top' : 'bottom';
    }
    const al = /align:(start|left|end|right|center|middle)/.exec(settings);
    if (al) align = al[1] === 'start' || al[1] === 'left' ? 'left' : al[1] === 'end' || al[1] === 'right' ? 'right' : 'center';
    // SRT sometimes carries ASS-style {\an8}
    const an = /\{\\an(\d)\}/.exec(body);
    if (an) anchor = anchorFromAn(Number(an[1]));
    cues.push({ start, end, html, anchor, align });
  }
  return cues;
}

function anchorFromAn(an: number): Cue['anchor'] {
  if (an >= 7) return 'top';
  if (an >= 4) return 'middle';
  return 'bottom';
}

function alignFromAn(an: number): Cue['align'] {
  const col = (an - 1) % 3;
  return col === 0 ? 'left' : col === 2 ? 'right' : 'center';
}

/** Keep a conservative whitelist of inline markup; escape everything else. */
export function sanitize(raw: string): string {
  let s = raw
    .replace(/\{\\[^}]*\}/g, (tag) => assTagsToHtml(tag)) // ASS overrides embedded in SRT
    .replace(/\\N/g, '\n')
    .replace(/<\/?(?:font|span|c|v|ruby|rt|lang)[^>]*>/gi, '') // drop styling wrappers, keep their text
    .replace(/<\d{1,2}:\d{2}[.:]\d{2,3}>/g, ''); // karaoke timestamps
  // Escape, then re-allow the tags we support.
  s = s.replace(/&(?!(?:amp|lt|gt|quot|nbsp|#\d+);)/g, '&amp;');
  const parts = s.split(/(<\/?[ibu]>|<br\s*\/?>)/gi);
  const out = parts
    .map((p, i) => {
      if (i % 2 === 1) return /^<br/i.test(p) ? '<br>' : p.toLowerCase();
      return p.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    })
    .join('');
  return out.replace(/\n/g, '<br>').replace(/(<br>\s*)+$/g, '').trim();
}

function assTagsToHtml(block: string): string {
  let out = '';
  const inner = block.slice(1, -1);
  if (/\\i1/.test(inner)) out += '<i>';
  if (/\\i0/.test(inner)) out += '</i>';
  if (/\\b1/.test(inner)) out += '<b>';
  if (/\\b0/.test(inner)) out += '</b>';
  if (/\\u1/.test(inner)) out += '<u>';
  if (/\\u0/.test(inner)) out += '</u>';
  return out;
}

// ---------------------------------------------------------------------------
// ASS / SSA

interface AssStyle { alignment: number; italic: boolean; bold: boolean }

function parseAss(text: string): Cue[] {
  const styles = new Map<string, AssStyle>();
  const cues: Cue[] = [];
  let section = '';
  let styleFormat: string[] = [];
  let eventFormat: string[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    const sec = /^\[(.+)]$/.exec(line);
    if (sec) { section = sec[1]!.toLowerCase(); continue; }
    if (section.includes('styles')) {
      if (/^format:/i.test(line)) styleFormat = line.slice(7).split(',').map((s) => s.trim().toLowerCase());
      else if (/^style:/i.test(line)) {
        const vals = line.slice(6).split(',').map((s) => s.trim());
        const get = (k: string) => vals[styleFormat.indexOf(k)] ?? '';
        const align = Number(get('alignment')) || 2;
        // SSA (v4) uses a different numbering: 1-3 bottom, 5-7 top, 9-11 middle.
        const isSsa = section === 'v4 styles';
        const an = isSsa ? ssaToAn(align) : align;
        styles.set(get('name'), { alignment: an, italic: get('italic') === '-1' || get('italic') === '1', bold: get('bold') === '-1' || get('bold') === '1' });
      }
    } else if (section === 'events') {
      if (/^format:/i.test(line)) eventFormat = line.slice(7).split(',').map((s) => s.trim().toLowerCase());
      else if (/^dialogue:/i.test(line)) {
        const body = line.slice(9).trimStart();
        const fields = eventFormat.length || 10;
        const parts: string[] = [];
        let rest = body;
        for (let i = 0; i < fields - 1; i++) {
          const idx = rest.indexOf(',');
          if (idx < 0) break;
          parts.push(rest.slice(0, idx));
          rest += '';
          rest = rest.slice(idx + 1);
        }
        parts.push(rest);
        const get = (k: string, fallback: number) => parts[eventFormat.length ? eventFormat.indexOf(k) : fallback] ?? '';
        const start = assTime(get('start', 1));
        const end = assTime(get('end', 2));
        const style = styles.get(get('style', 3).replace(/^\*/, ''));
        const rawText = get('text', 9);
        if (/\{[^}]*\\p[1-9]/.test(rawText)) continue; // vector drawings
        const an = /\{[^}]*\\an(\d)/.exec(rawText);
        const pos = /\{[^}]*\\pos\(/.test(rawText);
        const align = an ? Number(an[1]) : style?.alignment ?? 2;
        let cleaned = rawText.replace(/\\N/g, '\n').replace(/\\n/g, '\n').replace(/\\h/g, ' ');
        cleaned = cleaned.replace(/\{[^}]*\}/g, (b) => assTagsToHtml(b));
        let html = sanitize(cleaned);
        if (style?.italic && !/<i>/.test(html)) html = `<i>${html}</i>`;
        if (!html.trim() || Number.isNaN(start) || Number.isNaN(end)) continue;
        cues.push({ start, end, html, anchor: pos && !an ? 'bottom' : anchorFromAn(align), align: alignFromAn(align) });
      }
    }
  }
  return cues;
}

function ssaToAn(a: number): number {
  const col = ((a - 1) % 4) + 1; // 1..3
  if (a >= 9) return 3 + col + 3; // middle
  if (a >= 5) return 6 + col; // top
  return col;
}

function assTime(s: string): number {
  const m = /^(\d+):(\d{2}):(\d{2})[.](\d{1,2})$/.exec(s.trim());
  if (!m) return NaN;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]!.padEnd(2, '0')) / 100;
}

// ---------------------------------------------------------------------------

/** Active cues at time `t`. `cues` must be sorted by start. Handles overlapping cues. */
export function activeCues(cues: Cue[], t: number): Cue[] {
  if (cues.length === 0) return [];
  // Binary search: last cue with start <= t
  let lo = 0, hi = cues.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid]!.start <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const out: Cue[] = [];
  for (let i = idx; i >= 0 && i > idx - 24; i--) {
    const c = cues[i]!;
    if (t < c.end) out.push(c);
  }
  return out.reverse();
}

/** Serialise cues as SRT (used when exporting extracted tracks). */
export function toSrt(cues: Cue[]): string {
  const ts = (t: number) => {
    const ms = Math.round(t * 1000);
    const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000), r = ms % 1000;
    const p = (n: number, l = 2) => String(n).padStart(l, '0');
    return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
  };
  return cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.html.replace(/<br>/g, '\n')}\n`).join('\n');
}
