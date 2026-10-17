import { CheckCircle2, Heart, Play, RefreshCw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatDuration } from '@shared/format';
import { mergeEpisodeText, type MetaEpisode } from '@shared/metadata';
import type { MediaItem } from '@shared/types';
import { invoke } from '../api';
import { Artwork } from '../components/Artwork';
import { DetailHeader } from '../components/DetailHeader';
import { PageHeader } from '../components/layout';
import { Button, EmptyState, IconButton, ProgressBar, Segmented, Spinner } from '../components/ui';
import { openMedia, setWatched, showItemMenu } from '../lib/actions';
import { useLibraryQuery } from '../lib/hooks';
import { FixMatchSheet } from '../components/FixMatch';
import { useLibrary } from '../state/library';
import { toast } from '../state/ui';
import { Tv } from 'lucide-react';
import { WatchlistToggle } from '../components/WatchCards';

export function ShowDetailView({ keyName, season: startSeason }: { keyName: string; season?: number }) {
  const { data: episodes } = useLibraryQuery(async () => (await invoke('library:query', { kind: 'video', series: keyName, sort: 'episode' })).items, [keyName]);
  const { data: summary } = useLibraryQuery(async () => (await invoke('library:series', { type: 'show' })).items.find((s) => s.key === keyName), [keyName]);
  // Stored locally, so these work offline and with online lookups turned off.
  const { data: onlineEps } = useLibraryQuery(() => invoke('meta:episodes', keyName.toLowerCase()), [keyName]);
  const { data: match } = useLibraryQuery(() => invoke('meta:match', { kind: 'series', key: keyName.toLowerCase() }), [keyName]);
  const [seasonSel, setSeason] = useState<number | null>(startSeason ?? null);
  const [fixing, setFixing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const online = useMemo(() => new Map((onlineEps ?? []).map((e) => [`${e.season}x${e.episode}`, e] as const)), [onlineEps]);

  const refreshEpisodes = async () => {
    setRefreshing(true);
    try {
      const r = await invoke('meta:episodesSync', keyName.toLowerCase());
      useLibrary.setState((s) => ({ revision: s.revision + 1 }));
      toast(r.failedSeasons ? 'info' : 'success', `Episode info updated · ${r.episodes} episode${r.episodes === 1 ? '' : 's'}${r.failedSeasons ? `, ${r.failedSeasons} season${r.failedSeasons === 1 ? '' : 's'} could not be fetched` : ''}`);
    } catch (err) {
      toast('error', (err as Error).message);
    }
    setRefreshing(false);
  };

  const seasons = useMemo(() => [...new Set((episodes ?? []).map((e) => e.season ?? 1))].sort((a, b) => a - b), [episodes]);
  const season = seasonSel ?? (() => {
    // Open on the season you're currently watching.
    const cur = (episodes ?? []).find((e) => !e.completed);
    return cur?.season ?? seasons[0] ?? 1;
  })();

  if (!episodes) return <div className="page-loading"><Spinner size={22} /></div>;
  if (episodes.length === 0) return <EmptyState icon={Tv} title="Show not found" message="This show is no longer in your library." />;

  const title = episodes[0]!.series ?? keyName;
  const next = episodes.find((e) => !e.completed && e.positionSec > 10) ?? episodes.find((e) => !e.completed) ?? episodes[0]!;
  const nextIsResume = next.positionSec > 10 && !next.completed;
  const watched = episodes.filter((e) => e.completed).length;
  const inSeason = episodes.filter((e) => (e.season ?? 1) === season);
  const art = episodes.find((e) => e.hasArt);
  const totalSec = episodes.reduce((a, e) => a + e.durationSec, 0);
  const label = `S${season}E${next.episode ?? 1}`;

  return (
    <>
      <PageHeader title={title} />
      <DetailHeader
        artMediaId={art?.id ?? null} version={art?.mtimeMs}
        poster={<Artwork mediaId={art?.id ?? null} hasArt={!!art} title={title} kind="video" shape="tall" size="large" version={art?.mtimeMs} eager />}
      >
        <div className="t-caps">TV Show</div>
        <h1 className="t-large-title detail__title">{title}</h1>
        <div className="detail__meta secondary">
          <span>{seasons.length} season{seasons.length === 1 ? '' : 's'}</span><span>{episodes.length} episodes</span><span>{formatDuration(totalSec, { long: true })}</span>
          {episodes[0]!.year && <span>{episodes[0]!.year}</span>}
        </div>
        <div className="detail__resume" style={{ maxWidth: 360 }}><ProgressBar value={watched / episodes.length} /><span className="t-footnote secondary">{watched} of {episodes.length} played</span></div>
        <div className="detail__actions">
          <Button variant="primary" size="lg" icon={Play} onClick={() => openMedia(next, episodes)}>{nextIsResume ? `Resume ${label}` : watched === 0 ? 'Play' : `Play ${label}`}</Button>
          <IconButton icon={Heart} label={summary?.favorite ? 'Remove from Favourites' : 'Add to Favourites'} active={summary?.favorite} className="round" size={18}
            onClick={() => void invoke('library:favorite', { type: 'series', key: `show:${keyName}` }, !summary?.favorite).then(() => useLibrary.setState((s) => ({ revision: s.revision + 1 })))} />
          <WatchlistToggle target={{ kind: 'show', key: keyName }} title={title} />
          <IconButton icon={CheckCircle2} label={watched === episodes.length ? 'Mark Show as Unplayed' : 'Mark Show as Played'} active={watched === episodes.length} className="round" size={18}
            onClick={() => void setWatched(episodes, watched !== episodes.length)} />
          <IconButton icon={Search} label="Fix Match…" className="round" size={18} onClick={() => setFixing(true)} />
          {match && (match.provider === 'tmdb' || match.provider === 'anilist') && (
            <IconButton icon={RefreshCw} label="Refresh Episode Info" className="round" size={18} disabled={refreshing} onClick={() => void refreshEpisodes()} />
          )}
        </div>
      </DetailHeader>

      {fixing && <FixMatchSheet kind="series" target={{ kind: 'series', key: keyName.toLowerCase() }} initial={title} year={episodes[0]!.year ?? undefined} onClose={() => setFixing(false)} />}
      <div className="detail-body">
        {seasons.length > 1 && (
          <div className="season-picker">
            {seasons.length <= 8
              ? <Segmented<string> label="Season" value={String(season)} onChange={(v) => setSeason(Number(v))} options={seasons.map((s) => ({ value: String(s), label: s === 0 ? 'Specials' : `Season ${s}` }))} />
              : <select className="field" aria-label="Season" value={season} onChange={(e) => setSeason(Number(e.target.value))}>{seasons.map((s) => <option key={s} value={s}>{s === 0 ? 'Specials' : `Season ${s}`}</option>)}</select>}
          </div>
        )}
        <ol className="episodes">
          {inSeason.map((e) => <EpisodeRow key={e.id} ep={e} queue={episodes} online={online.get(`${e.season ?? 1}x${e.episode ?? 0}`)} />)}
        </ol>
      </div>
    </>
  );
}

/** "2011-04-17" → local-date text. Parsed by parts so the day never shifts with the time zone. */
function formatAirDate(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function EpisodeRow({ ep, queue, online }: { ep: MediaItem; queue: MediaItem[]; online?: MetaEpisode }) {
  const progress = ep.durationSec ? ep.positionSec / ep.durationSec : 0;
  // Local titles and summaries (file name, tags, .nfo) always win; online text only fills what is missing.
  const { title, plot } = mergeEpisodeText({ title: ep.title, plot: ep.plot }, online);
  const aired = online?.airDate ? formatAirDate(online.airDate) : null;
  return (
    <li>
      <div className="episode" role="button" tabIndex={0} onClick={() => openMedia(ep, queue)} onKeyDown={(e) => e.key === 'Enter' && openMedia(ep, queue)} onContextMenu={(e) => showItemMenu(e, ep, { queue })}>
        <div className="episode__thumb">
          <Artwork mediaId={ep.id} hasArt={ep.hasArt} title={ep.title} kind="video" shape="wide" fit="cover" version={ep.mtimeMs} />
          {progress > 0 && !ep.completed && <ProgressBar value={progress} className="card__progress" />}
          <span className="episode__play"><Play size={20} fill="currentColor" strokeWidth={0} /></span>
        </div>
        <div className="episode__text">
          <div className="episode__title"><span className="episode__num tabular">{ep.episode ?? '–'}</span><span className="truncate">{title}</span></div>
          {plot && <p className="secondary t-callout clamp-2">{plot}</p>}
          <div className="secondary t-footnote">{aired ? `${aired} · ` : ''}{formatDuration(ep.durationSec, { long: true })}{ep.completed ? ' · Played' : progress > 0 ? ` · ${formatDuration(ep.durationSec - ep.positionSec, { long: true })} left` : ''}</div>
        </div>
        {ep.completed && <CheckCircle2 size={18} className="episode__done" aria-label="Played" />}
      </div>
    </li>
  );
}
