import { Clapperboard, Film, Tv } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatBytes, formatDuration } from '@shared/format';
import type { SortKey, MediaItem, SeriesSummary } from '@shared/types';
import { invoke } from '../api';
import { Artwork } from '../components/Artwork';
import { MediaCard, SeriesCard } from '../components/cards';
import { DataTable, type Column } from '../components/DataTable';
import { PageHeader } from '../components/layout';
import { DRAG_MIME } from '../components/Sidebar';
import { Button, EmptyState, Segmented, Spinner } from '../components/ui';
import { ViewControls, useViewState, type FilterGroup } from '../components/ViewControls';
import { VirtualGrid } from '../components/VirtualGrid';
import { openMedia, showItemMenu } from '../lib/actions';
import { sortKey as sortKeyOf } from '@shared/natural-sort';
import { useLibraryQuery } from '../lib/hooks';
import { seriesLabel, subtitleFor } from '../lib/media';
import { navigate, type VideoTab } from '../state/router';
import { useSettings } from '../state/settings';

type Row = { type: 'media'; item: MediaItem } | { type: 'series'; series: SeriesSummary };
const rowKey = (r: Row) => (r.type === 'media' ? `m${r.item.id}` : `s${r.series.key}#${r.series.season}`);
const rowTitle = (r: Row) => (r.type === 'media' ? r.item.title : seriesLabel(r.series));

function sortRows(rows: Row[], key: SortKey, desc: boolean): Row[] {
  const val = (r: Row): number | string => {
    switch (key) {
      case 'added': return r.type === 'media' ? r.item.addedAt : r.series.addedAt;
      case 'played': return (r.type === 'media' ? r.item.lastPlayedAt : r.series.lastPlayedAt) ?? 0;
      case 'year': return (r.type === 'media' ? r.item.year : r.series.year) ?? 0;
      case 'duration': return r.type === 'media' ? r.item.durationSec : 0;
      case 'size': return r.type === 'media' ? r.item.size : 0;
      case 'rating': return r.type === 'media' ? r.item.rating : 0;
      case 'progress': return r.type === 'media' ? r.item.progress : r.series.completedCount / Math.max(1, r.series.episodeCount);
      default: return sortKeyOf(rowTitle(r));
    }
  };
  const out = [...rows].sort((a, b) => {
    const x = val(a), y = val(b);
    const c = typeof x === 'string' ? x.localeCompare(y as string, undefined, { numeric: true }) : (x as number) - (y as number);
    return c || rowTitle(a).localeCompare(rowTitle(b), undefined, { numeric: true });
  });
  return desc ? out.reverse() : out;
}

