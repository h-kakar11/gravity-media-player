import { DatabaseBackup, FolderOpen, MonitorUp, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatBytes } from '@shared/format';
import type { CacheStats } from '@shared/types';
import { invoke } from '../../api';
import { Button, Icon, Switch } from '../../components/ui';
import { useApp } from '../../state/app';
import { toast, useUi } from '../../state/ui';
import { CommitText, Group, Row, Select, useS } from './parts';
import { ProfileBackupRows } from './ProfileBackup';

const CACHE_CHOICES = [512, 1024, 2048, 4096, 8192, 16384, 32768];

export function PerformancePane() {
  const { s, update } = useS();
  const info = useApp((x) => x.info);
  const perf = s.performance;
  const [startup] = useState({ uncappedFps: perf.uncappedFps, hardwareDecode: perf.hardwareDecode });
  const needsRestart = startup.uncappedFps !== perf.uncappedFps || startup.hardwareDecode !== perf.hardwareDecode;
  const [cache, setCache] = useState<CacheStats | null>(null);
  useEffect(() => { void invoke('cache:stats').then(setCache); }, []);

  const clear = async (what: 'art' | 'previews' | 'all') => {
    const label = what === 'art' ? 'artwork' : what === 'previews' ? 'seek previews' : 'all cached artwork and previews';
    if (!(await useUi.getState().confirm({ title: `Clear ${label}?`, message: 'They are regenerated the next time they’re needed. Your media and settings are not affected.', confirmLabel: 'Clear' }))) return;
    setCache(await invoke('cache:clear', what));
  };
  const backup = async () => {
    const path = await invoke('db:backup');
    if (path) toast('success', `Library database saved to ${path}`);
  };
  const pickFfmpeg = async () => {
    const f = await invoke('dialog:pickFile', 'Choose the ffmpeg executable', []);
    if (f) update({ ffmpeg: { path: f, ffprobePath: '' } });
  };

  const ff = info?.ffmpeg;
  const peak = Math.max(60, ...(info?.displays.map((d) => d.refreshRate) ?? [60]));

  return (
    <>
      {needsRestart && (
        <div className="callout" role="status">
          <Icon as={MonitorUp} size={16} />
          <span>These changes take effect the next time Gravity starts.</span>
          <Button size="sm" variant="primary" onClick={() => void invoke('app:relaunch')}>Restart Now</Button>
        </div>
      )}

      <Group title="Display & decoding" footer={`Gravity never limits the frame rate of the file itself: a 120 or 300 fps video is decoded and presented at its own rate. What you actually see is bounded by your display (${info?.displays.map((d) => `${d.refreshRate} Hz`).join(', ') ?? '—'}), the GPU and the decoder — a monitor can’t show frames it doesn’t refresh for. Uncapping removes the browser engine’s own limit, which helps on ${peak > 60 ? 'your high-refresh display' : 'high-refresh displays'}, at the cost of more power use.`}>
        <Row label="Hardware video decoding" hint="Use the GPU for H.264, HEVC, VP9 and AV1 where the driver allows. Turn off if you see green or corrupted frames."><Switch label="Hardware decoding" checked={perf.hardwareDecode} onChange={(v) => update({ performance: { hardwareDecode: v } })} /></Row>
        <Row label="Uncap frame rate" hint="Present frames as fast as they are produced instead of locking to a 60 fps compositor."><Switch label="Uncap frame rate" checked={perf.uncappedFps} onChange={(v) => update({ performance: { uncappedFps: v } })} /></Row>
        {info?.displays.map((d, i) => <Row key={d.id} label={info.displays.length > 1 ? `Display ${i + 1}` : 'Display'} hint={`${d.width} × ${d.height} at ${d.scale}× scale`}><span className="secondary tabular">{d.refreshRate} Hz</span></Row>)}
      </Group>

      <Group title="Cache" footer="Artwork and seek previews are the only things Gravity writes besides its database and settings. They live in one folder and are trimmed, oldest first, to stay under the limit.">
        <Row label="Size limit"><Select label="Cache size limit" value={perf.thumbnailCacheMb} options={[...new Set([...CACHE_CHOICES, perf.thumbnailCacheMb])].sort((a, b) => a - b).map((mb) => ({ value: mb, label: mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB` }))} onChange={(v) => update({ performance: { thumbnailCacheMb: v } })} /></Row>
        <Row label="Artwork" hint="Posters, covers and page thumbnails"><span className="secondary tabular">{cache ? formatBytes(cache.artBytes) : '…'}</span></Row>
        <Row label="Seek previews"><span className="secondary tabular">{cache ? formatBytes(cache.previewBytes) : '…'}</span></Row>
        <Row label="Temporary conversion files"><span className="secondary tabular">{cache ? formatBytes(cache.transcodeBytes) : '…'}</span></Row>
        <Row label="Library database"><span className="secondary tabular">{cache ? formatBytes(cache.dbBytes) : '…'}</span></Row>
        <Row label="Clear cached files">
          <div className="srow__btns">
            <Button size="sm" icon={Trash2} onClick={() => void clear('previews')}>Previews</Button>
            <Button size="sm" icon={Trash2} onClick={() => void clear('art')}>Artwork</Button>
          </div>
        </Row>
      </Group>

      <Group title="ffmpeg" footer="ffmpeg is a separate program that Gravity runs for formats the system can’t play (MKV with DTS or PGS subtitles, AVI, old codecs…), for seek previews and for artwork frames. Gravity looks for your own copy first, then the system PATH, then the build that ships with the app.">
        <Row label="Using" hint={ff?.ffmpegPath ?? 'Not found'}>
          <span className="secondary">{ff?.source === 'none' ? 'Not available' : `${ff?.source === 'bundled' ? 'Bundled' : ff?.source === 'system' ? 'System' : 'Custom'} · ${ff?.version ?? ''}`}</span>
        </Row>
        <Row label="Hardware encoders" hint="Built into this ffmpeg. Gravity test-encodes one before using it and falls back to software if it doesn’t work on this machine.">
          <span className="secondary">{ff && ff.encoders.some((e) => /(videotoolbox|nvenc|qsv|vaapi|amf|_mf)$/.test(e)) ? ff.encoders.filter((e) => /(videotoolbox|nvenc|qsv|vaapi|amf|_mf)$/.test(e)).join(', ') : 'None found'}</span>
        </Row>
        <Row label="Custom ffmpeg">
          <div className="srow__btns">
            {s.ffmpeg.path && <span className="secondary t-footnote truncate" style={{ maxWidth: 220 }} title={s.ffmpeg.path}>{s.ffmpeg.path}</span>}
            <Button size="sm" icon={FolderOpen} onClick={() => void pickFfmpeg()}>Choose…</Button>
            {s.ffmpeg.path && <Button size="sm" variant="plain" icon={RotateCcw} onClick={() => update({ ffmpeg: { path: '', ffprobePath: '' } })}>Automatic</Button>}
          </div>
        </Row>
        <Row label="ffprobe path" hint="Only needed if it isn’t next to ffmpeg."><CommitText label="ffprobe path" mono width={260} placeholder="Automatic" value={s.ffmpeg.ffprobePath} onCommit={(v) => update({ ffmpeg: { ffprobePath: v.trim() } })} /></Row>
      </Group>

      <Group title="Database">
        <Row label="Back up library database" hint="Saves a copy of your library, ratings, history and playlists. Settings export is under Data & About."><Button size="sm" icon={DatabaseBackup} onClick={() => void backup()}>Back Up…</Button></Row>
        <ProfileBackupRows />
      </Group>
    </>
  );
}
