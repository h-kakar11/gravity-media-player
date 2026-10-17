/**
 * Command-palette ranking. Pure so it can be unit tested: the palette component only builds the
 * list of commands and renders what comes back.
 */

export interface Rankable {
  label: string;
  /** Extra words that should match but aren't shown ("preferences" for Settings). */
  keywords?: string;
}

/**
 * Score `text` against `query`; higher is better, `null` means no match. Substring hits beat
 * scattered subsequence hits, and hits at the start of a word beat hits in the middle of one.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  const at = t.indexOf(q);
  if (at >= 0) {
    const wordStart = at === 0 || /[\s\-_/.:()]/.test(t[at - 1]!);
    return 1000 - at + (wordStart ? 200 : 0) + (t === q ? 300 : 0) - Math.min(t.length, 100) / 10;
  }
  // Subsequence match, preferring runs of consecutive characters and word starts.
  let score = 0;
  let run = 0;
  let ti = 0;
  for (const ch of q) {
    if (ch === ' ') { run = 0; continue; }
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    run = found === ti ? run + 1 : 0;
    const wordStart = found === 0 || /[\s\-_/.:()]/.test(t[found - 1]!);
    score += 10 + run * 6 + (wordStart ? 12 : 0) - Math.min(found - ti, 20);
    ti = found + 1;
  }
  return score;
}

/** Best score across the label and keywords (a label hit is worth slightly more than a keyword hit). */
export function scoreEntry(query: string, entry: Rankable): number | null {
  const a = fuzzyScore(query, entry.label);
  const b = entry.keywords ? fuzzyScore(query, entry.keywords) : null;
  if (a == null && b == null) return null;
  return Math.max(a ?? -Infinity, b == null ? -Infinity : b - 40);
}

/** Matching entries, best first. With an empty query every entry is kept in its original order. */
export function rankEntries<T extends Rankable>(entries: T[], query: string, limit = 50): T[] {
  if (!query.trim()) return entries.slice(0, limit);
  const scored: { e: T; s: number; i: number }[] = [];
  entries.forEach((e, i) => {
    const s = scoreEntry(query, e);
    if (s != null) scored.push({ e, s, i });
  });
  scored.sort((x, y) => y.s - x.s || x.i - y.i);
  return scored.slice(0, limit).map((x) => x.e);
}
