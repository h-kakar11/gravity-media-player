const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Natural ("Page 2" < "Page 10") comparison used for page order, chapters and file names. */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b);
}

/** Sort key that ignores leading articles and punctuation ("The Matrix" -> "matrix"). */
export function sortKey(title: string): string {
  const t = title.trim().toLowerCase().replace(/^[^\p{L}\p{N}]+/u, '');
  return t.replace(/^(the|a|an|der|die|das|le|la|les|el|los|las)\s+/i, '');
}
