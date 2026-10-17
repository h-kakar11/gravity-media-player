import { ListFilter, Pencil, Play, Shuffle, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { formatDuration } from '@shared/format';
import { invoke } from '../api';
import { Mosaic } from '../components/Artwork';
import { DetailHeader } from '../components/DetailHeader';
import { PageHeader } from '../components/layout';
import { TrackTable } from '../components/TrackTable';
import { Button, EmptyState, IconButton, Spinner } from '../components/ui';
import { useLibraryQuery } from '../lib/hooks';
import { openMedia } from '../lib/actions';
import { navigate } from '../state/router';
import { useLibrary } from '../state/library';
import { useMusic } from '../state/music';
import { openSmartEditor } from '../state/smart';
import { useUi } from '../state/ui';

/** A smart playlist: same page and playback as an ordinary playlist, but its members come from the rules. */
export function SmartPlaylistView({ id }: { id: number }) {
  const { data: entries, error } = useLibraryQuery(() => invoke('smart:items', id), [id]);
  const { data: lists } = useLibraryQuery(() => invoke('smart:list'), [id]);
  const pl = lists?.find((p) => p.id === id);
  const items = useMemo(() => (entries ?? []).map((e) => e.item), [entries]);
  const allAudio = items.length > 0 && items.every((i) => i.kind === 'audio');

  if (error) return <EmptyState icon={ListFilter} title="This smart playlist is gone" message="It may have been deleted." />;
  if (!entries || !pl) return <div className="page-loading"><Spinner size={22} /></div>;

  const del = async () => {
    const ok = await useUi.getState().confirm({ title: `Delete “${pl.name}”?`, message: 'Only the rules are removed. Your media files are not touched.', confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    await invoke('smart:delete', id);
    await useLibrary.getState().refreshPlaylists();
    navigate({ name: 'music', tab: 'playlists' }, { replace: true });
  };
  const playAll = (shuffle = false, from = 0) => {
    const audio = items.filter((i) => i.kind === 'audio');
    const video = items.filter((i) => i.kind === 'video');
    if (audio.length >= video.length) useMusic.getState().playItems(audio, shuffle ? 0 : Math.max(0, audio.findIndex((a) => a.id === items[from]?.id)), { shuffle });
    else openMedia(video[Math.max(0, video.findIndex((v) => v.id === items[from]?.id))]!, video);
  };

  return (
    <>
      <PageHeader title={pl.name} />
      <DetailHeader artMediaId={pl.artMediaIds[0] ?? null} poster={<div className="folder-art"><Mosaic ids={pl.artMediaIds} title={pl.name} kind="audio" /></div>}>
        <div className="t-caps">Smart Playlist</div>
        <h1 className="t-large-title detail__title">{pl.name}</h1>
        <div className="detail__meta secondary"><span>{pl.itemCount} item{pl.itemCount === 1 ? '' : 's'}</span>{pl.durationSec > 0 && <span>{formatDuration(pl.durationSec, { long: true })}</span>}</div>
        <div className="detail__actions">
          <Button variant="primary" size="lg" icon={Play} disabled={items.length === 0} onClick={() => playAll(false)}>Play</Button>
          {allAudio && <Button size="lg" icon={Shuffle} disabled={items.length === 0} onClick={() => playAll(true)}>Shuffle</Button>}
          <IconButton icon={Pencil} label="Edit Rules" className="round" size={18} onClick={() => openSmartEditor(id)} />
          <IconButton icon={Trash2} label="Delete Smart Playlist" className="round" size={18} onClick={() => void del()} />
        </div>
      </DetailHeader>
      <div className="detail-body detail-body--flush">
        {pl.error ? (
          <EmptyState icon={ListFilter} title="These rules can’t be read" message="Edit the rules to fix this smart playlist." />
        ) : items.length === 0 ? (
          <EmptyState icon={ListFilter} title="Nothing matches yet" message="Items appear here automatically as they match the rules. Use Edit Rules to change them." />
        ) : (
          <TrackTable items={items} showArtwork showAlbum onPlay={(i) => playAll(false, i)} />
        )}
      </div>
    </>
  );
}
