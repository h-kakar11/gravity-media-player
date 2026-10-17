import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCENTS } from '../../src/shared/settings';

/** WCAG 2.x contrast between two sRGB hex colours. */
function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}
export const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi! + 0.05) / (lo! + 0.05); };

const css = readFileSync(resolve('src/renderer/styles/tokens.css'), 'utf8');

/** Pull `--token: #hex` declarations out of the block that starts at `marker`. */
function block(marker: string): Record<string, string> {
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`tokens.css has no block starting “${marker}”`);
  const open = css.indexOf('{', start);
  let depth = 0, end = open;
  for (let i = open; i < css.length; i++) { if (css[i] === '{') depth++; else if (css[i] === '}' && --depth === 0) { end = i; break; } }
  const out: Record<string, string> = {};
  for (const m of css.slice(open, end).matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]!] = m[2]!;
  return out;
}

const light = block(':root {');
const dark = { ...light, ...block('@media (prefers-color-scheme: dark) {\n  :root') };
const themes: Record<string, Record<string, string>> = {
  light, dark,
  midnight: { ...dark, ...block("html[data-theme='midnight']") },
  paper: { ...light, ...block("html[data-theme='paper']") },
  contrast: { ...dark, ...block("html[data-theme='contrast']") }
};

describe('colour contrast (WCAG AA)', () => {
  for (const [name, t] of Object.entries(themes)) {
    describe(name, () => {
      for (const surface of ['--bg', '--bg-2', '--card'] as const) {
        it(`primary text on ${surface} is at least 7:1`, () => expect(contrast(t['--label']!, t[surface]!)).toBeGreaterThanOrEqual(7));
        it(`secondary text on ${surface} is at least 4.5:1`, () => expect(contrast(t['--label-2']!, t[surface]!)).toBeGreaterThanOrEqual(4.5));
      }
      it('state colours are legible on the page background', () => {
        for (const c of ['--danger', '--success', '--warning'] as const) expect(contrast(t[c]!, t['--bg']!), c).toBeGreaterThanOrEqual(4.5);
      });
    });
  }

  describe('accent colours', () => {
    for (const [id, a] of Object.entries(ACCENTS)) {
      it(`${id}: white text on the accent fill, and the accent as text, are at least 4.5:1`, () => {
        expect(contrast('#ffffff', a.light), 'white on light fill').toBeGreaterThanOrEqual(4.5);
        expect(contrast(a.light, '#ffffff'), 'light accent as text on white').toBeGreaterThanOrEqual(4.5);
        expect(contrast(a.light, themes.paper!['--bg']!), 'light accent as text on paper').toBeGreaterThanOrEqual(4.5);
        for (const t of ['dark', 'midnight', 'contrast'] as const) {
          expect(contrast(a.dark, themes[t]!['--bg']!), `dark accent as text on ${t}`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(a.dark, themes[t]!['--card']!), `dark accent as text on ${t} cards`).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  });
});
