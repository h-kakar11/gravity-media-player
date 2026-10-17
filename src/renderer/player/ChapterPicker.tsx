import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { chapterIndexAt, chapterThumbTime, spriteFrame } from '@shared/chapters';
import { formatDuration } from '@shared/format';
import type { ChapterInfo, SpriteSheet } from '@shared/types';
import { hotkeyCapture } from '../lib/hotkeys';
import '../styles/chapter-thumbs.css';

const SCALE = 0.7;

/** A strip of chapter thumbnails over the player. Picking one jumps to it. */
export function ChapterPicker({ chapters, sprite, time, onPick, onClose }: {
  chapters: ChapterInfo[];
  sprite: SpriteSheet | null;
  /** Current playback time, to mark the chapter being watched. */
  time: number;
  onPick: (startSec: number) => void;
  onClose: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const current = chapterIndexAt(chapters, time);

  // The picker owns the keyboard while it is open so the arrow keys move between chapters
  // instead of skipping through the video behind it.
  useEffect(() => {
    hotkeyCapture.active = true;
    const row = rowRef.current;
    row?.querySelector<HTMLElement>('.is-current')?.focus();
    row?.querySelector<HTMLElement>('.is-current')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const cards = [...(row?.querySelectorAll<HTMLElement>('.chapter-card') ?? [])];
      const at = cards.indexOf(document.activeElement as HTMLElement);
      const next = cards[Math.min(cards.length - 1, Math.max(0, (at < 0 ? current : at) + (e.key === 'ArrowRight' ? 1 : -1)))];
      if (next) { e.preventDefault(); next.focus(); next.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { hotkeyCapture.active = false; document.removeEventListener('keydown', onKey, true); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const w = sprite ? Math.round(sprite.thumbWidth * SCALE) : 168;
  const h = sprite ? Math.round(sprite.thumbHeight * SCALE) : 94;

  return createPortal(
    <div className="chapter-picker-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="chapter-picker" role="dialog" aria-label="Chapters">
        <div className="chapter-picker__head"><h2>Chapters</h2><span>{chapters.length} chapters</span></div>
        <div className="chapter-picker__row" ref={rowRef}>
          {chapters.map((c, i) => {
            const frame = sprite ? spriteFrame(sprite, chapterThumbTime(c)) : null;
            return (
              <button key={c.startSec} type="button" className={`chapter-card ${i === current ? 'is-current' : ''}`} style={{ width: w + 8 }} onClick={() => { onPick(c.startSec); onClose(); }} aria-current={i === current}>
                <div
                  className={`chapter-card__thumb ${frame ? '' : 'chapter-card__thumb--none'}`}
                  style={frame && sprite ? {
                    width: w, height: h, backgroundImage: `url(${frame.url})`,
                    backgroundSize: `${sprite.cols * sprite.thumbWidth * SCALE}px ${sprite.rows * sprite.thumbHeight * SCALE}px`,
                    backgroundPosition: `${frame.x * SCALE}px ${frame.y * SCALE}px`
                  } : { width: w, height: h }}
                >
                  {!frame && i + 1}
                  <span className="chapter-card__time tabular">{formatDuration(c.startSec)}</span>
                </div>
                <div className="chapter-card__title">{c.title || `Chapter ${i + 1}`}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}
