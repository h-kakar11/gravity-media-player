import type { ChapterInfo, MediaItem } from './types';

/** Skippable stretches of an episode: the opening and the closing credits. */
export type SkipKind = 'intro' | 'credits';

/**
 * What the user has marked for a show, remembered for its other episodes. The intro is an
 * absolute stretch (openings sit at about the same point in each episode); the credits are
 * measured back from the end because episodes differ in length.
 */
export interface SkipMarkers {
  intro?: { start: number; end: number };
  credits?: { fromEnd: number };
}

export interface SkipSegment {
  kind: SkipKind;
  start: number;
  end: number;
  /** Where the range came from: a chapter in this file, or markers saved for the show. */
  source: 'chapter' | 'saved';
}

/** The key markers are saved under: the show's name, case- and spacing-insensitive. Null for anything that isn't an episode of a show. */
export function showKey(item: Pick<MediaItem, 'vclass' | 'series'> | null | undefined): string | null {
  if (!item || item.vclass !== 'episode' || !item.series) return null;
  const key = item.series.trim().toLowerCase().replace(/\s+/g, ' ');
  return key || null;
}

const INTRO_TITLE = /^(intro(duction)?|opening|op\d*|title sequence|main title|theme( song)?)(\b|$)/i;
const CREDITS_TITLE = /^(end(ing)?( credits)?|(closing |end |rolling )?credits|outro|ed\d*)(\b|$)/i;

/** Longest stretch an opening can plausibly be, so a chapter called "Intro" covering half the film is ignored. */
const MAX_INTRO_SEC = 300;
const MIN_SEGMENT_SEC = 5;

/** Find an opening and closing credits among a file's chapters, going by their titles and where they sit. */
export function detectFromChapters(chapters: ChapterInfo[], duration: number): SkipSegment[] {
  if (!(duration > 0)) return [];
  const out: SkipSegment[] = [];
  const intro = chapters.find((c) => INTRO_TITLE.test(c.title.trim()) && c.startSec < duration * 0.3 && c.endSec - c.startSec >= MIN_SEGMENT_SEC && c.endSec - c.startSec <= MAX_INTRO_SEC);
  if (intro) out.push({ kind: 'intro', start: intro.startSec, end: intro.endSec, source: 'chapter' });
  const credits = chapters.find((c) => CREDITS_TITLE.test(c.title.trim()) && c.startSec >= duration * 0.6 && duration - c.startSec >= MIN_SEGMENT_SEC);
  if (credits) out.push({ kind: 'credits', start: credits.startSec, end: duration, source: 'chapter' });
  return out;
}

/** Segments for the episode being played. Chapters in the file win over markers saved for the show. */
export function resolveSegments(chapters: ChapterInfo[], duration: number, saved: SkipMarkers | undefined): SkipSegment[] {
  if (!(duration > 0)) return [];
  const out = detectFromChapters(chapters, duration);
  const has = (k: SkipKind) => out.some((s) => s.kind === k);
  if (saved?.intro && !has('intro') && saved.intro.end <= duration && saved.intro.end - saved.intro.start >= MIN_SEGMENT_SEC) {
    out.push({ kind: 'intro', start: saved.intro.start, end: saved.intro.end, source: 'saved' });
  }
  if (saved?.credits && !has('credits') && saved.credits.fromEnd >= MIN_SEGMENT_SEC && saved.credits.fromEnd <= duration * 0.4) {
    out.push({ kind: 'credits', start: duration - saved.credits.fromEnd, end: duration, source: 'saved' });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The segment to offer skipping at time `t`, if any. The last couple of seconds don't count: there is nothing left to skip. */
export function segmentAt(segments: SkipSegment[], t: number): SkipSegment | null {
  return segments.find((s) => t >= s.start - 0.25 && t < s.end - 2) ?? null;
}

/** Where to jump to when skipping `seg`. */
export const skipTarget = (seg: SkipSegment): number => seg.end;

export type MarkResult = { ok: true; markers: SkipMarkers } | { ok: false; reason: string };

/** Save the intro's start and end. The end has to come after the start, and the stretch can't be absurdly long. */
export function withIntro(markers: SkipMarkers | undefined, start: number, end: number): MarkResult {
  if (!(end > start)) return { ok: false, reason: 'The intro must end after it starts' };
  if (end - start < MIN_SEGMENT_SEC) return { ok: false, reason: `An intro shorter than ${MIN_SEGMENT_SEC} s isn't worth skipping` };
  if (end - start > MAX_INTRO_SEC) return { ok: false, reason: 'That is too long for an intro' };
  return { ok: true, markers: { ...markers, intro: { start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10 } } };
}

/** Save where the credits begin, as a distance from the end of this episode. */
export function withCredits(markers: SkipMarkers | undefined, t: number, duration: number): MarkResult {
  const fromEnd = duration - t;
  if (!(duration > 0) || fromEnd < MIN_SEGMENT_SEC) return { ok: false, reason: 'Mark the credits at least a few seconds before the end' };
  if (fromEnd > duration * 0.4) return { ok: false, reason: 'The credits can only take up the last 40% of an episode' };
  return { ok: true, markers: { ...markers, credits: { fromEnd: Math.round(fromEnd) } } };
}

/** Coerce a value read from the settings file into markers, dropping anything malformed. */
export function sanitizeMarkers(v: unknown): SkipMarkers | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const out: SkipMarkers = {};
  const i = o.intro as Record<string, unknown> | undefined;
  if (i && typeof i === 'object' && Number.isFinite(i.start) && Number.isFinite(i.end) && (i.start as number) >= 0 && (i.end as number) > (i.start as number)) {
    out.intro = { start: i.start as number, end: i.end as number };
  }
  const c = o.credits as Record<string, unknown> | undefined;
  if (c && typeof c === 'object' && Number.isFinite(c.fromEnd) && (c.fromEnd as number) > 0) out.credits = { fromEnd: c.fromEnd as number };
  return out;
}
