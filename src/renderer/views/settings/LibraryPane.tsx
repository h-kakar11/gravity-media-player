import { BookOpen, FolderOpen, FolderPlus, Image as ImageIcon, Library, Music2, RefreshCw, Trash2, Tv, Wand2, type LucideIcon } from 'lucide-react';
import { formatRelativeTime } from '@shared/format';
import type { LibraryRoot, RootType } from '@shared/types';
import { invoke } from '../../api';
import { IconButton, Button, Spinner, Switch, Badge } from '../../components/ui';
import { useLibrary } from '../../state/library';
import { toast, useUi } from '../../state/ui';
import { addFolderFlow } from '../Home';
import { CommitText, Group, Row, Select, Stepper, useS } from './parts';

export const ROOT_TYPES: { value: RootType; label: string }[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'video', label: 'Movies & shows' },
  { value: 'music', label: 'Music' },
  { value: 'photos', label: 'Photos' },
  { value: 'comics', label: 'Manga & comics' },
  { value: 'books', label: 'Books' }
];
const TYPE_ICON: Record<RootType, LucideIcon> = { auto: FolderOpen, video: Tv, music: Music2, photos: ImageIcon, comics: Library, books: BookOpen };

function RootRow({ root }: { root: LibraryRoot }) {
  const refresh = useLibrary((s) => s.refreshRoots);
  const patch = async (p: Parameters<typeof invoke<'roots:update'>>[2]) => {
    try { await invoke('roots:update', root.id, p); await refresh(); } catch (err) { toast('error', (err as Error).message); }
  };
  const remove = async () => {
    const ok = await useUi.getState().confirm({ title: `Remove “${root.name}”?`, message: 'Gravity forgets this folder and its watch history and ratings. Your files are not touched.', confirmLabel: 'Remove', destructive: true });
    if (ok) { await invoke('roots:remove', root.id); await refresh(); }
  };
  const Ico = TYPE_ICON[root.type];
  return (
    <div className="root">
      <div className="root__icon"><Ico size={20} strokeWidth={1.7} /></div>
      <div className="root__main">
        <div className="root__top">
          <span className="root__name truncate">{root.name}</span>
          {root.drive !== 'unknown' && <Badge>{root.drive === 'hdd' ? 'Hard drive' : 'Flash storage'}</Badge>}
          {!root.online && <Badge>Not connected</Badge>}
          {!root.enabled && <Badge>Hidden</Badge>}
        </div>
        <div className="root__path truncate secondary t-footnote" title={root.path}>{root.path}</div>
        <div className="root__status t-footnote secondary">
          {root.scanning ? <><Spinner size={12} /> Scanning…</> : root.online ? `${root.itemCount.toLocaleString()} items${root.lastScanAt ? ` · checked ${formatRelativeTime(root.lastScanAt)}` : ''}` : 'Reconnect the drive and Gravity picks up where it left off.'}
        </div>
      </div>
      <div className="root__ctl">
        <Select label={`Content type for ${root.name}`} value={root.type} options={ROOT_TYPES} onChange={(type) => void patch({ type })} />
        <label className="root__toggle t-footnote secondary"><Switch label={`Watch ${root.name} for changes`} checked={root.watch} onChange={(watch) => void patch({ watch })} />Watch</label>
        <label className="root__toggle t-footnote secondary"><Switch label={`Show ${root.name} in the library`} checked={root.enabled} onChange={(enabled) => void patch({ enabled })} />Show</label>
        <IconButton icon={RefreshCw} label={`Rescan ${root.name}`} onClick={() => void invoke('roots:rescan', root.id)} disabled={root.scanning} />
        <IconButton icon={Trash2} label={`Remove ${root.name}`} onClick={() => void remove()} />
      </div>
    </div>
  );
}

