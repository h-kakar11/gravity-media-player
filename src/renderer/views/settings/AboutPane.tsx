import { Download, FolderOpen, History, RotateCcw, ScrollText, Upload } from 'lucide-react';
import { invoke } from '../../api';
import { Button } from '../../components/ui';
import { useApp } from '../../state/app';
import { toast, useUi } from '../../state/ui';
import { Group, Row, useS } from './parts';

export function AboutPane() {
  const info = useApp((x) => x.info);
  const { update } = useS();
  const ui = useUi.getState();

  const exportSettings = async () => { const p = await invoke('settings:export'); if (p) toast('success', `Settings saved to ${p}`); };
  const importSettings = async () => {
    try {
      const s = await invoke('settings:import');
      if (s) toast('success', 'Settings imported');
    } catch (err) { toast('error', `Couldn’t read that file: ${(err as Error).message}`); }
  };
  const resetSettings = async () => {
    if (!(await ui.confirm({ title: 'Reset all settings?', message: 'Appearance, playback, shortcuts and everything else go back to the defaults. Your library, history and playlists are kept.', confirmLabel: 'Reset', destructive: true }))) return;
    await invoke('settings:reset');
    toast('success', 'Settings reset');
  };
  const clearHistory = async () => {
    if (!(await ui.confirm({ title: 'Clear watch and listening history?', message: 'Continue Watching, Recently Played and all statistics are emptied. Ratings, notes, favourites and playlists are kept.', confirmLabel: 'Clear History', destructive: true }))) return;
    await invoke('history:clear');
    toast('success', 'History cleared');
  };
  void update;

  return (
    <>
      <Group title="About">
        <div className="about">
          <div className="about__mark" aria-hidden="true"><span /></div>
          <div>
            <div className="t-title-3">Gravity</div>
            <div className="secondary">Version {info?.version ?? '—'} · {info?.platform} {info?.arch}</div>
            <div className="t-footnote tertiary">Electron {info?.electron} · Chromium {info?.chrome}</div>
          </div>
        </div>
        <Row label="Local-first" hint="Gravity has no account, no telemetry and no cloud. Your library database, history and settings are files on this computer. It makes no network requests of its own — artwork and metadata come from your files, tags and sidecar files only." />
        <Row label="Data folder" hint={info?.userDataPath}><Button size="sm" icon={FolderOpen} onClick={() => void invoke('app:open', 'userData')}>Show</Button></Row>
        <Row label="Cache folder" hint={info?.cachePath}><Button size="sm" icon={FolderOpen} onClick={() => void invoke('app:open', 'cache')}>Show</Button></Row>
        <Row label="Open-source licences" hint="Gravity is built on open-source software, including Electron, Chromium, React, ffmpeg (run as a separate program) and sharp."><Button size="sm" icon={ScrollText} onClick={() => void invoke('app:open', 'licenses')}>Show Licences</Button></Row>
      </Group>

      <Group title="Settings file" footer="Settings are stored as plain JSON, so they’re easy to sync or edit by hand.">
        <Row label="Export settings"><Button size="sm" icon={Download} onClick={() => void exportSettings()}>Export…</Button></Row>
        <Row label="Import settings" hint="Unknown or invalid entries in the file are ignored."><Button size="sm" icon={Upload} onClick={() => void importSettings()}>Import…</Button></Row>
        <Row label="Reset all settings"><Button size="sm" variant="danger" icon={RotateCcw} onClick={() => void resetSettings()}>Reset…</Button></Row>
      </Group>

      <Group title="Privacy">
        <Row label="Clear history" hint="Removes watch, listening and reading history and the statistics derived from it."><Button size="sm" variant="danger" icon={History} onClick={() => void clearHistory()}>Clear History…</Button></Row>
      </Group>
    </>
  );
}
