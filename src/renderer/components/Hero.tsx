import { Info, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatDuration } from '@shared/format';
import type { MediaItem } from '@shared/types';
import { artUrl, dominantColor } from '../lib/art';
import { openMedia } from '../lib/actions';
import { resumeLabel, subtitleFor, techBadges } from '../lib/media';
import { navigate } from '../state/router';
import { Artwork } from './Artwork';
import { Button, ProgressBar } from './ui';

/** Apple TV-style feature banner: big artwork, ambient colour wash, one clear primary action. */
export function Hero({ item, queue }: { item: MediaItem; queue: MediaItem[] }) {
  const [tint, setTint] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void dominantColor(artUrl(item.id, 'thumb', item.mtimeMs)).then((c) => live && setTint(c));
    return () => { live = false; };
  }, [item.id, item.mtimeMs]);
  const resume = resumeLabel(item);
  const progress = item.durationSec ? item.positionSec / item.durationSec : item.progress;
  const eyebrow = item.kind === 'video' && item.vclass === 'episode' ? 'Up next' : resume ? 'Continue watching' : 'Featured';
  return (
    <section className="hero" style={tint ? ({ '--ambient': `rgb(${tint})` } as React.CSSProperties) : undefined} aria-label={`${eyebrow}: ${item.title}`}>
      <div className="hero__backdrop" aria-hidden="true">
        <Artwork mediaId={item.id} hasArt={item.hasArt} title={item.title} kind={item.kind} shape="auto" size="large" version={item.mtimeMs} fit="cover" eager className="hero__img" />
        <div className="hero__scrim" />
      </div>
      <div className="hero__content">
        <div className="t-caps hero__eyebrow">{eyebrow}</div>
        <h1 className="hero__title">{item.title}</h1>
        <div className="hero__meta">
          {[subtitleFor(item), ...techBadges(item).slice(0, 3)].filter(Boolean).map((m, i) => <span key={i}>{m}</span>)}
        </div>
        {item.plot && <p className="hero__plot clamp-3">{item.plot}</p>}
        <div className="hero__actions">
          <Button variant="primary" size="lg" icon={Play} onClick={() => openMedia(item, queue)}>{resume ? 'Resume' : 'Play'}</Button>
          <Button size="lg" variant="glass" icon={Info} onClick={() => navigate({ name: 'media', id: item.id })}>Details</Button>
          {resume && (
            <div className="hero__progress">
              <ProgressBar value={progress} />
              <span className="t-footnote">{resume}{item.durationSec ? ` · ${formatDuration(item.durationSec, { long: true })}` : ''}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
