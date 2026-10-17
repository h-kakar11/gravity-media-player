import { FolderPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { invoke, isMac, on, pathForFile } from './api';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { ContentScroller } from './components/layout';
import { ContextMenuHost, SheetHost, Toasts } from './components/Overlays';
import { dispatchAction, registerHandlers, useHotkeyDispatcher } from './lib/hotkeys';
import { openMedia } from './lib/actions';
import { initLibrary, useLibrary } from './state/library';
import { navigate, useRouter, type Route } from './state/router';
import { initSettings, useSettings } from './state/settings';
import { initApp, useApp } from './state/app';
import { initAudio } from './state/music';
import { toast, useUi } from './state/ui';
import { Players } from './players';
import { useMusic } from './state/music';
import { useVideo } from './state/video';
import { AlbumView, ArtistView, MusicView, PlaylistView } from './views/Music';
import { BooksView, ComicsView, FavoritesView, HistoryView, PhotosView, SearchView, SeriesView } from './views/Collections';
import { BrowseView } from './views/Browse';
import { SmartEditorHost } from './components/SmartEditor';
import { SmartPlaylistView } from './views/SmartPlaylist';
import { HomeView, addFolderFlow } from './views/Home';
import { MediaDetailView } from './views/MediaDetail';
import { SettingsView } from './views/Settings';
import { ShowDetailView } from './views/ShowDetail';
import { StatsView } from './views/Stats';
import { VideosView } from './views/Videos';

function RouteView({ route }: { route: Route }) {
  switch (route.name) {
    case 'home': return <HomeView />;
    case 'videos': return <VideosView tab={route.tab} />;
    case 'show': return <ShowDetailView keyName={route.key} />;
    case 'media': return <MediaDetailView id={route.id} />;
    case 'music': return <MusicView tab={route.tab} />;
    case 'album': return <AlbumView keyName={route.key} />;
    case 'artist': return <ArtistView keyName={route.key} />;
    case 'playlist': return <PlaylistView id={route.id} />;
    case 'smart': return <SmartPlaylistView id={route.id} />;
    case 'comics': return <ComicsView />;
    case 'series': return <SeriesView keyName={route.key} />;
    case 'books': return <BooksView />;
    case 'photos': return <PhotosView />;
    case 'browse': return <BrowseView path={route.path} />;
    case 'favorites': return <FavoritesView />;
    case 'history': return <HistoryView />;
    case 'stats': return <StatsView />;
    case 'search': return <SearchView q={route.q} />;
    case 'settings': return <SettingsView pane={route.pane} />;
  }
}

function viewKeyFor(r: Route): string | null {
  switch (r.name) {
    case 'videos': return 'videos';
    case 'music': return r.tab === 'songs' ? 'music-songs' : 'music-albums';
    case 'browse': return 'browse';
    case 'comics': return 'comics';
    case 'books': return 'books';
    case 'photos': return 'photos';
    default: return null;
  }
}

export function App() {
  const ready = useSettings((s) => s.ready);
  const route = useRouter((s) => s.route);
  const collapsed = useSettings((s) => s.settings.appearance.sidebarCollapsed);
  const [booted, setBooted] = useState(false);
  const dropActive = useUi((s) => s.dropActive);
  const winMode = useApp((s) => s.win.mode);

  useHotkeyDispatcher();

  useEffect(() => {
    void (async () => {
      const info = await initApp();
      await initSettings(info.nativeMaterial);
      initAudio();
      initLibrary();
      setBooted(true);
    })();
  }, []);

  useEffect(() => {
    const offs = [
      on('menu:action', (id) => { dispatchAction(id); }),
      on('toast', (t) => toast(t.kind, t.message)),
      on('open-media', (ids) => void invoke('library:get', ids).then((items) => items[0] && openMedia(items[0], items))),
      on('system:resume', () => void useLibrary.getState().refreshRoots())
    ];
    return () => offs.forEach((o) => o());
  }, []);

  // App-level actions (navigation, view options, library, window).
  useEffect(() => registerHandlers({
    'nav.search': () => { useUi.getState().focusSearch(); },
    'nav.back': () => { useRouter.getState().back(); },
    'nav.forward': () => { useRouter.getState().forward(); },
    'nav.home': () => navigate({ name: 'home' }),
    'nav.videos': () => navigate({ name: 'videos' }),
    'nav.music': () => navigate({ name: 'music' }),
    'nav.comics': () => navigate({ name: 'comics' }),
    'nav.books': () => navigate({ name: 'books' }),
    'nav.photos': () => navigate({ name: 'photos' }),
    'nav.browse': () => navigate({ name: 'browse', path: null }),
    'nav.favorites': () => navigate({ name: 'favorites' }),
    'nav.history': () => navigate({ name: 'history' }),
    'nav.stats': () => navigate({ name: 'stats' }),
    'app.settings': () => navigate({ name: 'settings' }),
    'app.shortcuts': () => useUi.getState().openSheet({ type: 'shortcuts' }),
    'view.sidebar': () => { const s = useSettings.getState(); s.update({ appearance: { sidebarCollapsed: !s.settings.appearance.sidebarCollapsed } }); },
    'view.info': () => { useUi.getState().toggleInfo(); },
    'view.grid': () => setViewMode('grid'),
    'view.list': () => setViewMode('list'),
    'view.columns': () => setViewMode('columns'),
    'view.zoomIn': () => { const s = useSettings.getState(); s.update({ appearance: { posterSize: s.settings.appearance.posterSize + 20 } }); },
    'view.zoomOut': () => { const s = useSettings.getState(); s.update({ appearance: { posterSize: s.settings.appearance.posterSize - 20 } }); },
    'library.rescan': () => { void invoke('roots:rescan', null); toast('info', 'Checking your library for changes…'); },
    'library.deepRescan': () => { void invoke('roots:rescan', null, true); toast('info', 'Checking every file in your library…'); },
    'library.addFolder': () => { void addFolderFlow(); },
    'file.open': () => { void openFileFlow(); },
    'file.reveal': () => { const it = useUi.getState().sheet; void it; },
    'window.fullscreen': () => { void invoke('window:fullscreen'); },
    'window.mini': () => { void toggleMode('mini'); },
    'window.overlay': () => { void toggleMode('overlay'); }
  }), []);

  // Drag & drop: files open immediately; folders offer to join the library.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth++; useUi.setState({ dropActive: true }); } };
    const leave = (e: DragEvent) => { if (hasFiles(e) && --depth <= 0) { depth = 0; useUi.setState({ dropActive: false }); } };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      useUi.setState({ dropActive: false });
      const paths = [...(e.dataTransfer?.files ?? [])].map(pathForFile).filter(Boolean);
      void handleDrop(paths);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragleave', leave); window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, []);

  if (!ready || !booted) return <div className="boot" />;

  return (
    <div className={`app ${collapsed ? 'app--no-sidebar' : ''} ${isMac ? 'is-mac' : ''} ${winMode !== 'normal' ? 'app--compact' : ''}`} onContextMenu={(e) => e.preventDefault()}>
      <Sidebar />
      <main className="main">
        <Toolbar />
        <ContentScroller><RouteView route={route} /></ContentScroller>
      </main>
      <Players />
      <ContextMenuHost />
      <SheetHost />
      <SmartEditorHost />
      <Toasts />
      {dropActive && (
        <div className="drop-overlay" aria-hidden="true"><div className="drop-overlay__card"><FolderPlus size={34} strokeWidth={1.5} /><div className="t-title-3">Drop to open or add</div><div className="secondary">Files play right away · folders can join your library</div></div></div>
      )}
    </div>
  );

  function setViewMode(mode: 'grid' | 'list' | 'columns') {
    const key = viewKeyFor(useRouter.getState().route);
    if (key) useSettings.getState().update({ view: { mode: { [key]: mode } } });
  }
}

async function toggleMode(mode: 'mini' | 'overlay') {
  const st = await invoke('window:state');
  if (st.mode === mode) { await invoke('window:setMode', 'normal'); return; }
  const video = useVideo.getState().open;
  const music = useMusic.getState().queue.length > 0;
  if (mode === 'overlay' && !video) return toast('info', 'Start a video to use the overlay.');
  if (!video && !music) return toast('info', 'Play something first, then switch to the mini player.');
  await invoke('window:setMode', mode);
}

async function openFileFlow() {
  const file = await invoke('dialog:pickFile', 'Open Media File', []);
  if (!file) return;
  await handleDrop([file]);
}

async function handleDrop(paths: string[]) {
  if (paths.length === 0) return;
  try {
    const items = await invoke('library:ingest', paths);
    if (items.length > 0) {
      openMedia(items[0]!, items);
      return;
    }
    // Nothing playable → offer to treat folders as library locations.
    for (const p of paths) {
      const name = p.split(/[\\/]/).pop() ?? p;
      const ok = await useUi.getState().confirm({ title: `Add “${name}” to your library?`, message: 'Gravity will scan this folder, keep it up to date, and show its contents alongside your other media.', confirmLabel: 'Add Folder' });
      if (ok) {
        try { const r = await invoke('roots:add', p); if (r) toast('success', `Added “${r.name}” — scanning now`); } catch (err) { toast('error', (err as Error).message); }
      }
    }
  } catch (err) {
    toast('error', (err as Error).message);
  }
}
