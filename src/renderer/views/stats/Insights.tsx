import { Download, Flame } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { buildHeatGrid } from '@shared/heatmap';
import type { HeatDay, YearInReview } from '@shared/insights';
import { localDayKey } from '@shared/insights';
import { formatSpan } from '@shared/stats-buckets';
import { invoke } from '../../api';
import { Button, Segmented, Spinner } from '../../components/ui';
import { toast } from '../../state/ui';
import '../../styles/insights.css';

const MONTH = (i: number) => new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(2000, i, 1));
const dayLabel = (day: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(`${day}T00:00:00`));

/** Calendar of the last 53 weeks, one cell per local day, shaded in quarters of the busiest day. */
export function HeatmapCard({ days }: { days: HeatDay[] }) {
  const grid = useMemo(() => {
    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 364);
    return buildHeatGrid(days, localDayKey(from), localDayKey(today));
  }, [days]);
  const total = days.reduce((a, d) => a + d.sec, 0);
  const active = days.filter((d) => d.sec > 0).length;
  const monthStarts = grid.cells.filter((c) => c.row === 0 && c.day.slice(8) <= '07').map((c) => ({ col: c.col, label: MONTH(Number(c.day.slice(5, 7)) - 1) }));
  return (
    <section className="card-surface heat" aria-label="Activity calendar">
      <header className="stats-card__head"><h2 className="t-headline">Calendar</h2><span className="secondary t-footnote">{active} active day{active === 1 ? '' : 's'} · {formatSpan(total)} in the last year</span></header>
      <div className="heat__scroll">
        <div className="heat__months" style={{ gridTemplateColumns: `repeat(${grid.weeks}, 12px)` }} aria-hidden="true">
          {monthStarts.map((m) => <span key={`${m.col}${m.label}`} style={{ gridColumn: m.col + 1 }}>{m.label}</span>)}
        </div>
        <div className="heat__grid" role="img" aria-label={`${active} active days in the last year, ${formatSpan(total)} in total`} style={{ gridTemplateColumns: `repeat(${grid.weeks}, 12px)` }}>
          {grid.cells.map((c) => <i key={c.day} className={`heat__cell l${c.level}`} style={{ gridColumn: c.col + 1, gridRow: c.row + 1 }} title={`${dayLabel(c.day)}: ${c.sec > 0 ? formatSpan(c.sec) : 'nothing'}`} />)}
        </div>
      </div>
      <div className="heat__legend t-footnote secondary" aria-hidden="true">Less{[0, 1, 2, 3, 4].map((l) => <i key={l} className={`heat__cell l${l}`} />)}More</div>
    </section>
  );
}

export function StreakNote({ longest, start, end }: { longest: number; start: string | null; end: string | null }) {
  if (longest < 2 || !start || !end) return null;
  return <span className="t-footnote secondary"><Flame size={12} aria-hidden="true" /> Best streak {longest} days ({dayLabel(start)} – {dayLabel(end)})</span>;
}

export function YearInReviewCard() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(String(thisYear));
  const [data, setData] = useState<YearInReview | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setData(null);
    invoke('stats:yearInReview', Number(year)).then((d) => live && setData(d)).catch(() => undefined);
    return () => { live = false; };
  }, [year]);
  const exportHtml = () => {
    setBusy(true);
    invoke('stats:exportYearInReview', Number(year))
      .then((p) => { if (p) toast('success', 'Saved your year in review'); })
      .catch((e: Error) => toast('error', e.message))
      .finally(() => setBusy(false));
  };
  const years = [thisYear, thisYear - 1, thisYear - 2, thisYear - 3].map(String);
  const maxMonth = Math.max(1, ...(data?.months ?? [1]));
  return (
    <section className="card-surface yir" aria-label="Year in review">
      <header className="stats-card__head">
        <h2 className="t-headline">Year in review</h2>
        <Segmented label="Year" size="sm" value={year} onChange={setYear} options={years.map((y) => ({ value: y, label: y }))} />
      </header>
      {!data && <div className="page-loading"><Spinner size={18} /></div>}
      {data && data.sessions === 0 && <p className="secondary">Nothing was played in {data.year}.</p>}
      {data && data.sessions > 0 && (
        <div className="yir__body">
          <div className="yir__hero">
            <div className="yir__big">{Math.round(data.totalSec / 360) / 10}<small>hours</small></div>
            <div className="secondary">{data.titles.toLocaleString()} titles on {data.activeDays} days · best streak {data.longestStreak} day{data.longestStreak === 1 ? '' : 's'}</div>
          </div>
          <div className="yir__months" role="img" aria-label={`Time per month in ${data.year}`}>
            {data.months.map((s, i) => <div key={i} title={`${MONTH(i)}: ${formatSpan(s)}`}><span style={{ height: `${Math.round((s / maxMonth) * 100)}%` }} />{MONTH(i)[0]}</div>)}
          </div>
          <div className="yir__tops t-footnote">
            {data.topShows[0] && <div><span className="secondary">Top show</span> {data.topShows[0].title}</div>}
            {data.topMovies[0] && <div><span className="secondary">Top movie</span> {data.topMovies[0].title}</div>}
            {data.topArtists[0] && <div><span className="secondary">Top artist</span> {data.topArtists[0].name}</div>}
            {data.topTracks[0] && <div><span className="secondary">Top song</span> {data.topTracks[0].title}</div>}
            {data.topGenres[0] && <div><span className="secondary">Top genre</span> {data.topGenres[0].name}</div>}
          </div>
        </div>
      )}
      <footer className="yir__foot">
        <span className="t-footnote secondary">Exports a single web page you can open, print or screenshot. Built on this computer; nothing is uploaded.</span>
        <Button icon={Download} onClick={exportHtml} disabled={busy || !data || data.sessions === 0}>Export…</Button>
      </footer>
    </section>
  );
}
