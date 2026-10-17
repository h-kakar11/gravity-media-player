import { Segmented, Switch } from '../../components/ui';
import { READER_BG } from '../../readers/shared';
import { Group, Row, Select, SliderControl, useS } from './parts';

export function ReadingPane() {
  const { s, update } = useS();
  const r = s.reader;
  const e = r.epub;
  const set = (p: Partial<typeof r>) => update({ reader: p });
  const setE = (p: Partial<typeof e>) => update({ reader: { epub: p } });
  return (
    <>
      <Group title="Manga & comics" footer="You can also change these while reading with the settings button, or with R (direction), V (layout) and W (fit).">
        <Row label="Layout"><Segmented label="Page layout" value={r.mode} onChange={(v) => set({ mode: v })} options={[{ value: 'single', label: 'Single page' }, { value: 'double', label: 'Two pages' }, { value: 'scroll', label: 'Scroll' }]} /></Row>
        <Row label="Reading direction" hint="Right to left for manga: pages, arrow keys and the progress bar all flip."><Segmented label="Reading direction" value={r.direction} onChange={(v) => set({ direction: v })} options={[{ value: 'ltr', label: 'Left to right' }, { value: 'rtl', label: 'Right to left' }]} /></Row>
        <Row label="Fit pages to"><Select label="Fit" value={r.fit} options={[{ value: 'screen', label: 'Whole page' }, { value: 'width', label: 'Width' }, { value: 'height', label: 'Height' }, { value: 'original', label: 'Original size' }]} onChange={(v) => set({ fit: v })} /></Row>
        <Row label="Keep the cover on its own page" hint="So two-page spreads line up with the story."><Switch label="Cover alone" checked={r.coverAlone} onChange={(v) => set({ coverAlone: v })} /></Row>
        <Row label="Background">
          <div className="swatches swatches--sm" role="radiogroup" aria-label="Reader background">
            {(['black', 'dark', 'sepia', 'white'] as const).map((b) => (
              <button key={b} type="button" role="radio" aria-checked={r.background === b} aria-label={b} title={b} className={`swatch ${r.background === b ? 'is-on' : ''}`} style={{ background: READER_BG[b], ['--ring' as string]: 'var(--accent)' }} onClick={() => set({ background: b })} />
            ))}
          </div>
        </Row>
        <Row label="Pages to load ahead" hint="Higher values feel faster on slow drives, at the cost of memory."><SliderControl label="Preload pages" value={r.preload} min={0} max={10} onChange={(v) => set({ preload: v })} format={(v) => `${v}`} /></Row>
      </Group>

      <Group title="Books (EPUB)">
        <Row label="Theme"><Select label="Book theme" value={e.theme} options={[{ value: 'auto', label: 'Match Gravity' }, { value: 'light', label: 'Light' }, { value: 'sepia', label: 'Sepia' }, { value: 'dark', label: 'Dark' }, { value: 'black', label: 'Black' }]} onChange={(v) => setE({ theme: v })} /></Row>
        <Row label="Font"><Segmented label="Font" value={e.fontFamily} onChange={(v) => setE({ fontFamily: v })} options={[{ value: 'serif', label: 'Serif' }, { value: 'sans', label: 'Sans' }, { value: 'mono', label: 'Mono' }, { value: 'publisher', label: 'Book’s own' }]} /></Row>
        <Row label="Text size"><SliderControl label="Text size" value={Math.round(e.fontSize * 100)} min={70} max={240} step={5} onChange={(v) => setE({ fontSize: v / 100 })} format={(v) => `${v}%`} /></Row>
        <Row label="Line spacing"><SliderControl label="Line spacing" value={Math.round(e.lineHeight * 10)} min={11} max={24} onChange={(v) => setE({ lineHeight: v / 10 })} format={(v) => (v / 10).toFixed(1)} /></Row>
        <Row label="Margins"><SliderControl label="Margins" value={e.margin} min={0} max={20} onChange={(v) => setE({ margin: v })} format={(v) => `${v}%`} /></Row>
        <Row label="Flow"><Segmented label="Flow" value={e.flow} onChange={(v) => setE({ flow: v })} options={[{ value: 'paginated', label: 'Pages' }, { value: 'scrolled', label: 'Scroll' }]} /></Row>
        <Row label="Justify text"><Switch label="Justify text" checked={e.justify} onChange={(v) => setE({ justify: v })} /></Row>
      </Group>
    </>
  );
}
