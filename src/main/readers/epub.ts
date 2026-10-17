import { posix } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type { EpubInfo, TocEntry } from '@shared/types';
import type { ZipArchive } from './zip';

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
  removeNSPrefix: true,
  isArray: (name) => ['item', 'itemref', 'meta', 'creator', 'navPoint', 'rootfile', 'subject'].includes(name)
});

type Node = Record<string, unknown>;
const arr = <T,>(v: T | T[] | undefined): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const txt = (v: unknown): string => {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object') {
    const t = (v as Node)['#text'];
    if (typeof t === 'string') return t.trim();
  }
  return '';
};

export interface ParsedEpub {
  opfPath: string;
  baseDir: string;
  title: string;
  author: string;
  language: string;
  description: string;
  series: string | null;
  seriesIndex: number | null;
  direction: 'ltr' | 'rtl' | 'auto';
  fixedLayout: boolean;
  coverPath: string | null;
  spine: { id: string; path: string; size: number }[];
  tocPath: string | null;
  tocKind: 'nav' | 'ncx' | null;
}

/** Resolve a (possibly relative, possibly URL-encoded) href against a base directory inside the zip. */
export function resolveHref(baseDir: string, href: string): string {
  const clean = decodeURIComponent(href.split('#')[0]!.split('?')[0]!);
  return posix.normalize(posix.join(baseDir, clean)).replace(/^\/+/, '');
}

export async function parseEpub(zip: ZipArchive): Promise<ParsedEpub> {
  const container = xml.parse((await zip.read('META-INF/container.xml')).toString('utf8')) as Node;
  const rootfile = arr(((container.container as Node)?.rootfiles as Node)?.rootfile as Node[])[0];
  const opfPath = String(rootfile?.['@_full-path'] ?? '');
  if (!opfPath) throw new Error('Not a valid EPUB (no package document)');
  const baseDir = posix.dirname(opfPath) === '.' ? '' : posix.dirname(opfPath);
  const pkg = (xml.parse((await zip.read(opfPath)).toString('utf8')) as Node).package as Node;
  const metadata = (pkg.metadata ?? {}) as Node;
  const manifestItems = arr((pkg.manifest as Node | undefined)?.item as Node[]);
  const manifest = new Map<string, Node>(manifestItems.map((i) => [String(i['@_id']), i]));
  const metas = arr(metadata.meta as Node[]);

  let coverPath: string | null = null;
  const coverMeta = metas.find((m) => m['@_name'] === 'cover');
  const coverItem =
    manifestItems.find((i) => String(i['@_properties'] ?? '').split(/\s+/).includes('cover-image')) ??
    (coverMeta ? manifest.get(String(coverMeta['@_content'])) : undefined);
  if (coverItem) coverPath = resolveHref(baseDir, String(coverItem['@_href']));

  const spineNode = (pkg.spine ?? {}) as Node;
  const spine = arr(spineNode.itemref as Node[])
    .map((r) => manifest.get(String(r['@_idref'])))
    .filter((i): i is Node => !!i)
    .filter((i) => /x?html|xml/.test(String(i['@_media-type'] ?? '')))
    .map((i) => {
      const path = resolveHref(baseDir, String(i['@_href']));
      return { id: String(i['@_id']), path, size: zip.find(path)?.size ?? 0 };
    });

  const navItem = manifestItems.find((i) => String(i['@_properties'] ?? '').split(/\s+/).includes('nav'));
  const ncxItem = manifest.get(String(spineNode['@_toc'] ?? '')) ?? manifestItems.find((i) => i['@_media-type'] === 'application/x-dtbncx+xml');
  const tocItem = navItem ?? ncxItem;

  const series = metas.find((m) => m['@_name'] === 'calibre:series');
  const seriesIndex = metas.find((m) => m['@_name'] === 'calibre:series_index');
  const pageDir = String(spineNode['@_page-progression-direction'] ?? '');
  const layout = metas.find((m) => m['@_property'] === 'rendition:layout');

  return {
    opfPath,
    baseDir,
    title: txt(metadata.title) || 'Untitled',
    author: arr(metadata.creator as unknown[]).map(txt).filter(Boolean).join(', '),
    language: txt(metadata.language),
    description: txt(metadata.description),
    series: series ? String(series['@_content']) : null,
    seriesIndex: seriesIndex ? parseFloat(String(seriesIndex['@_content'])) || null : null,
    direction: pageDir === 'rtl' ? 'rtl' : pageDir === 'ltr' ? 'ltr' : 'auto',
    fixedLayout: txt(layout) === 'pre-paginated',
    coverPath,
    spine,
    tocPath: tocItem ? resolveHref(baseDir, String(tocItem['@_href'])) : null,
    tocKind: navItem ? 'nav' : ncxItem ? 'ncx' : null
  };
}

