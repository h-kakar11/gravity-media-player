import { FolderPlus, Sparkles } from 'lucide-react';
import { invoke } from '../api';
import { AlbumCard, MediaCard } from '../components/cards';
import { Hero } from '../components/Hero';
import { PageHeader, Shelf } from '../components/layout';
import { Button, EmptyState, Spinner } from '../components/ui';
import { useLibraryQuery } from '../lib/hooks';
import { navigate } from '../state/router';
import { useLibrary } from '../state/library';
import { useSettings } from '../state/settings';
import { toast } from '../state/ui';

export async function addFolderFlow(): Promise<void> {
  try {
    const root = await invoke('roots:add', null);
    if (root) toast('success', `Added “${root.name}” — scanning now`);
  } catch (err) {
    toast('error', (err as Error).message);
  }
}

export function HomeView() {
  const roots = useLibrary((s) => s.roots);
  const rootsLoaded = useLibrary((s) => s.rootsLoaded);
  const scan = useLibrary((s) => s.scan);
  const shelves = useSettings((s) => s.settings.home.shelves);
  const { data, loading } = useLibraryQuery(() => invoke('library:home'), []);

  if (rootsLoaded && roots.length === 0) {
    return (
      <>
        <PageHeader title="Home" />
        <div className="welcome">
          <div className="welcome__orb" aria-hidden="true" />
          <EmptyState icon={Sparkles} title="Welcome to Gravity" message="Add the folders that hold your movies, shows, music, comics and books. Gravity reads them in place, keeps itself up to date, and never uploads anything.">
            <Button variant="primary" size="lg" icon={FolderPlus} onClick={() => void addFolderFlow()}>Add Library Folder…</Button>
            <p className="t-footnote tertiary">You can also drop a folder anywhere on this window.</p>
          </EmptyState>
        </div>
      </>
    );
  }

  const total = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : 0;
  if (data && total === 0) {
    return (
      <>
        <PageHeader title="Home" />
        <EmptyState icon={scan ? Sparkles : FolderPlus} title={scan ? 'Reading your library…' : 'Nothing here yet'} message={scan ? `${scan.scanned.toLocaleString()} files looked at so far. Items appear as they are found.` : 'Your folders don’t contain any media Gravity recognises yet. Add another folder or check that the drive is connected.'}>
          {scan ? <Spinner size={22} /> : <Button icon={FolderPlus} onClick={() => void addFolderFlow()}>Add Library Folder…</Button>}
        </EmptyState>
      </>
    );
  }
  if (!data) return <><PageHeader title="Home" /><div className="page-loading"><Spinner size={22} /></div></>;

  const heroCandidates = [...data.continueWatching, ...data.recentVideos].filter((m) => m.hasArt);
  const hero = heroCandidates[0];
  const heroQueue = hero && data.continueWatching.includes(hero) ? data.continueWatching : data.recentVideos;

  const render: Record<string, React.ReactNode> = {
    continueWatching: data.continueWatching.length ? (
      <Shelf key="cw" title="Continue Watching">
        {data.continueWatching.map((m) => <MediaCard key={m.id} item={m} queue={data.continueWatching} shape="wide" width={296} playOnClick showResume />)}
      </Shelf>
    ) : null,
    continueReading: data.continueReading.length ? (
      <Shelf key="cr" title="Continue Reading">
        {data.continueReading.map((m) => <MediaCard key={m.id} item={m} queue={data.continueReading} shape="tall" width={150} />)}
      </Shelf>
    ) : null,
    recentVideos: data.recentVideos.length ? (
      <Shelf key="rv" title="Recently Added" onSeeAll={() => navigate({ name: 'videos' })}>
        {data.recentVideos.map((m) => <MediaCard key={m.id} item={m} queue={data.recentVideos} shape="tall" width={164} />)}
      </Shelf>
    ) : null,
    recentAlbums: data.recentAlbums.length ? (
      <Shelf key="ra" title="New Albums" onSeeAll={() => navigate({ name: 'music', tab: 'albums' })}>
        {data.recentAlbums.map((a) => <AlbumCard key={a.key} album={a} width={164} />)}
      </Shelf>
    ) : null,
    recentlyPlayedMusic: data.recentlyPlayedMusic.length ? (
      <Shelf key="rp" title="Recently Played">
        {data.recentlyPlayedMusic.map((m) => <MediaCard key={m.id} item={m} queue={data.recentlyPlayedMusic} shape="square" width={164} />)}
      </Shelf>
    ) : null,
    recentComics: data.recentComics.length ? (
      <Shelf key="rc" title="Manga, Comics & Books" onSeeAll={() => navigate({ name: 'comics' })}>
        {data.recentComics.map((m) => <MediaCard key={m.id} item={m} queue={data.recentComics} shape="tall" width={150} />)}
      </Shelf>
    ) : null,
    favorites: data.favorites.length ? (
      <Shelf key="fv" title="Favourites" onSeeAll={() => navigate({ name: 'favorites' })}>
        {data.favorites.map((m) => <MediaCard key={m.id} item={m} queue={data.favorites} shape={m.kind === 'audio' ? 'square' : 'tall'} width={164} />)}
      </Shelf>
    ) : null
  };

  return (
    <div className={`home ${loading ? 'is-refreshing' : ''}`}>
      {hero ? <Hero item={hero} queue={heroQueue} /> : <PageHeader title="Home" />}
      <div className="home__shelves">
        {shelves.filter((s) => s.enabled).map((s) => render[s.id])}
      </div>
    </div>
  );
}
