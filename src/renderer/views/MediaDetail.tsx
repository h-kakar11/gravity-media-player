import { CheckCircle2, Circle, Heart, ListPlus, MoreHorizontal, Play, RotateCcw } from 'lucide-react';
import { useRef } from 'react';
import { formatBytes, formatDuration, formatFps, formatResolution } from '@shared/format';
import { audioTrackLabel } from '@shared/playback-plan';
import { invoke } from '../api';
import { Artwork } from '../components/Artwork';
import { MediaCard } from '../components/cards';
import { DetailHeader } from '../components/DetailHeader';
import { PageHeader, Shelf } from '../components/layout';
import { Badge, Button, EmptyState, IconButton, ProgressBar, Rating, Spinner } from '../components/ui';
import { itemMenu, openMedia, setWatched, toggleFavorite, addToPlaylist } from '../lib/actions';
import { useLibraryQuery } from '../lib/hooks';
import { artShape } from '../lib/art';
import { resumeLabel, techBadges } from '../lib/media';
import { navigate } from '../state/router';
import { useLibrary } from '../state/library';
import { useUi } from '../state/ui';
import { Film } from 'lucide-react';

export function MediaDetailView({ id }: { id: number }) {
  const { data: item, loading } = useLibraryQuery(async () => (await invoke('library:get', [id]))[0], [id]);
  const { data: probe } = useLibraryQuery(() => invoke('playback:probe', id).catch(() => null), [id], { live: false });
  const { data: subs } = useLibraryQuery(() => invoke('playback:subtitles', id).catch(() => []), [id], { live: false });
  const { data: related } = useLibraryQuery(async () => {
    const it = (await invoke('library:get', [id]))[0];
    if (!it) return [];
    const q = it.vclass === 'episode' && it.series ? { kind: 'video' as const, series: it.series.toLowerCase(), sort: 'episode' as const } : { kind: it.kind, dir: it.dir, sort: 'name' as const };
    return (await invoke('library:query', { ...q, limit: 40 })).items.filter((m) => m.id !== id);
  }, [id]);
  const moreRef = useRef<HTMLSpanElement>(null);

  if (!item) return loading ? <div className="page-loading"><Spinner size={22} /></div> : <EmptyState icon={Film} title="Not found" message="This item is no longer in your library." />;

  const resume = resumeLabel(item);
  const progress = item.durationSec ? item.positionSec / item.durationSec : item.progress;
  const audios = probe?.streams.filter((s) => s.type === 'audio') ?? [];
  const video = probe?.streams.find((s) => s.type === 'video' && !s.attachedPic);
  const meta = [
    item.vclass === 'episode' ? item.series : null,
    item.vclass === 'episode' && item.episode != null ? `S${item.season ?? 1} · E${item.episode}` : null,
    item.genre?.split(';')[0],
    item.year ? String(item.year) : null,
    item.durationSec ? formatDuration(item.durationSec, { long: true }) : null
  ].filter((m): m is string => !!m);

  return (
    <>
      <PageHeader title={item.title} />
      <DetailHeader
        artMediaId={item.hasArt ? item.id : null} version={item.mtimeMs}
        wide={artShape(item) === 'wide'}
        poster={<Artwork mediaId={item.id} hasArt={item.hasArt} title={item.title} kind={item.kind} shape={artShape(item)} size="large" version={item.mtimeMs} eager />}
      >
        <div className="t-caps">{item.vclass === 'episode' ? 'Episode' : item.vclass === 'movie' ? 'Movie' : 'Video'}</div>
        <h1 className="t-large-title detail__title">{item.title}</h1>
        <div className="detail__meta secondary">{meta.map((m, i) => <span key={i}>{m}</span>)}</div>
        <div className="detail__badges">
          {techBadges(item).map((b) => <Badge key={b}>{b}</Badge>)}
        </div>
        <div className="detail__actions">
          <Button variant="primary" size="lg" icon={Play} onClick={() => openMedia(item, related ? [item, ...related] : [item])}>{resume ? 'Resume' : 'Play'}</Button>
          {resume && <Button size="lg" icon={RotateCcw} onClick={() => openMedia(item, [item], { fromStart: true })}>From Beginning</Button>}
          <IconButton icon={Heart} label={item.favorite ? 'Remove from Favourites' : 'Add to Favourites'} active={item.favorite} onClick={() => void toggleFavorite(item)} className="round" size={18} />
          <IconButton icon={item.completed ? CheckCircle2 : Circle} label={item.completed ? 'Mark as Unplayed' : 'Mark as Played'} active={item.completed} onClick={() => void setWatched([item], !item.completed)} className="round" size={18} />
          <IconButton icon={ListPlus} label="Add to Playlist" onClick={() => void addToPlaylist([item.id])} className="round" size={18} />
          <span ref={moreRef}><IconButton icon={MoreHorizontal} label="More" className="round" size={18} onClick={() => { const r = moreRef.current!.getBoundingClientRect(); useUi.getState().openMenu(r.left, r.bottom + 6, itemMenu(item)); }} /></span>
        </div>
        {resume && <div className="detail__resume"><ProgressBar value={progress} /><span className="t-footnote secondary">{resume}</span></div>}
        {item.plot && <p className="detail__plot">{item.plot}</p>}
      </DetailHeader>

      <div className="detail-body">
        <section className="facts" aria-label="Details">
          <Fact label="Video" value={video ? `${formatResolution(video.width, video.height)} · ${video.codec.toUpperCase()}${video.bitDepth > 8 ? ` ${video.bitDepth}-bit` : ''}${video.fps ? ` · ${formatFps(video.fps)}` : ''}` : item.vcodec.toUpperCase()} />
          <Fact label="Audio" value={audios.length ? audios.map((a, i) => audioTrackLabel(a, i)).join('\n') : item.acodec.toUpperCase()} />
          <Fact label="Subtitles" value={subs && subs.length ? subs.map((s) => s.label).join('\n') : 'None'} />
          <Fact label="File" value={`${item.container.toUpperCase()} · ${formatBytes(item.size)}`} sub={item.path} />
          {probe && probe.chapters.length > 0 && <Fact label="Chapters" value={`${probe.chapters.length} chapters`} sub={probe.chapters.slice(0, 4).map((c) => c.title).filter(Boolean).join(', ')} />}
        </section>
        <section className="detail-notes">
          <div><div className="t-caps">Your rating</div><Rating value={item.rating} size={20} onChange={(v) => void invoke('state:update', item.id, { rating: v }).then(() => useLibrary.setState((s) => ({ revision: s.revision + 1 })))} /></div>
          <label>
            <span className="t-caps">Notes</span>
            <textarea className="field field--area" rows={3} placeholder="Write something to remember about this title…" defaultValue={item.notes} onBlur={(e) => { if (e.target.value !== item.notes) void invoke('state:update', item.id, { notes: e.target.value }); }} />
          </label>
        </section>
        {related && related.length > 0 && (
          <Shelf title={item.vclass === 'episode' ? 'More Episodes' : 'More in This Folder'}>
            {related.map((m) => <MediaCard key={m.id} item={m} queue={related} shape="wide" width={240} />)}
          </Shelf>
        )}
      </div>
    </>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="fact">
      <div className="t-caps">{label}</div>
      <div className="fact__value">{value.split('\n').map((l, i) => <div key={i}>{l}</div>)}</div>
      {sub && <div className="fact__sub truncate secondary t-footnote" title={sub}>{sub}</div>}
    </div>
  );
}

export { navigate };