// ---------------------------------------------------------------------------
// Table of contents

const navParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
  removeNSPrefix: true,
  preserveOrder: true
});

type PNode = Record<string, unknown>;

function collectText(nodes: PNode[]): string {
  let out = '';
  for (const n of nodes) {
    if (typeof n['#text'] === 'string') out += n['#text'];
    for (const k of Object.keys(n)) if (k !== ':@' && k !== '#text' && Array.isArray(n[k])) out += collectText(n[k] as PNode[]);
  }
  return out.replace(/\s+/g, ' ').trim();
}

function findNode(nodes: PNode[], name: string, pred?: (n: PNode) => boolean): PNode | null {
  for (const n of nodes) {
    if (n[name] && (!pred || pred(n))) return n;
    for (const k of Object.keys(n)) {
      if (k === ':@' || k === '#text' || !Array.isArray(n[k])) continue;
      const hit = findNode(n[k] as PNode[], name, pred);
      if (hit) return hit;
    }
  }
  return null;
}

function parseNavList(ol: PNode[], baseDir: string, indexOfPath: (p: string) => number): TocEntry[] {
  const out: TocEntry[] = [];
  for (const li of ol) {
    if (!li.li) continue;
    const kids = li.li as PNode[];
    const a = kids.find((k) => k.a);
    const sub = kids.find((k) => k.ol);
    const href = String(((a?.[':@'] as Node | undefined)?.['@_href']) ?? '');
    const title = a ? collectText(a.a as PNode[]) : collectText(kids.filter((k) => k.span) as PNode[]);
    const path = href ? resolveHref(baseDir, href) : '';
    out.push({
      title: title || '—',
      href: href ? `${path}${href.includes('#') ? '#' + href.split('#')[1] : ''}` : '',
      spineIndex: path ? indexOfPath(path) : -1,
      children: sub ? parseNavList(sub.ol as PNode[], baseDir, indexOfPath) : []
    });
  }
  return out;
}

function parseNcxPoints(points: Node[], baseDir: string, indexOfPath: (p: string) => number): TocEntry[] {
  return points.map((p) => {
    const src = String(((p.content as Node | undefined)?.['@_src']) ?? '');
    const path = src ? resolveHref(baseDir, src) : '';
    return {
      title: txt((p.navLabel as Node | undefined)?.text) || '—',
      href: src ? `${path}${src.includes('#') ? '#' + src.split('#')[1] : ''}` : '',
      spineIndex: path ? indexOfPath(path) : -1,
      children: parseNcxPoints(arr(p.navPoint as Node[]), baseDir, indexOfPath)
    };
  });
}

export async function readToc(zip: ZipArchive, epub: ParsedEpub): Promise<TocEntry[]> {
  if (!epub.tocPath || !zip.find(epub.tocPath)) return [];
  const indexOfPath = (p: string) => epub.spine.findIndex((s) => s.path === p);
  const baseDir = posix.dirname(epub.tocPath) === '.' ? '' : posix.dirname(epub.tocPath);
  try {
    const raw = (await zip.read(epub.tocPath)).toString('utf8');
    if (epub.tocKind === 'nav') {
      const doc = navParser.parse(raw) as PNode[];
      const nav = findNode(doc, 'nav', (n) => {
        const attrs = (n[':@'] ?? {}) as Node;
        return /toc/.test(String(attrs['@_type'] ?? attrs['@_role'] ?? '')) || !Object.keys(attrs).length;
      });
      const ol = nav ? findNode(nav.nav as PNode[], 'ol') : null;
      return ol ? parseNavList(ol.ol as PNode[], baseDir, indexOfPath) : [];
    }
    const ncx = (xml.parse(raw) as Node).ncx as Node;
    return parseNcxPoints(arr((ncx?.navMap as Node | undefined)?.navPoint as Node[]), baseDir, indexOfPath);
  } catch {
    return [];
  }
}

export async function epubInfo(zip: ZipArchive): Promise<{ info: EpubInfo; parsed: ParsedEpub }> {
  const parsed = await parseEpub(zip);
  const toc = await readToc(zip, parsed);
  const info: EpubInfo = {
    title: parsed.title,
    author: parsed.author,
    language: parsed.language,
    spine: parsed.spine.map((s, i) => ({ index: i, href: s.path, id: s.id, size: s.size })),
    toc,
    direction: parsed.direction,
    fixedLayout: parsed.fixedLayout
  };
  return { info, parsed };
}

/** Plain text of one spine document, for in-book search. */
export async function spineText(zip: ZipArchive, path: string): Promise<string> {
  const raw = (await zip.read(path)).toString('utf8');
  return raw
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}
