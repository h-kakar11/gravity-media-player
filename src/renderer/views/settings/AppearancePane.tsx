import { ArrowDown, ArrowUp } from 'lucide-react';
import { ACCENTS, SIDEBAR_ITEMS, type ThemeName } from '@shared/settings';
import { IconButton, Icon, Segmented, Switch } from '../../components/ui';
import { SIDEBAR } from '../../lib/sidebar';
import { Group, Row, Select, SliderControl, moveItem, useS } from './parts';

const THEMES: { id: ThemeName; label: string; bg: string; side: string; text: string; accent?: boolean }[] = [
  { id: 'system', label: 'Automatic', bg: 'linear-gradient(105deg, #ffffff 50%, #161618 50%)', side: 'linear-gradient(105deg, #f3f3f6 50%, #1e1e22 50%)', text: '#888' },
  { id: 'light', label: 'Light', bg: '#ffffff', side: '#f3f3f6', text: '#1d1d1f' },
  { id: 'dark', label: 'Dark', bg: '#161618', side: '#1e1e22', text: '#f5f5f7' },
  { id: 'midnight', label: 'Midnight', bg: '#000000', side: '#0a0a0b', text: '#f5f5f7' },
  { id: 'paper', label: 'Paper', bg: '#fbf7ef', side: '#f2ecdf', text: '#2b2620' },
  { id: 'contrast', label: 'High Contrast', bg: '#000000', side: '#000000', text: '#ffffff' }
];

export const SHELF_LABELS: Record<string, string> = {
  continueWatching: 'Continue Watching',
  continueReading: 'Continue Reading',
  recentVideos: 'Recently Added Videos',
  recentAlbums: 'New Albums',
  recentlyPlayedMusic: 'Recently Played Music',
  recentComics: 'Manga, Comics & Books',
  favorites: 'Favourites'
};

export function AppearancePane() {
  const { s, update } = useS();
  const a = s.appearance;
  const set = (p: Partial<typeof a>) => update({ appearance: p });
  const hidden = new Set(a.sidebarHidden);
  const order = a.sidebarOrder;
  const shelves = s.home.shelves;

  return (
    <>
      <Group title="Theme">
        <div className="tiles" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={a.theme === t.id} className={`tile ${a.theme === t.id ? 'is-on' : ''}`} onClick={() => set({ theme: t.id })}>
              <span className="tile__preview" style={{ background: t.bg, color: t.text }} aria-hidden="true">
                <span className="tile__side" style={{ background: t.side }} />
                <span className="tile__body"><i style={{ background: 'currentColor', opacity: 0.8, width: '54%' }} /><i style={{ background: 'currentColor', opacity: 0.35, width: '78%' }} /><i className="tile__dot" /></span>
              </span>
              <span className="tile__label">{t.label}</span>
            </button>
          ))}
        </div>
        <Row label="Accent colour" hint="Used for selection, progress and focus. Every accent is checked for readable contrast in light and dark.">
          <div className="swatches swatches--sm" role="radiogroup" aria-label="Accent colour">
            {Object.entries(ACCENTS).map(([id, c]) => (
              <button key={id} type="button" role="radio" aria-checked={a.accent === id} aria-label={c.label} title={c.label} className={`swatch ${a.accent === id ? 'is-on' : ''}`} style={{ background: c.light, ['--ring' as string]: c.light }} onClick={() => set({ accent: id })} />
            ))}
          </div>
        </Row>
        <Row label="Colour from artwork" hint="Tints detail pages and the player with the dominant colour of the cover."><Switch label="Colour from artwork" checked={a.ambient} onChange={(v) => set({ ambient: v })} /></Row>
      </Group>

      <Group title="Size & density">
        <Row label="Text size"><SliderControl label="Text size" value={Math.round(a.textScale * 100)} min={80} max={160} step={5} onChange={(v) => set({ textScale: v / 100 })} format={(v) => `${v}%`} /></Row>
        <Row label="Artwork size" hint="Also ⌘/Ctrl + and − in the library."><SliderControl label="Artwork size" value={a.posterSize} min={110} max={360} step={10} onChange={(v) => set({ posterSize: v })} format={(v) => `${v} px`} /></Row>
        <Row label="Density"><Segmented label="Density" value={a.density} onChange={(v) => set({ density: v })} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} /></Row>
      </Group>

      <Group title="Accessibility" footer="“Automatic” follows your operating system setting.">
        <Row label="Reduce motion" hint="Replaces springs and slides with simple fades.">
          <Select label="Reduce motion" value={a.reduceMotion} options={[{ value: 'system', label: 'Automatic' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} onChange={(v) => set({ reduceMotion: v })} />
        </Row>
        <Row label="Reduce transparency" hint="Uses solid surfaces instead of translucent materials.">
          <Select label="Reduce transparency" value={a.reduceTransparency} options={[{ value: 'system', label: 'Automatic' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} onChange={(v) => set({ reduceTransparency: v })} />
        </Row>
      </Group>

      <Group title="Sidebar" footer="Reorder or hide sections. Playlists always appear below.">
        <Row label="Sidebar width"><Segmented label="Sidebar width" value={a.sidebarSize} onChange={(v) => set({ sidebarSize: v })} options={[{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }]} /></Row>
        {order.map((id, i) => {
          const def = SIDEBAR[id as keyof typeof SIDEBAR];
          if (!def) return null;
          return (
            <div className="srow srow--compact" key={id}>
              <div className="srow__text sorder__label"><Icon as={def.icon} size={16} className="secondary" /><span>{def.label}</span></div>
              <div className="srow__ctl">
                <IconButton icon={ArrowUp} label={`Move ${def.label} up`} disabled={i === 0} onClick={() => set({ sidebarOrder: moveItem(order, i, -1) })} />
                <IconButton icon={ArrowDown} label={`Move ${def.label} down`} disabled={i === order.length - 1} onClick={() => set({ sidebarOrder: moveItem(order, i, 1) })} />
                <Switch label={`Show ${def.label}`} checked={!hidden.has(id)} onChange={(on) => set({ sidebarHidden: on ? a.sidebarHidden.filter((h) => h !== id) : [...a.sidebarHidden, id] })} />
              </div>
            </div>
          );
        })}
      </Group>

      <Group title="Home" footer="Choose which shelves appear on Home and in what order. Empty shelves are hidden automatically.">
        {shelves.map((sh, i) => (
          <div className="srow srow--compact" key={sh.id}>
            <div className="srow__text">{SHELF_LABELS[sh.id] ?? sh.id}</div>
            <div className="srow__ctl">
              <IconButton icon={ArrowUp} label={`Move ${SHELF_LABELS[sh.id] ?? sh.id} up`} disabled={i === 0} onClick={() => update({ home: { shelves: moveItem(shelves, i, -1) } })} />
              <IconButton icon={ArrowDown} label={`Move ${SHELF_LABELS[sh.id] ?? sh.id} down`} disabled={i === shelves.length - 1} onClick={() => update({ home: { shelves: moveItem(shelves, i, 1) } })} />
              <Switch label={`Show ${SHELF_LABELS[sh.id] ?? sh.id}`} checked={sh.enabled} onChange={(enabled) => update({ home: { shelves: shelves.map((x) => (x.id === sh.id ? { ...x, enabled } : x)) } })} />
            </div>
          </div>
        ))}
      </Group>
    </>
  );
}

// Keep the compile-time list of sidebar ids referenced so a new section can't be forgotten here.
void SIDEBAR_ITEMS;
