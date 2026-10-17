import { BookOpen, Disc3, Film, Image as ImageIcon, Library, Music2, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import type { MediaKind } from '@shared/types';
import { artUrl, placeholderGradient, type ArtShape } from '../lib/art';

const KIND_ICON: Record<MediaKind | 'folder' | 'album', LucideIcon> = {
  video: Film, audio: Music2, image: ImageIcon, comic: Library, book: BookOpen, folder: Library, album: Disc3
};

interface Props {
  /** Media id whose artwork to show (null → placeholder). */
  mediaId: number | null;
  hasArt?: boolean;
  title: string;
  kind: MediaKind | 'folder' | 'album';
  shape?: ArtShape | 'auto';
  size?: 'thumb' | 'large';
  version?: number;
  className?: string;
  /** Cover = fill the box; fit = show whole image over a blurred copy of itself. */
  fit?: 'cover' | 'adaptive';
  eager?: boolean;
  alt?: string;
}

const RATIO: Record<ArtShape, string> = { tall: '2 / 3', wide: '16 / 9', square: '1 / 1' };

/**
 * Artwork with graceful fallbacks: a deterministic gradient + icon placeholder while loading or
 * when no image exists, and an "adaptive" mode that letterboxes landscape frames inside portrait
 * cards over a blurred copy so nothing is awkwardly cropped.
 */
export function Artwork({ mediaId, hasArt = true, title, kind, shape = 'auto', size = 'thumb', version = 0, className = '', fit = 'adaptive', eager, alt }: Props) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [natural, setNatural] = useState<number | null>(null);
  const show = hasArt && mediaId != null && state !== 'error';
  const Ico = KIND_ICON[kind];
  const style = shape === 'auto' ? undefined : { aspectRatio: RATIO[shape] };
  const boxRatio = shape === 'tall' ? 2 / 3 : shape === 'wide' ? 16 / 9 : 1;
  const letterbox = fit === 'adaptive' && natural != null && Math.abs(Math.log(natural / boxRatio)) > 0.45;
  const src = show ? artUrl(mediaId!, size, version) : undefined;

  return (
    <div className={`art ${state === 'ready' ? 'is-ready' : ''} ${className}`} style={{ ...style, background: placeholderGradient(title) }}>
      {(!show || state !== 'ready') && (
        <div className="art__placeholder" aria-hidden="true">
          <Ico size={shape === 'wide' ? 28 : 34} strokeWidth={1.4} />
          {!show && shape !== 'square' && <span className="art__initial">{title.slice(0, 1).toUpperCase()}</span>}
        </div>
      )}
      {show && (
        <>
          {letterbox && <img className="art__backdrop" src={src} alt="" aria-hidden="true" />}
          <img
            className={`art__img ${letterbox ? 'is-contain' : ''}`}
            src={src}
            alt={alt ?? ''}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            draggable={false}
            onLoad={(e) => { setState('ready'); setNatural(e.currentTarget.naturalWidth / Math.max(1, e.currentTarget.naturalHeight)); }}
            onError={() => setState('error')}
          />
        </>
      )}
    </div>
  );
}

/** 2×2 mosaic used for folders and playlists. */
export function Mosaic({ ids, title, kind }: { ids: number[]; title: string; kind: MediaKind | 'folder' | 'album' }) {
  if (ids.length === 0) return <Artwork mediaId={null} hasArt={false} title={title} kind={kind} shape="square" />;
  if (ids.length < 4) return <Artwork mediaId={ids[0]!} title={title} kind={kind} shape="square" fit="cover" />;
  return (
    <div className="mosaic" style={{ aspectRatio: '1 / 1' }}>
      {ids.slice(0, 4).map((id) => <Artwork key={id} mediaId={id} title={title} kind={kind} shape="square" fit="cover" />)}
    </div>
  );
}