export function VideosView({ tab = 'all' }: { tab?: VideoTab }) {
  const view = useViewState('videos', { mode: 'grid', sort: 'title' });
  const poster = useSettings((s) => s.settings.appearance.posterSize);
  const [status, setStatus] = useState('any');
  const [resolution, setResolution] = useState('any');
  const [genre, setGenre] = useState('any');
  const [favOnly, setFavOnly] = useState('any');

  const showShows = tab === 'all' || tab === 'shows';
  const showMedia = tab !== 'shows';
  const { data: facets } = useLibraryQuery(() => invoke('library:facets', 'video'), []);
  const { data, loading } = useLibraryQuery(async () => {
    const q = {
      kind: 'video' as const,
      ...(tab === 'movies' ? { vclass: 'movie' as const } : tab === 'clips' ? { vclass: 'clip' as const } : { excludeVclass: 'episode' as const }),
      status: status === 'any' ? undefined : (status as 'unwatched'), resolution: resolution === 'any' ? undefined : (resolution as 'hd'),
      genre: genre === 'any' ? undefined : genre, favorite: favOnly === 'fav' ? true : undefined, sort: 'title' as const
    };
    const [media, series] = await Promise.all([
      showMedia ? invoke('library:query', q) : Promise.resolve({ items: [] as MediaItem[], total: 0 }),
      showShows && status === 'any' && resolution === 'any' && genre === 'any' ? invoke('library:series', { type: 'show', bySeason: true, favorite: favOnly === 'fav' ? true : undefined }) : Promise.resolve({ items: [] as SeriesSummary[], total: 0 })
    ]);
    return { media: media.items, series: series.items };
  }, [tab, status, resolution, genre, favOnly]);

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    return sortRows([...data.series.map((series) => ({ type: 'series', series }) as Row), ...data.media.map((item) => ({ type: 'media', item }) as Row)], view.sort.key, view.sort.desc);
  }, [data, view.sort.key, view.sort.desc]);
  const mediaQueue = useMemo(() => rows.filter((r): r is Extract<Row, { type: 'media' }> => r.type === 'media').map((r) => r.item), [rows]);

  const filters: FilterGroup[] = [
    { label: 'Show', value: status, onChange: setStatus, options: [{ value: 'any', label: 'All' }, { value: 'unwatched', label: 'Unplayed' }, { value: 'inprogress', label: 'In Progress' }, { value: 'completed', label: 'Played' }] },
    { label: 'Resolution', value: resolution, onChange: setResolution, options: [{ value: 'any', label: 'Any' }, { value: 'uhd', label: '4K' }, { value: 'fhd', label: '1080p' }, { value: 'hd', label: '720p' }, { value: 'sd', label: 'SD' }] },
    { label: 'Genre', value: genre, onChange: setGenre, options: [{ value: 'any', label: 'All Genres' }, ...(facets?.genres.slice(0, 14).map((g) => ({ value: g.name, label: g.name })) ?? [])] },
    { label: 'Favourites', value: favOnly, onChange: setFavOnly, options: [{ value: 'any', label: 'Include All' }, { value: 'fav', label: 'Favourites Only' }] }
  ];
  const activeFilters = [status, resolution, genre, favOnly].filter((v) => v !== 'any').length;

  const columns: Column<Row>[] = [
    {
      id: 'title', header: 'Title', width: 'minmax(220px, 3fr)', sortKey: 'title',
      render: (r) => (
        <div className="cell-title">
          <div className="cell-title__art">
            {r.type === 'media'
              ? <Artwork mediaId={r.item.id} hasArt={r.item.hasArt} title={r.item.title} kind="video" shape="wide" fit="cover" version={r.item.mtimeMs} />
              : <Artwork mediaId={r.series.artMediaId} hasArt={r.series.artMediaId != null} title={r.series.title} kind="video" shape="wide" fit="cover" />}
          </div>
          <div className="min0"><div className="truncate t-headline">{rowTitle(r)}</div><div className="truncate secondary t-footnote">{r.type === 'media' ? subtitleFor(r.item) : `${r.series.episodeCount} episode${r.series.episodeCount === 1 ? '' : 's'}`}</div></div>
        </div>
      )
    },
    { id: 'kind', header: 'Kind', width: '110px', hideBelow: 640, render: (r) => <span className="secondary">{r.type === 'series' ? 'TV Season' : r.item.vclass === 'movie' ? 'Movie' : r.item.vclass === 'episode' ? 'Episode' : 'Clip'}</span> },
    { id: 'year', header: 'Year', width: '70px', sortKey: 'year', hideBelow: 720, render: (r) => <span className="secondary tabular">{(r.type === 'media' ? r.item.year : r.series.year) ?? '—'}</span> },
    { id: 'dur', header: 'Duration', width: '100px', sortKey: 'duration', hideBelow: 820, align: 'right', render: (r) => <span className="secondary tabular">{r.type === 'media' ? formatDuration(r.item.durationSec) : `${r.series.episodeCount} eps`}</span> },
    { id: 'size', header: 'Size', width: '90px', sortKey: 'size', hideBelow: 960, align: 'right', render: (r) => <span className="secondary tabular">{r.type === 'media' ? formatBytes(r.item.size) : ''}</span> },
    { id: 'added', header: 'Added', width: '120px', sortKey: 'added', hideBelow: 1080, align: 'right', render: (r) => <span className="secondary tabular">{new Date(r.type === 'media' ? r.item.addedAt : r.series.addedAt).toLocaleDateString()}</span> }
  ];

  const open = (r: Row) => (r.type === 'series' ? navigate({ name: 'show', key: r.series.key, season: r.series.season ?? undefined }) : navigate({ name: 'media', id: r.item.id }));

  return (
    <>
      <PageHeader title="Videos" subtitle={data ? `${rows.length.toLocaleString()} title${rows.length === 1 ? '' : 's'}` : undefined}>
        <Segmented<VideoTab> label="Video category" value={tab} onChange={(t) => navigate({ name: 'videos', tab: t }, { replace: true })}
          options={[{ value: 'all', label: 'All' }, { value: 'movies', label: 'Movies' }, { value: 'shows', label: 'TV Shows' }, { value: 'clips', label: 'Clips' }]} />
      </PageHeader>
      <ViewControls state={view} sorts={['title', 'added', 'year', 'played', 'duration', 'rating', 'progress']} filters={filters} activeFilters={activeFilters} />
      {!data ? (
        <div className="page-loading"><Spinner size={22} /></div>
      ) : rows.length === 0 ? (
        activeFilters > 0 ? (
          <EmptyState icon={Film} title="No matches" message="Nothing matches the current filters.">
            <Button onClick={() => { setStatus('any'); setResolution('any'); setGenre('any'); setFavOnly('any'); }}>Clear Filters</Button>
          </EmptyState>
        ) : (
          <EmptyState icon={tab === 'shows' ? Tv : Clapperboard} title={tab === 'shows' ? 'No TV shows' : 'No videos yet'} message="Videos from your library folders appear here. TV episodes named like “Show – S01E02” are grouped into shows automatically." />
        )
      ) : view.mode === 'grid' ? (
        <div className={loading ? 'is-refreshing' : ''}>
          <VirtualGrid
            items={rows} getKey={rowKey} minWidth={Math.max(120, poster - 24)} aspect={1.5} labelHeight={50}
            renderItem={(r) => (r.type === 'series' ? <SeriesCard series={r.series} /> : <MediaCard item={r.item} queue={mediaQueue} shape="tall" />)}
          />
        </div>
      ) : (
        <DataTable
          items={rows} columns={columns} getKey={rowKey} sort={view.sort} onSort={(k) => view.setSort(k as SortKey)}
          onActivate={(r) => (r.type === 'media' ? openMedia(r.item, mediaQueue) : open(r))}
          onSelect={() => {}} onContext={(e, r) => r.type === 'media' && showItemMenu(e, r.item, { queue: mediaQueue })}
          draggableIds={(r) => (r.type === 'media' ? [r.item.id] : null)} dragMime={DRAG_MIME}
        />
      )}
    </>
  );
}
