import { Heart, ListMusic, MoreHorizontal, Music2, Pencil, Play, Plus, Shuffle, Trash2 } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { formatDuration } from '@shared/format';
import type { AlbumSummary, MediaItem, SortKey } from '@shared/types';
import { invoke } from '../api';
import { Artwork, Mosaic } from '../components/Artwork';
import { AlbumCard, ArtistCard, CardShell, PlaylistCard } from '../components/cards';
import { DataTable, type Column } from '../components/DataTable';
import { DetailHeader } from '../components/DetailHeader';
import { PageHeader, Shelf } from '../components/layout';
import { TrackTable } from '../components/TrackTable';
import { Button, EmptyState, IconButton, Segmented, Spinner } from '../components/ui';
import { ViewControls, useViewState } from '../components/ViewControls';
import { VirtualGrid } from '../components/VirtualGrid';
import { useLibraryQuery } from '../lib/hooks';
import { itemMenu, openMedia } from '../lib/actions';
import { navigate, type MusicTab } from '../state/router';
import { useLibrary } from '../state/library';
import { albumSortKey, sortPlaylists } from '../lib/sort';
import { useMusic } from '../state/music';
import { useSettings } from '../state/settings';
import { toast, useUi } from '../state/ui';

const bump = () => useLibrary.setState((s) => ({ revision: s.revision + 1 }));

