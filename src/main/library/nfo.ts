import { XMLParser } from 'fast-xml-parser';

export interface NfoData {
  title?: string;
  year?: number;
  plot?: string;
  genres?: string[];
  season?: number;
  episode?: number;
  showTitle?: string;
}

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true, processEntities: true });

const asArray = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const int = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** Parse a Kodi/Jellyfin style .nfo (movie, episodedetails or tvshow). Returns null for non-XML content. */
export function parseNfo(xml: string): NfoData | null {
  if (!xml.includes('<')) return null;
  try {
    const doc = parser.parse(xml) as Record<string, Record<string, unknown>>;
    const root = doc.movie ?? doc.episodedetails ?? doc.tvshow ?? doc.musicvideo;
    if (!root || typeof root !== 'object') return null;
    const year = int(root.year) ?? int(text(root.premiered)?.slice(0, 4)) ?? int(text(root.releasedate)?.slice(0, 4));
    return {
      title: text(root.title),
      year,
      plot: text(root.plot) ?? text(root.outline),
      genres: asArray(root.genre as string | string[] | undefined).map((g) => text(g)).filter((g): g is string => !!g),
      season: int(root.season),
      episode: int(root.episode),
      showTitle: text(root.showtitle)
    };
  } catch {
    return null;
  }
}
