import type { MediaItem } from '@shared/types';

export type ArtShape = 'wide' | 'tall' | 'square';

export const artUrl = (mediaId: number, size: 'thumb' | 'large' = 'thumb', version = 0) =>
  `gravity://app/art/${mediaId}?s=${size}&v=${Math.round(version)}`;

export const mediaUrl = (mediaId: number) => `gravity://app/media/${mediaId}`;

/** Natural shape of an item's artwork, used to choose card proportions. */
export function artShape(item: Pick<MediaItem, 'kind' | 'vclass' | 'hasArt'>): ArtShape {
  switch (item.kind) {
    case 'audio': return 'square';
    case 'video': return item.vclass === 'movie' ? 'tall' : 'wide';
    case 'comic': case 'book': return 'tall';
    default: return 'wide';
  }
}

/** Deterministic gradient so items without artwork still look intentional. */
export function placeholderGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const hue2 = (hue + 38 + (h % 40)) % 360;
  return `linear-gradient(145deg, hsl(${hue} 46% 34%), hsl(${hue2} 52% 22%))`;
}

const colorCache = new Map<string, string>();

/**
 * Dominant vivid colour of an image, sampled on a tiny canvas. Powers the ambient glow behind
 * detail pages and Now Playing. Returns CSS `r g b` triplet.
 */
export function dominantColor(url: string): Promise<string | null> {
  const hit = colorCache.get(url);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 24;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let r = 0, g = 0, b = 0, wsum = 0;
        for (let i = 0; i < data.length; i += 4) {
          const R = data[i]!, G = data[i + 1]!, B = data[i + 2]!;
          const max = Math.max(R, G, B), min = Math.min(R, G, B);
          const sat = max === 0 ? 0 : (max - min) / max;
          const lum = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;
          // Prefer saturated, mid-brightness pixels; ignore near-black and near-white.
          const w = sat * sat * (1 - Math.abs(lum - 0.5) * 1.6) + 0.02;
          if (w > 0) { r += R * w; g += G * w; b += B * w; wsum += w; }
        }
        const out = wsum > 0 ? `${Math.round(r / wsum)} ${Math.round(g / wsum)} ${Math.round(b / wsum)}` : null;
        if (out) colorCache.set(url, out);
        resolve(out);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
