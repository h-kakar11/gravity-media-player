import { BookOpen, FolderOpen, Gauge, Globe, Info, Keyboard, Palette, PlayCircle, SlidersHorizontal, Volume2, Wand2, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from '../components/ui';
import { PageHeader } from '../components/layout';
import { navigate } from '../state/router';
import { AboutPane } from './settings/AboutPane';
import { AppearancePane } from './settings/AppearancePane';
import { AudioPane } from './settings/AudioPane';
import { ControlsPane } from './settings/ControlsPane';
import { KeyboardPane } from './settings/KeyboardPane';
import { LibraryPane } from './settings/LibraryPane';
import { MetadataPane } from './settings/MetadataPane';
import { TidyPane } from './settings/TidyPane';
import { Stethoscope } from 'lucide-react';
import { HealthPane } from './settings/HealthPane';
import { PerformancePane } from './settings/PerformancePane';
import { PlaybackPane } from './settings/PlaybackPane';
import { ReadingPane } from './settings/ReadingPane';

const PANES: { id: string; label: string; icon: LucideIcon; render: () => ReactNode }[] = [
  { id: 'library', label: 'Library', icon: FolderOpen, render: () => <LibraryPane /> },
  { id: 'metadata', label: 'Metadata', icon: Globe, render: () => <MetadataPane /> },
  { id: 'tidy', label: 'Tidy Library', icon: Wand2, render: () => <TidyPane /> },
  { id: 'health', label: 'Library Health', icon: Stethoscope, render: () => <HealthPane /> },
  { id: 'appearance', label: 'Appearance', icon: Palette, render: () => <AppearancePane /> },
  { id: 'playback', label: 'Video', icon: PlayCircle, render: () => <PlaybackPane /> },
  { id: 'audio', label: 'Audio', icon: Volume2, render: () => <AudioPane /> },
  { id: 'reading', label: 'Reading', icon: BookOpen, render: () => <ReadingPane /> },
  { id: 'controls', label: 'Controls', icon: SlidersHorizontal, render: () => <ControlsPane /> },
  { id: 'keyboard', label: 'Keyboard', icon: Keyboard, render: () => <KeyboardPane /> },
  { id: 'performance', label: 'Performance', icon: Gauge, render: () => <PerformancePane /> },
  { id: 'about', label: 'Data & About', icon: Info, render: () => <AboutPane /> }
];

export function SettingsView({ pane }: { pane?: string }) {
  const current = PANES.find((p) => p.id === pane) ?? PANES[0]!;
  return (
    <>
      <PageHeader title="Settings" />
      <div className="settings">
        <nav className="settings__nav" aria-label="Settings sections">
          {PANES.map((p) => (
            <button key={p.id} type="button" className={`settings__tab ${p.id === current.id ? 'is-on' : ''}`} aria-current={p.id === current.id ? 'page' : undefined} onClick={() => navigate({ name: 'settings', pane: p.id }, { replace: true })}>
              <Icon as={p.icon} size={16} />
              <span>{p.label}</span>
            </button>
          ))}
        </nav>
        <div className="settings__pane" key={current.id} role="region" aria-label={current.label}>
          <h2 className="t-title-2 settings__title">{current.label}</h2>
          {current.render()}
        </div>
      </div>
    </>
  );
}