export function LibraryPane() {
  const { s, update } = useS();
  const roots = useLibrary((x) => x.roots);
  const lib = s.library;
  const set = (p: Partial<typeof lib>) => update({ library: p });
  const cleanup = async () => {
    const n = await invoke('roots:cleanup');
    toast('success', n ? `Removed ${n} entr${n === 1 ? 'y' : 'ies'} for files that no longer exist` : 'Nothing to clean up');
  };
  return (
    <>
      <Group title="Folders" footer="Gravity reads these folders where they are — nothing is copied or uploaded. Add a folder, or drop one anywhere on the window." action={<Button size="sm" icon={FolderPlus} onClick={() => void addFolderFlow()}>Add Folder…</Button>}>
        {roots.length === 0 ? <div className="srow"><div className="srow__text secondary">No folders yet.</div></div> : roots.map((r) => <RootRow key={r.id} root={r} />)}
      </Group>

      <Group title="Keeping up to date" footer="Gravity compares folder modification times first, so a drive that hasn’t changed isn’t walked again. File-system notifications from the OS replace polling, which lets hard drives stay spun down.">
        <Row label="Scan when Gravity opens"><Switch label="Scan when Gravity opens" checked={lib.scanOnStartup} onChange={(v) => set({ scanOnStartup: v })} /></Row>
        <Row label="Watch folders for changes" hint="New, renamed and removed files show up within a couple of seconds."><Switch label="Watch folders for changes" checked={lib.watch} onChange={(v) => set({ watch: v })} /></Row>
        <Row label="Quick scans" hint="Skip folders whose modification time hasn’t changed."><Switch label="Quick scans" checked={lib.quickScan} onChange={(v) => set({ quickScan: v })} /></Row>
        <Row label="Drive type" hint="Hard drives are read one file at a time, in folder order, to avoid seeking; flash storage is read in parallel. Automatic asks the operating system about each folder. Network shares and virtual disks can’t be identified and get a middle setting.">
          <Select label="Drive type" value={lib.hddMode} options={[{ value: 'auto', label: 'Automatic' }, { value: 'on', label: 'Always gentle (hard drive)' }, { value: 'off', label: 'Always fast (SSD)' }]} onChange={(v) => set({ hddMode: v })} />
        </Row>
        <Row label="Parallel reads" hint="How many files are inspected at once while scanning."><Stepper label="parallel reads" value={lib.scanConcurrency} min={0} max={16} onChange={(v) => set({ scanConcurrency: v })} zeroLabel="Automatic" /></Row>
      </Group>

      <Group title="Metadata & artwork">
        <Row label="Read .nfo files" hint="Titles, plots and ratings from Kodi/Jellyfin-style sidecar files."><Switch label="Read nfo files" checked={lib.useNfo} onChange={(v) => set({ useNfo: v })} /></Row>
        <Row label="Use a video frame when there’s no poster" hint="Picked from the middle of the film, once, then cached."><Switch label="Use video frames as artwork" checked={lib.frameArt} onChange={(v) => set({ frameArt: v })} /></Row>
        <Row label="Seek-bar previews" hint="Thumbnails shown while dragging the timeline. Generating them reads the whole file once.">
          <Select label="Seek-bar previews" value={lib.previews} options={[{ value: 'on-play', label: 'When a video is played' }, { value: 'scan', label: 'While scanning' }, { value: 'off', label: 'Never' }]} onChange={(v) => set({ previews: v })} />
        </Row>
        <Row label="Default type for new folders">
          <Select label="Default type" value={lib.defaultRootType} options={ROOT_TYPES} onChange={(v) => set({ defaultRootType: v })} />
        </Row>
      </Group>

      <Group title="Ignoring files" footer="One pattern per line. * matches any characters. Folders and files whose name matches are skipped.">
        <Row label="Skip hidden files and folders"><Switch label="Skip hidden files" checked={lib.ignoreHidden} onChange={(v) => set({ ignoreHidden: v })} /></Row>
        <Row label="Follow symbolic links"><Switch label="Follow symbolic links" checked={lib.followSymlinks} onChange={(v) => set({ followSymlinks: v })} /></Row>
        <Row label="Ignore patterns" stack>
          <CommitText area mono label="Ignore patterns" value={lib.ignorePatterns.join('\n')} onCommit={(v) => set({ ignorePatterns: v.split('\n').map((x) => x.trim()).filter(Boolean) })} />
        </Row>
      </Group>

      <Group title="Maintenance">
        <Row label="Rescan everything" hint="Re-reads every folder. Only needed if something looks out of date.">
          <Button size="sm" icon={RefreshCw} onClick={() => void invoke('roots:rescan', null, true)}>Full Rescan</Button>
        </Row>
        <Row label="Forget missing files" hint="Items whose files disappeared are kept for 30 days in case a drive comes back. Remove them now.">
          <Button size="sm" icon={Wand2} onClick={() => void cleanup()}>Clean Up</Button>
        </Row>
      </Group>
    </>
  );
}
