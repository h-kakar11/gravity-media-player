import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { artUrl, dominantColor } from '../lib/art';

/**
 * Ambient detail header: the artwork's dominant colour washes the top of the page, so every title
 * gets its own atmosphere without any per-title design work.
 */
export function DetailHeader({ artMediaId, version = 0, poster, children, wide }: { artMediaId: number | null; version?: number; poster: ReactNode; children: ReactNode; wide?: boolean }) {
  const [tint, setTint] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setTint(null);
    if (artMediaId != null) void dominantColor(artUrl(artMediaId, 'thumb', version)).then((c) => live && setTint(c));
    return () => { live = false; };
  }, [artMediaId, version]);
  return (
    <header className={`detail ${wide ? 'detail--wide' : ''}`} style={tint ? ({ '--ambient': `rgb(${tint})` } as CSSProperties) : undefined}>
      <div className="detail__wash" aria-hidden="true" />
      <div className="detail__poster">{poster}</div>
      <div className="detail__info">{children}</div>
    </header>
  );
}
