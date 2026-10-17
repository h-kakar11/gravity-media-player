import { BookOpen, Clock, Heart, Image as ImageIcon, Library, Play, Search as SearchIcon, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatDuration, formatRelativeTime } from '@shared/format';
import type { MediaItem, SortKey } from '@shared/types';
import { invoke } from '../api';
import { Artwork } from '../components/Artwork';
import { AlbumCard, ArtistCard, MediaCard, SeriesCard } from '../components/cards';
import { DataTable, type Column } from '../components/DataTable';
import { DetailHeader } from '../components/DetailHeader';
import { PageHeader, Shelf } from '../components/layout';
import { TrackTable } from '../components/TrackTable';
import { Button, EmptyState, ProgressBar, Spinner } from '../components/ui';
import { ViewControls, useViewState, type FilterGroup } from '../components/ViewControls';
import { VirtualGrid } from '../components/VirtualGrid';
import { openMedia, showItemMenu } from '../lib/actions';
import { useLibraryQuery } from '../lib/hooks';
import { subtitleFor } from '../lib/media';
import { compareComicItems } from '../lib/sort';
import { navigate } from '../state/router';
import { useSettings } from '../state/settings';
import { useUi } from '../state/ui';
import { useLibrary } from '../state/library';
import { DRAG_MIME } from '../components/Sidebar';

// ---------------------------------------------------------------------------
// Manga & comics

export function ComicsView() {
  const view = useViewState('comics', { mode: 'grid', sort: 'title' });
  const poster = useSettings((s) => s.settings.appearance.posterSize);
  const sort = (view.sort.key === 'added' ? 'added' : view.sort.key === 'played' ? 'played' : 'title') as 'title' | 'added' | 'played';
  const { data: series } = useLibraryQuery(() => invoke('library:series', { type: 'comic', sort, desc: view.sort.desc }), [sort, view.sort.desc]);
  const columns: Column<NonNullable<typeof series>['items'][number]>[] = [
    { id: 't', header: 'Series', width: 'minmax(220px, 3fr)', sortKey: 'title', render: (s) => <div className="cell-title"><div className="cell-title__art cell-title__art--tall"><Artwork mediaId={s.artMediaId} hasArt={s.artMediaId != null} title={s.title} kind="comic" shape="tall" fit="cover" /></div><div className="truncate t-headline">{s.title}</div></div> },
    { id: 'n', header: 'Volumes', width: '90px', align: 'right', render: (s) => <span className="secondary tabular">{s.episodeCount}</span> },
    { id: 'r', header: 'Read', width: '90px', align: 'right', render: (s) => <span className="secondary tabular">{s.completedCount}/{s.episodeCount}</span> },
    { id: 'a', header: 'Added', width: '120px', sortKey: 'added', align: 'right', hideBelow: 700, render: (s) => <span className="secondary tabular">{new Date(s.addedAt).toLocaleDateString()}</span> }
  ];
  return (
    <>
      <PageHeader title="Manga & Comics" subtitle={series ? `${series.items.length} series` : undefined} />
      <ViewControls state={view} sorts={['title', 'added', 'played']} />
      {!series ? <div className="page-loading"><Spinner size={22} /></div> : series.items.length === 0 ? (
        <EmptyState icon={Library} title="No comics yet" message="CBZ archives and folders of numbered page images become comics. Set a folder’s type to “Manga & Comics” in Settings to treat every image folder as a chapter." />
      ) : view.mode === 'grid' ? (
        <VirtualGrid items={series.items} getKey={(s) => s.key} minWidth={Math.max(110, poster - 40)} aspect={1.5} renderItem={(s) => <SeriesCard series={s} />} />
      ) : (
        <DataTable items={series.items} columns={columns} getKey={(s) => s.key} rowHeight={64} sort={view.sort} onSort={(k) => view.setSort(k as SortKey)} onActivate={(s) => navigate({ name: 'series', key: s.key })} onSelect={() => {}} />
      )}
    </>
  );
}

