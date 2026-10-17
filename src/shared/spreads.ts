/**
 * Page pairing for the two-page comic layout.
 * The cover (page 0) is shown alone when `coverAlone` is set, and landscape pages (already a spread)
 * are shown alone and break the pairing, so pages never end up next to the wrong partner.
 */
export function buildSpreads(count: number, isWide: (page: number) => boolean, coverAlone: boolean): number[][] {
  const spreads: number[][] = [];
  let i = 0;
  while (i < count) {
    if ((i === 0 && coverAlone) || isWide(i)) { spreads.push([i]); i++; continue; }
    if (i + 1 < count && !isWide(i + 1)) { spreads.push([i, i + 1]); i += 2; } else { spreads.push([i]); i++; }
  }
  return spreads;
}

export const spreadIndexOf = (spreads: number[][], page: number): number => {
  const i = spreads.findIndex((s) => s.includes(page));
  return i < 0 ? 0 : i;
};
