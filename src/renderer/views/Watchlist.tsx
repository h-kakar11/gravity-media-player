import { ArrowDown, ArrowUp, BellOff, Bookmark, BookmarkMinus, Check, CheckCheck, EyeOff, Play, Plus, Search as SearchIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { episodeTag } from '@shared/format';
import type { MediaItem, SeriesSummary } from '@shared/types';
import { watchKey, type UpNextEntry, type WatchlistEntry, type WatchlistTarget } from '@shared/watch';
import { invoke } from '../api';
import { Artwork } from '../components/Artwork';
import { playShow, showUpNextMenu, showWatchlistMenu } from '../components/WatchCards';
import { PageHeader } from '../components/layout';
import { Button, EmptyState, IconButton, ProgressBar, Spinner } from '../components/ui';
import { openMedia } from '../lib/actions';
import { useDebounced, useLibraryQuery } from '../lib/hooks';
import { subtitleFor } from '../lib/media';
import { navigate } from '../state/router';
import { toast, useUi } from '../state/ui';
import { updateWatch } from '../state/watch';

interface RowProps {
  art: ReactNode;
  title: string;
  subtitle: string;
  tags?: ReactNode;
  progress?: number;
  offline?: boolean;
  onOpen: () => void;
  onContext: (e: React.MouseEvent) => void;
  actions: ReactNode;
}

function WatchRow({ art, title, subtitle, tags, progress = 0, offline, onOpen, onContext, actions }: RowProps) {
  return (
    <div className={`watch-row ${offline ? 'is-offline' : ''}`} onContextMenu={onContext}>
      <button type="button" className="watch-row__art" onClick={onOpen} tabIndex={-1} aria-hidden="true">
        {art}
        {progress > 0 && <ProgressBar value={progress} />}
      </button>
      <button type="button" className="watch-row__text" onClick={onOpen}>
        <span className="watch-row__title"><span>{title}</span>{tags}</span>
        <span className="secondary t-footnote truncate">{subtitle}</span>
      </button>
      <div className="watch-row__actions">{actions}</div>
    </div>
  );
}

const newTag = (n: number) => (n > 0 ? <span className="watch-tag">{n} new</span> : null);

function UpNextRow({ entry }: { entry: UpNextEntry }) {
  const ep = entry.episode;
  const play = () => void playShow(entry.seriesKey, ep);
  return (
    <WatchRow
      art={<Artwork mediaId={ep.id} hasArt={ep.hasArt} title={entry.showTitle} kind="video" shape="wide" version={ep.mtimeMs} />}
      title={entry.showTitle}
      subtitle={[episodeTag(ep.season, ep.episode), ep.title, `${entry.playedCount} of ${entry.episodeCount} played`].filter(Boolean).join(' · ')}
      tags={entry.isNew ? <span className="watch-tag">New</span> : newTag(entry.newEpisodes)}
      progress={entry.episodeCount ? entry.playedCount / entry.episodeCount : 0}
      onOpen={play} onContext={(e) => showUpNextMenu(e, entry)}
      actions={
        <>
          <IconButton icon={Play} label={`Play ${entry.showTitle}`} onClick={play} />
          {entry.newEpisodes > 0 && <IconButton icon={BellOff} label="Dismiss new episodes" onClick={() => void updateWatch({ type: 'markSeen', seriesKey: entry.seriesKey })} />}
          <IconButton icon={EyeOff} label="Hide from Up Next" onClick={() => void updateWatch({ type: 'hideUpNext', seriesKey: entry.seriesKey })} />
        </>
      }
    />
  );
}

function WatchlistRow({ entry, first, last, onMove }: { entry: WatchlistEntry; first: boolean; last: boolean; onMove: (dir: -1 | 1) => void }) {
  const { movie, show } = entry;
  const open = () => {
    if (movie && entry.kind === 'movie') navigate({ name: 'media', id: movie.id });
    else if (show) navigate({ name: 'show', key: show.key });
  };
  const play = () => {
    if (movie && entry.kind === 'movie') openMedia(movie, [movie]);
    else if (show) void playShow(show.key);
  };
  const subtitle = !entry.available
    ? 'Not in your library right now'
    : movie ? subtitleFor(movie) : show ? `${show.seasonCount} season${show.seasonCount === 1 ? '' : 's'} · ${show.completedCount} of ${show.episodeCount} played` : '';
  const art = movie
    ? <Artwork mediaId={movie.id} hasArt={movie.hasArt} title={entry.title} kind="video" shape="wide" version={movie.mtimeMs} />
    : <Artwork mediaId={show?.artMediaId ?? null} hasArt={show?.artMediaId != null} title={entry.title} kind="video" shape="wide" />;
  return (
    <WatchRow
      art={art} title={entry.title} subtitle={subtitle} offline={!entry.available}
      tags={
        <>
          {show && newTag(show.newEpisodes)}
          {entry.watched && <span className="watch-tag watch-tag--muted">Watched</span>}
          {!entry.available && <span className="watch-tag watch-tag--muted">Offline</span>}
        </>
      }
      progress={show && show.episodeCount ? show.completedCount / show.episodeCount : movie && !entry.watched ? movie.progress : 0}
      onOpen={open} onContext={(e) => showWatchlistMenu(e, entry)}
      actions={
        <>
          {entry.available && <IconButton icon={Play} label={`Play ${entry.title}`} onClick={play} />}
          <IconButton icon={ArrowUp} label={`Move ${entry.title} up`} disabled={first} onClick={() => onMove(-1)} />
          <IconButton icon={ArrowDown} label={`Move ${entry.title} down`} disabled={last} onClick={() => onMove(1)} />
          <IconButton icon={BookmarkMinus} label={`Remove ${entry.title} from Watchlist`} onClick={() => void updateWatch({ type: 'remove', target: entry.target })} />
        </>
      }
    />
  );
}

/** Search the library for movies and shows to put on the list. Stays open so several can be added in a row. */
function AddSheet({ initial, onClose }: { initial: ReadonlySet<string>; onClose: () => void }) {
  const [q, setQ] = useState('');
  const text = useDebounced(q.trim(), 220);
  const [results, setResults] = useState<{ movies: MediaItem[]; shows: SeriesSummary[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onList, setOnList] = useState<ReadonlySet<string>>(initial);

  useEffect(() => {
    if (!text) { setResults(null); setError(null); return; }
    let alive = true;
    setBusy(true);
    invoke('library:search', text).then(
      (r) => {
        if (!alive) return;
        setResults({ movies: r.media.filter((m) => m.kind === 'video' && m.vclass !== 'episode'), shows: r.series.filter((s) => s.type === 'show') });
        setError(null);
        setBusy(false);
      },
      (err: Error) => { if (alive) { setError(err.message); setBusy(false); } }
    );
    return () => { alive = false; };
  }, [text]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);

  const toggle = async (target: WatchlistTarget) => {
    const result = await updateWatch({ type: onList.has(watchKey(target)) ? 'remove' : 'add', target });
    if (result) setOnList(new Set(result.overview.watchlist.map((e) => watchKey(e.target))));
  };

  const rows: { target: WatchlistTarget; title: string; sub: string; art: ReactNode }[] = [
    ...(results?.shows ?? []).map((s) => ({
      target: { kind: 'show', key: s.key } as WatchlistTarget, title: s.title, sub: `TV show · ${s.episodeCount} episode${s.episodeCount === 1 ? '' : 's'}`,
      art: <Artwork mediaId={s.artMediaId} hasArt={s.artMediaId != null} title={s.title} kind="video" shape="tall" />
    })),
    ...(results?.movies ?? []).map((m) => ({
      target: { kind: 'movie', id: m.id } as WatchlistTarget, title: m.title, sub: ['Movie', m.year].filter(Boolean).join(' · '),
      art: <Artwork mediaId={m.id} hasArt={m.hasArt} title={m.title} kind="video" shape="tall" version={m.mtimeMs} />
    }))
  ];

  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet watch-add" role="dialog" aria-labelledby="wl-add-title">
        <h2 id="wl-add-title" className="t-headline">Add to Watchlist</h2>
        <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search movies and shows" aria-label="Search your library" autoFocus />
        <div className="watch-add__results">
          {busy && <div className="page-loading"><Spinner size={18} /></div>}
          {error && <p className="secondary t-callout">{error}</p>}
          {!busy && !error && !text && <p className="secondary t-callout">Type a title to find it in your library.</p>}
          {!busy && !error && text && rows.length === 0 && <p className="secondary t-callout">No movies or shows match “{text}”.</p>}
          {!busy && rows.map((r) => {
            const on = onList.has(watchKey(r.target));
            return (
              <button key={watchKey(r.target)} type="button" className="watch-add__row" aria-pressed={on} onClick={() => void toggle(r.target)}>
                <span className="watch-add__art">{r.art}</span>
                <span style={{ minWidth: 0 }}>
                  <strong className="truncate" style={{ display: 'block' }}>{r.title}</strong>
                  <span className="secondary t-footnote">{r.sub}</span>
                </span>
                <span className="watch-add__on" aria-label={on ? 'On your watchlist' : undefined}>{on ? <Check size={16} /> : <Plus size={16} />}</span>
              </button>
            );
          })}
        </div>
        <div className="sheet__actions"><Button variant="primary" onClick={onClose}>Done</Button></div>
      </div>
    </div>,
    document.body
  );
}

export function WatchlistView() {
  const { data, error } = useLibraryQuery(() => invoke('watch:overview'), []);
  const [adding, setAdding] = useState(false);

  if (!data) return <><PageHeader title="Watchlist" />{error ? <EmptyState icon={Bookmark} title="Couldn’t load your Watchlist" message={error} /> : <div className="page-loading"><Spinner size={22} /></div>}</>;

  const { upNext, watchlist } = data;
  const watchedCount = watchlist.filter((e) => e.available && e.watched).length;

  const move = (index: number, dir: -1 | 1) => {
    const ids = watchlist.map((e) => e.id);
    const to = index + dir;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to]!, ids[index]!];
    void updateWatch({ type: 'reorder', ids });
  };

  const clearWatched = async () => {
    const ok = await useUi.getState().confirm({
      title: 'Clear watched items?',
      message: `${watchedCount} watched ${watchedCount === 1 ? 'item is' : 'items are'} taken off your Watchlist. Your watch history is not affected.`,
      confirmLabel: 'Clear Watched'
    });
    if (!ok) return;
    const result = await updateWatch({ type: 'clearWatched' });
    if (result) toast('success', result.changed === 1 ? 'Removed 1 watched item' : `Removed ${result.changed} watched items`);
  };

  const subtitle = [
    watchlist.length ? `${watchlist.length} saved` : '',
    upNext.length ? `${upNext.length} up next` : ''
  ].filter(Boolean).join(' · ') || undefined;

  return (
    <>
      <PageHeader title="Watchlist" subtitle={subtitle}>
        <Button icon={Plus} onClick={() => setAdding(true)}>Add…</Button>
        <Button icon={CheckCheck} disabled={watchedCount === 0} onClick={() => void clearWatched()} title={watchedCount === 0 ? 'Nothing on your list has been watched yet' : undefined}>Clear Watched</Button>
      </PageHeader>

      {upNext.length === 0 && watchlist.length === 0 ? (
        <EmptyState icon={Bookmark} title="Nothing saved yet" message="Add the movies and shows you mean to watch. Use the bookmark on any movie or show page, or search for them here. Shows you are partway through appear under Up Next automatically.">
          <Button variant="primary" icon={SearchIcon} onClick={() => setAdding(true)}>Add to Watchlist…</Button>
        </EmptyState>
      ) : (
        <div className="detail-body">
          {upNext.length > 0 && (
            <section className="watch-section" aria-label="Up Next">
              <h2 className="t-title-2 section-title">Up Next</h2>
              <div className="watch-list">{upNext.map((e) => <UpNextRow key={e.seriesKey} entry={e} />)}</div>
            </section>
          )}
          <section className="watch-section" aria-label="Watchlist">
            <h2 className="t-title-2 section-title">Watchlist</h2>
            {watchlist.length === 0 ? (
              <p className="secondary">Nothing on your list yet. Use Add… to search your library.</p>
            ) : (
              <div className="watch-list">
                {watchlist.map((e, i) => <WatchlistRow key={e.id} entry={e} first={i === 0} last={i === watchlist.length - 1} onMove={(d) => move(i, d)} />)}
              </div>
            )}
          </section>
        </div>
      )}
      {adding && <AddSheet initial={new Set(watchlist.map((e) => watchKey(e.target)))} onClose={() => setAdding(false)} />}
    </>
  );
}