export function SeriesView({ keyName }: { keyName: string }) {
  const { data: vols } = useLibraryQuery(async () => (await invoke('library:query', { kind: 'comic', series: keyName })).items.sort(compareComicItems), [keyName]);
  if (!vols) return <div className="page-loading"><Spinner size={22} /></div>;
  if (vols.length === 0) return <EmptyState icon={Library} title="Series not found" message="This series is no longer in your library." />;
  const title = vols[0]!.series ?? keyName;
  const next = vols.find((v) => !v.completed && v.progress > 0) ?? vols.find((v) => !v.completed) ?? vols[0]!;
  const art = vols.find((v) => v.hasArt);
  const read = vols.filter((v) => v.completed).length;
  return (
    <>
      <PageHeader title={title} />
      <DetailHeader artMediaId={art?.id ?? null} version={art?.mtimeMs} poster={<Artwork mediaId={art?.id ?? null} hasArt={!!art} title={title} kind="comic" shape="tall" size="large" version={art?.mtimeMs} eager />}>
        <div className="t-caps">Manga & Comics</div>
        <h1 className="t-large-title detail__title">{title}</h1>
        <div className="detail__meta secondary"><span>{vols.length} volume{vols.length === 1 ? '' : 's'}</span><span>{vols.reduce((a, v) => a + v.pages, 0).toLocaleString()} pages</span><span>{read} read</span></div>
        <div className="detail__resume" style={{ maxWidth: 360 }}><ProgressBar value={read / vols.length} /></div>
        <div className="detail__actions">
          <Button variant="primary" size="lg" icon={BookOpen} onClick={() => openMedia(next, vols)}>{next.progress > 0 && !next.completed ? 'Continue Reading' : read === 0 ? 'Start Reading' : 'Read Next'}</Button>
        </div>
      </DetailHeader>
      <div className="detail-body">
        <div className="grid-flow">{vols.map((v) => <MediaCard key={v.id} item={v} queue={vols} shape="tall" width={150} />)}</div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Books

export function BooksView() {
  const view = useViewState('books', { mode: 'grid', sort: 'title' });
  const poster = useSettings((s) => s.settings.appearance.posterSize);
  const { data: books } = useLibraryQuery(async () => (await invoke('library:query', { kind: 'book', sort: view.sort.key, desc: view.sort.desc })).items, [view.sort.key, view.sort.desc]);
  const columns: Column<MediaItem>[] = [
    { id: 't', header: 'Title', width: 'minmax(220px, 3fr)', sortKey: 'title', render: (m) => <div className="cell-title"><div className="cell-title__art cell-title__art--tall"><Artwork mediaId={m.id} hasArt={m.hasArt} title={m.title} kind="book" shape="tall" fit="cover" version={m.mtimeMs} /></div><div className="min0"><div className="truncate t-headline">{m.title}</div><div className="truncate secondary t-footnote">{m.artist ?? ''}</div></div></div> },
    { id: 'p', header: 'Progress', width: '120px', sortKey: 'progress', render: (m) => <div className="row-progress"><ProgressBar value={m.completed ? 1 : m.progress} /><span className="t-footnote secondary tabular">{m.completed ? 'Finished' : `${Math.round(m.progress * 100)}%`}</span></div> },
    { id: 'a', header: 'Added', width: '120px', sortKey: 'added', align: 'right', hideBelow: 700, render: (m) => <span className="secondary tabular">{new Date(m.addedAt).toLocaleDateString()}</span> }
  ];
  return (
    <>
      <PageHeader title="Books" subtitle={books ? `${books.length} book${books.length === 1 ? '' : 's'}` : undefined} />
      <ViewControls state={view} sorts={['title', 'added', 'played', 'progress']} />
      {!books ? <div className="page-loading"><Spinner size={22} /></div> : books.length === 0 ? (
        <EmptyState icon={BookOpen} title="No books yet" message="EPUB books from your library folders appear here, with your place saved automatically." />
      ) : view.mode === 'grid' ? (
        <VirtualGrid items={books} getKey={(m) => m.id} minWidth={Math.max(110, poster - 40)} aspect={1.5} renderItem={(m) => <MediaCard item={m} queue={books} shape="tall" showResume={false} />} />
      ) : (
        <DataTable items={books} columns={columns} getKey={(m) => m.id} rowHeight={64} sort={view.sort} onSort={(k) => view.setSort(k as SortKey)} onActivate={(m) => openMedia(m, books)} onSelect={() => {}} onContext={(e, m) => showItemMenu(e, m, { queue: books })} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Photos

export function PhotosView() {
  const view = useViewState('photos', { mode: 'grid', sort: 'name' });
  const poster = useSettings((s) => s.settings.appearance.posterSize);
  const [folder, setFolder] = useState('all');
  const { data: photos } = useLibraryQuery(async () => (await invoke('library:query', { kind: 'image', sort: view.sort.key, desc: view.sort.desc })).items, [view.sort.key, view.sort.desc]);
  const folders = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of photos ?? []) m.set(p.dir, (m.get(p.dir) ?? 0) + 1);
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  }, [photos]);
  const shown = useMemo(() => (folder === 'all' ? photos : photos?.filter((p) => p.dir === folder)) ?? [], [photos, folder]);
  const filters: FilterGroup[] = folders.length > 1 ? [{
    label: 'Folder', value: folder, onChange: setFolder,
    options: [{ value: 'all', label: `All Photos (${photos?.length ?? 0})` }, ...folders.map(([d, n]) => ({ value: d, label: `${d.split(/[\\/]/).pop()} (${n})` }))]
  }] : [];
  return (
    <>
      <PageHeader title="Photos" subtitle={photos ? `${shown.length.toLocaleString()} item${shown.length === 1 ? '' : 's'}` : undefined} />
      <ViewControls state={view} modes={['grid']} sorts={['name', 'added', 'size']} filters={filters} activeFilters={folder === 'all' ? 0 : 1} />
      {!photos ? <div className="page-loading"><Spinner size={22} /></div> : shown.length === 0 ? (
        <EmptyState icon={ImageIcon} title="No photos yet" message="JPEG, PNG, GIF, WebP, AVIF and more appear here. Pictures that sit beside music or videos are treated as artwork, not photos." />
      ) : (
        <VirtualGrid items={shown} getKey={(m) => m.id} minWidth={Math.max(110, poster - 40)} aspect={1} labelHeight={30} gap={14} renderItem={(m) => <MediaCard item={m} queue={shown} shape="square" subtitle={m.ext === 'gif' ? 'GIF' : undefined} />} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Favourites

export function FavoritesView() {
  const { data } = useLibraryQuery(async () => {
    const q = (kind: MediaItem['kind']) => invoke('library:query', { kind, favorite: true, sort: 'title' });
    const [video, audio, comic, book, image, albums, shows, comicSeries] = await Promise.all([
      q('video'), q('audio'), q('comic'), q('book'), q('image'),
      invoke('library:albums', { favorite: true }), invoke('library:series', { type: 'show', favorite: true }), invoke('library:series', { type: 'comic', favorite: true })
    ]);
    return { video: video.items, audio: audio.items, comic: comic.items, book: book.items, image: image.items, albums: albums.items, shows: shows.items, comicSeries: comicSeries.items };
  }, []);
  if (!data) return <div className="page-loading"><Spinner size={22} /></div>;
  const total = data.video.length + data.audio.length + data.comic.length + data.book.length + data.image.length + data.albums.length + data.shows.length + data.comicSeries.length;
  return (
    <>
      <PageHeader title="Favourites" subtitle={total ? `${total} item${total === 1 ? '' : 's'}` : undefined} />
      {total === 0 ? (
        <EmptyState icon={Heart} title="No favourites yet" message="Tap the heart on any song, video, album, show or book. Favourites are kept on this computer only." />
      ) : (
        <div className="detail-body">
          {data.shows.length > 0 && <Shelf title="TV Shows">{data.shows.map((s) => <SeriesCard key={s.key} series={s} width={164} />)}</Shelf>}
          {data.video.length > 0 && <Shelf title="Videos">{data.video.map((m) => <MediaCard key={m.id} item={m} queue={data.video} shape="tall" width={164} />)}</Shelf>}
          {data.albums.length > 0 && <Shelf title="Albums">{data.albums.map((a) => <AlbumCard key={a.key} album={a} width={164} />)}</Shelf>}
          {data.audio.length > 0 && <><h2 className="t-title-2 section-title">Songs</h2><TrackTable items={data.audio} showArtwork showAlbum /></>}
          {data.comicSeries.length > 0 && <Shelf title="Manga & Comic Series">{data.comicSeries.map((s) => <SeriesCard key={s.key} series={s} width={150} />)}</Shelf>}
          {data.comic.length > 0 && <Shelf title="Volumes">{data.comic.map((m) => <MediaCard key={m.id} item={m} queue={data.comic} shape="tall" width={150} />)}</Shelf>}
          {data.book.length > 0 && <Shelf title="Books">{data.book.map((m) => <MediaCard key={m.id} item={m} queue={data.book} shape="tall" width={150} />)}</Shelf>}
          {data.image.length > 0 && <Shelf title="Photos">{data.image.map((m) => <MediaCard key={m.id} item={m} queue={data.image} shape="square" width={150} />)}</Shelf>}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// History

function dayLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

export function HistoryView() {
  const { data, reload } = useLibraryQuery(() => invoke('history:recent', null, 300), []);
  const groups = useMemo(() => {
    const out: { label: string; items: MediaItem[] }[] = [];
    for (const m of data ?? []) {
      const label = dayLabel(m.lastPlayedAt ?? 0);
      const g = out[out.length - 1];
      if (g && g.label === label) g.items.push(m);
      else out.push({ label, items: [m] });
    }
    return out;
  }, [data]);
  const clear = async () => {
    const ok = await useUi.getState().confirm({ title: 'Clear all history?', message: 'This removes watch history, resume positions and statistics. Favourites, ratings and notes are kept.', confirmLabel: 'Clear History', destructive: true });
    if (!ok) return;
    await invoke('history:clear');
    useLibrary.setState((s) => ({ revision: s.revision + 1 }));
    reload();
  };
  return (
    <>
      <PageHeader title="History" subtitle={data ? `${data.length} recently played` : undefined}>
        {data && data.length > 0 && <Button icon={Trash2} onClick={() => void clear()}>Clear History…</Button>}
      </PageHeader>
      {!data ? <div className="page-loading"><Spinner size={22} /></div> : data.length === 0 ? (
        <EmptyState icon={Clock} title="Nothing played yet" message="Everything you watch, listen to or read shows up here so you can jump straight back in." />
      ) : (
        <div className="history">
          {groups.map((g) => (
            <section key={g.label}>
              <h2 className="t-title-3 history__day">{g.label}</h2>
              <ul className="history__list">
                {g.items.map((m) => (
                  <li key={m.id}>
                    <div className="hrow" role="button" tabIndex={0} onClick={() => openMedia(m, g.items)} onKeyDown={(e) => e.key === 'Enter' && openMedia(m, g.items)} onContextMenu={(e) => showItemMenu(e, m, { queue: g.items })}
                      draggable onDragStart={(e) => { if (m.kind === 'audio' || m.kind === 'video') e.dataTransfer.setData(DRAG_MIME, JSON.stringify([m.id])); }}>
                      <div className={`hrow__art hrow__art--${m.kind}`}><Artwork mediaId={m.id} hasArt={m.hasArt} title={m.title} kind={m.kind} shape={m.kind === 'audio' ? 'square' : m.kind === 'video' ? 'wide' : 'tall'} fit="cover" version={m.mtimeMs} /></div>
                      <div className="hrow__text">
                        <div className="truncate t-headline">{m.title}</div>
                        <div className="truncate secondary t-subhead">{subtitleFor(m)}</div>
                      </div>
                      <div className="hrow__prog">{m.kind !== 'audio' && m.kind !== 'image' && <><ProgressBar value={m.completed ? 1 : m.durationSec ? m.positionSec / m.durationSec : m.progress} /><span className="t-footnote secondary">{m.completed ? 'Played' : m.durationSec && m.positionSec > 10 ? `${formatDuration(m.durationSec - m.positionSec, { long: true })} left` : `${Math.round(m.progress * 100)}%`}</span></>}</div>
                      <time className="hrow__time secondary t-footnote">{formatRelativeTime(m.lastPlayedAt ?? 0)}</time>
                      <span className="hrow__play"><Play size={16} fill="currentColor" strokeWidth={0} /></span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Search

export function SearchView({ q }: { q: string }) {
  const { data, loading } = useLibraryQuery(() => invoke('library:search', q), [q]);
  const videos = data?.media.filter((m) => m.kind === 'video') ?? [];
  const songs = data?.media.filter((m) => m.kind === 'audio') ?? [];
  const reads = data?.media.filter((m) => m.kind === 'comic' || m.kind === 'book') ?? [];
  const photos = data?.media.filter((m) => m.kind === 'image') ?? [];
  const empty = data && !data.media.length && !data.albums.length && !data.series.length && !data.artists.length;
  return (
    <>
      <PageHeader title={`Results for “${q}”`} subtitle={data ? undefined : 'Searching…'} />
      {loading && !data && <div className="page-loading"><Spinner size={22} /></div>}
      {empty && <EmptyState icon={SearchIcon} title="No results" message={`Nothing in your library matches “${q}”. Try fewer letters — search matches the start of words in titles, artists, albums, shows and file names.`} />}
      {data && !empty && (
        <div className="detail-body">
          {data.series.length > 0 && <Shelf title="Shows & Series">{data.series.map((s) => <SeriesCard key={`${s.type}${s.key}`} series={s} width={150} />)}</Shelf>}
          {videos.length > 0 && <Shelf title="Videos">{videos.map((m) => <MediaCard key={m.id} item={m} queue={videos} shape="tall" width={150} />)}</Shelf>}
          {data.albums.length > 0 && <Shelf title="Albums">{data.albums.map((a) => <AlbumCard key={a.key} album={a} width={150} />)}</Shelf>}
          {data.artists.length > 0 && <Shelf title="Artists">{data.artists.map((a) => <ArtistCard key={a.key} artist={a} width={150} />)}</Shelf>}
          {songs.length > 0 && <><h2 className="t-title-2 section-title">Songs</h2><TrackTable items={songs} showArtwork showAlbum /></>}
          {reads.length > 0 && <Shelf title="Comics & Books">{reads.map((m) => <MediaCard key={m.id} item={m} queue={reads} shape="tall" width={140} />)}</Shelf>}
          {photos.length > 0 && <Shelf title="Photos">{photos.map((m) => <MediaCard key={m.id} item={m} queue={photos} shape="square" width={140} />)}</Shelf>}
        </div>
      )}
    </>
  );
}