export function MusicView({ tab = 'albums' }: { tab?: MusicTab }) {
  const albumsView = useViewState('music-albums', { mode: 'grid', sort: 'title' });
  const songsView = useViewState('music-songs', { mode: 'list', sort: 'title' });
  const playlistsView = useViewState('music-playlists', { mode: 'grid', sort: 'title' });
  const poster = useSettings((s) => s.settings.appearance.posterSize);
  const playlists = useLibrary((s) => s.playlists);

  const albumSort = albumSortKey(albumsView.sort.key);
  const { data: albums } = useLibraryQuery(() => invoke('library:albums', { sort: albumSort, desc: albumsView.sort.desc }), [albumSort, albumsView.sort.desc], { live: true });
  const { data: artists } = useLibraryQuery(() => invoke('library:artists', {}), [tab]);
  const songSortKey = (songsView.sort.key === 'title' ? 'title' : songsView.sort.key) as SortKey;
  const { data: songs } = useLibraryQuery(
    async () => (tab === 'songs' ? (await invoke('library:query', { kind: 'audio', sort: songSortKey, desc: songsView.sort.desc })).items : []),
    [tab, songSortKey, songsView.sort.desc]
  );

  const newPlaylist = async () => {
    const name = await useUi.getState().prompt({ title: 'New Playlist', placeholder: 'My Playlist', confirmLabel: 'Create' });
    if (!name) return;
    const p = await invoke('playlists:create', name);
    await useLibrary.getState().refreshPlaylists();
    navigate({ name: 'playlist', id: p.id });
  };

  const empty = albums && albums.items.length === 0;
  const albumColumns: Column<AlbumSummary>[] = [
    {
      id: 'album', header: 'Album', width: 'minmax(220px, 3fr)', sortKey: 'title',
      render: (a) => <div className="cell-title"><div className="cell-title__art cell-title__art--sq"><Artwork mediaId={a.artMediaId} hasArt={a.artMediaId != null} title={a.album} kind="album" shape="square" fit="cover" /></div><div className="min0"><div className="truncate t-headline">{a.album}</div><div className="truncate secondary t-footnote">{a.artist}</div></div></div>
    },
    { id: 'artist', header: 'Artist', width: 'minmax(120px, 2fr)', sortKey: 'name', hideBelow: 700, render: (a) => <span className="secondary truncate">{a.artist}</span> },
    { id: 'year', header: 'Year', width: '70px', sortKey: 'year', hideBelow: 760, render: (a) => <span className="secondary tabular">{a.year ?? '—'}</span> },
    { id: 'n', header: 'Songs', width: '70px', align: 'right', render: (a) => <span className="secondary tabular">{a.trackCount}</span> },
    { id: 'dur', header: 'Time', width: '80px', align: 'right', hideBelow: 820, render: (a) => <span className="secondary tabular">{formatDuration(a.durationSec)}</span> },
    { id: 'added', header: 'Added', width: '110px', sortKey: 'added', align: 'right', hideBelow: 960, render: (a) => <span className="secondary tabular">{new Date(a.addedAt).toLocaleDateString()}</span> }
  ];

  return (
    <>
      <PageHeader title="Music">
        <Segmented<MusicTab> label="Music category" value={tab} onChange={(t) => navigate({ name: 'music', tab: t }, { replace: true })}
          options={[{ value: 'albums', label: 'Albums' }, { value: 'artists', label: 'Artists' }, { value: 'songs', label: 'Songs' }, { value: 'playlists', label: 'Playlists' }]} />
      </PageHeader>
      {tab === 'albums' && <ViewControls state={albumsView} sorts={['title', 'name', 'added', 'year', 'played']} />}
      {tab === 'songs' && <ViewControls state={songsView} modes={['list']} sorts={['title', 'added', 'duration', 'played']} />}
      {tab === 'playlists' && <ViewControls state={playlistsView} modes={['grid']} sorts={['title', 'added', 'duration']} />}

      {tab === 'albums' && (!albums ? <div className="page-loading"><Spinner size={22} /></div> : empty ? (
        <EmptyState icon={Music2} title="No music yet" message="Songs from your library folders appear here, grouped into albums using their tags — or folder names when tags are missing." />
      ) : albumsView.mode === 'grid' ? (
        <VirtualGrid items={albums.items} getKey={(a) => a.key} minWidth={Math.max(120, poster - 24)} aspect={1} renderItem={(a) => <AlbumCard album={a} />} />
      ) : (
        <DataTable items={albums.items} columns={albumColumns} getKey={(a) => a.key} sort={albumsView.sort} onSort={(k) => albumsView.setSort(k as SortKey)} onActivate={(a) => navigate({ name: 'album', key: a.key })} onSelect={() => {}} />
      ))}

      {tab === 'artists' && (!artists ? <div className="page-loading"><Spinner size={22} /></div> : artists.items.length === 0 ? (
        <EmptyState icon={Music2} title="No artists yet" message="Artists appear once your music has been scanned." />
      ) : (
        <VirtualGrid items={artists.items} getKey={(a) => a.key} minWidth={Math.max(120, poster - 24)} aspect={1} renderItem={(a) => <ArtistCard artist={a} />} />
      ))}

      {tab === 'songs' && (!songs ? <div className="page-loading"><Spinner size={22} /></div> : songs.length === 0 ? (
        <EmptyState icon={Music2} title="No songs yet" message="Songs appear once your music has been scanned." />
      ) : (
        <TrackTable items={songs} showArtwork showAlbum showAdded sort={songsView.sort} onSort={(k) => songsView.setSort(k as SortKey)} />
      ))}

      {tab === 'playlists' && (
        <VirtualGrid
          items={[{ id: -1 } as never, ...sortPlaylists(playlists, playlistsView.sort.key, playlistsView.sort.desc)]} getKey={(p: { id: number }) => p.id} minWidth={Math.max(120, poster - 24)} aspect={1}
          renderItem={(p: { id: number }) => p.id === -1 ? (
            <CardShell title="New Playlist" subtitle="Create a collection" onOpen={() => void newPlaylist()} art={<div className="new-card"><Plus size={34} strokeWidth={1.5} /></div>} />
          ) : <PlaylistCard playlist={p as (typeof playlists)[number]} />}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

export function AlbumView({ keyName }: { keyName: string }) {
  const { data: tracks } = useLibraryQuery(async () => (await invoke('library:query', { kind: 'audio', album: keyName, sort: 'track' })).items, [keyName]);
  const { data: favKeys } = useLibraryQuery(() => invoke('library:favorites', 'album'), [keyName]);
  const moreRef = useRef<HTMLSpanElement>(null);
  if (!tracks) return <div className="page-loading"><Spinner size={22} /></div>;
  if (tracks.length === 0) return <EmptyState icon={Music2} title="Album not found" message="This album is no longer in your library." />;

  const first = tracks[0]!;
  const art = tracks.find((t) => t.hasArt) ?? first;
  const album = first.album ?? 'Unknown Album';
  const artist = first.albumArtist ?? first.artist ?? 'Unknown Artist';
  const total = tracks.reduce((a, t) => a + t.durationSec, 0);
  const year = tracks.map((t) => t.year).find((y) => y != null);
  const fav = favKeys?.includes(keyName) ?? false;
  const discs = new Set(tracks.map((t) => t.discNo ?? 1)).size;
  const play = (shuffle = false) => useMusic.getState().playItems(tracks, 0, { shuffle });

  return (
    <>
      <PageHeader title={album} />
      <DetailHeader artMediaId={art.hasArt ? art.id : null} version={art.mtimeMs} poster={<Artwork mediaId={art.id} hasArt={art.hasArt} title={album} kind="album" shape="square" size="large" version={art.mtimeMs} fit="cover" eager />}>
        <div className="t-caps">Album</div>
        <h1 className="t-large-title detail__title">{album}</h1>
        <button type="button" className="detail__link" onClick={() => navigate({ name: 'artist', key: first.artist ? (first.albumArtist || first.artist).toLowerCase() : '' })}>{artist}</button>
        <div className="detail__meta secondary">
          {first.genre && <span>{first.genre.split(';')[0]}</span>}{year && <span>{year}</span>}<span>{tracks.length} song{tracks.length === 1 ? '' : 's'}</span><span>{formatDuration(total, { long: true })}</span>{discs > 1 && <span>{discs} discs</span>}
        </div>
        <div className="detail__actions">
          <Button variant="primary" size="lg" icon={Play} onClick={() => play(false)}>Play</Button>
          <Button size="lg" icon={Shuffle} onClick={() => play(true)}>Shuffle</Button>
          <IconButton icon={Heart} label={fav ? 'Remove from Favourites' : 'Add to Favourites'} active={fav} className="round" size={18} onClick={() => void invoke('library:favorite', { type: 'album', key: keyName }, !fav).then(bump)} />
          <span ref={moreRef}><IconButton icon={MoreHorizontal} label="More" className="round" size={18} onClick={() => { const r = moreRef.current!.getBoundingClientRect(); useUi.getState().openMenu(r.left, r.bottom + 6, [
            { label: 'Play Next', run: () => { useMusic.getState().playNext(tracks); toast('info', 'Album will play next'); } },
            { label: 'Add to Queue', run: () => { useMusic.getState().addToQueue(tracks); toast('info', 'Added to the queue'); } },
            { label: 'Add to Playlist…', run: () => useUi.getState().openSheet({ type: 'playlist-picker', mediaIds: tracks.map((t) => t.id) }) }
          ]); }} /></span>
        </div>
      </DetailHeader>
      <div className="detail-body detail-body--flush">
        <TrackTable items={tracks} showNumber="track" showArtist={tracks.some((t) => (t.artist ?? '') !== (first.artist ?? ''))} />
      </div>
    </>
  );
}

export function ArtistView({ keyName }: { keyName: string }) {
  const { data: albums } = useLibraryQuery(() => invoke('library:albums', { artistKey: keyName, sort: 'year', desc: true }), [keyName]);
  const { data: songs } = useLibraryQuery(async () => (await invoke('library:query', { kind: 'audio', artistKey: keyName, sort: 'played', desc: true })).items, [keyName]);
  if (!albums || !songs) return <div className="page-loading"><Spinner size={22} /></div>;
  if (songs.length === 0) return <EmptyState icon={Music2} title="Artist not found" message="No songs from this artist are in your library." />;
  const name = songs[0]!.albumArtist ?? songs[0]!.artist ?? 'Unknown Artist';
  const art = albums.items.find((a) => a.artMediaId != null);
  const sorted = [...songs].sort((a, b) => b.playCount - a.playCount || a.sortTitle.localeCompare(b.sortTitle));
  return (
    <>
      <PageHeader title={name} />
      <DetailHeader artMediaId={art?.artMediaId ?? null} poster={<div className="round-art"><Artwork mediaId={art?.artMediaId ?? null} hasArt={!!art} title={name} kind="audio" shape="square" size="large" fit="cover" eager /></div>}>
        <div className="t-caps">Artist</div>
        <h1 className="t-large-title detail__title">{name}</h1>
        <div className="detail__meta secondary"><span>{albums.items.length} album{albums.items.length === 1 ? '' : 's'}</span><span>{songs.length} songs</span><span>{formatDuration(songs.reduce((a, s) => a + s.durationSec, 0), { long: true })}</span></div>
        <div className="detail__actions">
          <Button variant="primary" size="lg" icon={Play} onClick={() => useMusic.getState().playItems(songs, 0)}>Play</Button>
          <Button size="lg" icon={Shuffle} onClick={() => useMusic.getState().playItems(songs, 0, { shuffle: true })}>Shuffle</Button>
        </div>
      </DetailHeader>
      <div className="detail-body">
        <Shelf title="Albums">{albums.items.map((a) => <AlbumCard key={a.key} album={a} width={170} />)}</Shelf>
        <h2 className="t-title-2 section-title">Songs</h2>
        <TrackTable items={sorted.slice(0, 50)} showArtwork showAlbum showArtist={false} onPlay={(i) => useMusic.getState().playItems(sorted.slice(0, 50), i)} />
      </div>
    </>
  );
}

export function PlaylistView({ id }: { id: number }) {
  const { data: entries } = useLibraryQuery(() => invoke('playlists:items', id), [id]);
  const { data: lists } = useLibraryQuery(() => invoke('playlists:list'), [id]);
  const pl = lists?.find((p) => p.id === id);
  const items = useMemo(() => (entries ?? []).map((e) => e.item), [entries]);
  const entryByMedia = useMemo(() => new Map((entries ?? []).map((e) => [e.item.id, e.entryId])), [entries]);
  const allAudio = items.length > 0 && items.every((i) => i.kind === 'audio');

  if (!entries || !pl) return <div className="page-loading"><Spinner size={22} /></div>;

  const rename = async () => {
    const name = await useUi.getState().prompt({ title: 'Rename Playlist', value: pl.name, confirmLabel: 'Rename' });
    if (!name) return;
    await invoke('playlists:update', id, { name });
    await useLibrary.getState().refreshPlaylists();
    bump();
  };
  const del = async () => {
    const ok = await useUi.getState().confirm({ title: `Delete “${pl.name}”?`, message: 'The playlist is removed. The media files themselves are not touched.', confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    await invoke('playlists:delete', id);
    await useLibrary.getState().refreshPlaylists();
    navigate({ name: 'music', tab: 'playlists' }, { replace: true });
  };
  const playAll = (shuffle = false, from = 0) => {
    const audio = items.filter((i) => i.kind === 'audio');
    const video = items.filter((i) => i.kind === 'video');
    if (audio.length >= video.length) useMusic.getState().playItems(audio, shuffle ? 0 : Math.max(0, audio.findIndex((a) => a.id === items[from]?.id)), { shuffle });
    else openMedia(video[0]!, video);
  };
  const reorder = async (fromKey: string, toIndex: number) => {
    const ids = (entries ?? []).map((e) => e.entryId);
    const fromIdx = ids.findIndex((e) => e === entryByMedia.get(Number(fromKey)));
    if (fromIdx < 0) return;
    const [moved] = ids.splice(fromIdx, 1);
    ids.splice(toIndex > fromIdx ? toIndex - 1 : toIndex, 0, moved!);
    await invoke('playlists:reorder', id, ids);
    bump();
  };
  const remove = async (m: MediaItem) => {
    const eid = entryByMedia.get(m.id);
    if (eid == null) return;
    await invoke('playlists:remove', id, [eid]);
    await useLibrary.getState().refreshPlaylists();
    bump();
  };

  return (
    <>
      <PageHeader title={pl.name} />
      <DetailHeader artMediaId={pl.artMediaIds[0] ?? null} poster={<div className="folder-art"><Mosaic ids={pl.artMediaIds} title={pl.name} kind="audio" /></div>}>
        <div className="t-caps">Playlist</div>
        <h1 className="t-large-title detail__title">{pl.name}</h1>
        <div className="detail__meta secondary"><span>{pl.itemCount} item{pl.itemCount === 1 ? '' : 's'}</span>{pl.durationSec > 0 && <span>{formatDuration(pl.durationSec, { long: true })}</span>}</div>
        <div className="detail__actions">
          <Button variant="primary" size="lg" icon={Play} disabled={items.length === 0} onClick={() => playAll(false)}>Play</Button>
          {allAudio && <Button size="lg" icon={Shuffle} disabled={items.length === 0} onClick={() => playAll(true)}>Shuffle</Button>}
          <IconButton icon={Pencil} label="Rename Playlist" className="round" size={18} onClick={() => void rename()} />
          <IconButton icon={Trash2} label="Delete Playlist" className="round" size={18} onClick={() => void del()} />
        </div>
      </DetailHeader>
      <div className="detail-body detail-body--flush">
        {items.length === 0 ? (
          <EmptyState icon={ListMusic} title="This playlist is empty" message="Drag songs or videos here from anywhere in the library, or use “Add to Playlist” in a context menu." />
        ) : (
          <TrackTable items={items} showArtwork showAlbum onPlay={(i) => playAll(false, i)} onReorder={(f, t) => void reorder(f, t)} onRemove={(m) => void remove(m)} />
        )}
      </div>
    </>
  );
}

export { itemMenu };
