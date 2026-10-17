import { BarChart3, BookOpen, Clapperboard, Flame, Gauge, Hourglass, Image as ImageIcon, Library, Moon, Music2, Timer, Trophy, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatBytes } from '@shared/format';
import { bucketDaily, formatSpan, niceTicks, pickGranularity, spanDays, type Bucket } from '@shared/stats-buckets';
import type { MediaKind, StatsResult } from '@shared/types';
import { invoke } from '../api';
import { Artwork } from '../components/Artwork';
import { PageHeader } from '../components/layout';
import { EmptyState, Icon, Segmented, Spinner } from '../components/ui';
import { openMedia } from '../lib/actions';
import { useElementSize, useLibraryQuery } from '../lib/hooks';
import { navigate } from '../state/router';

type RangeId = '7' | '30' | '90' | '365' | 'all';
const RANGES: { value: RangeId; label: string }[] = [
  { value: '7', label: 'Week' }, { value: '30', label: 'Month' }, { value: '90', label: '3 Months' }, { value: '365', label: 'Year' }, { value: 'all', label: 'All' }
];
const RANGE_NAME: Record<RangeId, string> = { '7': 'the last 7 days', '30': 'the last 30 days', '90': 'the last 3 months', '365': 'the last year', all: 'all time' };
let rememberedRange: RangeId = '30';

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
function rangeBounds(id: RangeId): { from?: number; fromDate: Date | null; to: Date } {
  const to = new Date();
  if (id === 'all') return { fromDate: null, to };
  const from = startOfDay(new Date(to.getTime() - (Number(id) - 1) * 86_400_000));
  return { from: from.getTime(), fromDate: from, to };
}

const KIND_LABEL: Record<MediaKind, string> = { video: 'Videos', audio: 'Music', comic: 'Manga & comics', book: 'Books', image: 'Photos' };
const KIND_ICON: Record<MediaKind, LucideIcon> = { video: Clapperboard, audio: Music2, comic: Library, book: BookOpen, image: ImageIcon };

const hourLabel = (h: number) => new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2000, 0, 1, h));

export function StatsView() {
  const [range, setRange] = useState<RangeId>(rememberedRange);
  const pick = (r: RangeId) => { rememberedRange = r; setRange(r); };
  const bounds = useMemo(() => rangeBounds(range), [range]);
  const { data, loading, reload } = useLibraryQuery(() => invoke('stats:get', { from: bounds.from }), [range], { live: true });
  // History is written while you play elsewhere; keep an open page current without a manual refresh.
  useEffect(() => {
    const iv = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 20_000);
    return () => clearInterval(iv);
  }, [reload]);

  const empty = data != null && data.sessions === 0;
  return (
    <>
      <PageHeader title="Statistics" subtitle="Calculated on this computer from your own history.">
        <Segmented label="Time range" size="sm" value={range} onChange={pick} options={RANGES} />
      </PageHeader>
      {!data && loading && <div className="page-loading"><Spinner size={22} /></div>}
      {data && (empty ? (
        <>
          <EmptyState icon={BarChart3} title={`Nothing played in ${RANGE_NAME[range]}`} message="Watch, listen or read something and your statistics appear here — hours, favourites, streaks and daily rhythm." />
          <LibraryCard data={data} />
        </>
      ) : <Dashboard data={data} range={range} fromDate={bounds.fromDate} to={bounds.to} />)}
    </>
  );
}

function Dashboard({ data, range, fromDate, to }: { data: StatsResult; range: RangeId; fromDate: Date | null; to: Date }) {
  // "All time" starts at the first day with any history.
  const from = fromDate ?? (data.daily[0] ? new Date(`${data.daily[0].day}T00:00:00`) : to);
  const buckets = useMemo(() => bucketDaily(data.daily, from, to), [data.daily, from, to]);
  const days = spanDays(from, to);
  const g = pickGranularity(days);
  const perDay = data.totalSec / Math.max(1, days);
  const parts = [
    { id: 'video', label: 'Video', sec: data.videoSec, icon: Clapperboard },
    { id: 'audio', label: 'Music', sec: data.audioSec, icon: Music2 },
    { id: 'reading', label: 'Reading', sec: data.readingSec, icon: BookOpen }
  ] as const;

  return (
    <div className="stats">
      <section className="stats-hero card-surface" aria-label="Total time">
        <div className="stats-hero__main">
          <div className="t-caps">Time in Gravity · {RANGE_NAME[range]}</div>
          <div className="stats-hero__num" aria-label={formatSpan(data.totalSec)}>
            <Big sec={data.totalSec} />
          </div>
          <div className="secondary">About {formatSpan(perDay)} a day across {data.sessions.toLocaleString()} session{data.sessions === 1 ? '' : 's'}.</div>
        </div>
        <div className="stats-hero__split">
          <div className="splitbar" role="img" aria-label={parts.map((p) => `${p.label} ${formatSpan(p.sec)}`).join(', ')}>
            {parts.map((p) => p.sec > 0 && <span key={p.id} className={`splitbar__seg c-${p.id}`} style={{ flexGrow: p.sec }} />)}
          </div>
          <div className="legend">
            {parts.map((p) => (
              <div key={p.id} className="legend__item">
                <span className={`dot c-${p.id}`} />
                <span className="legend__label">{p.label}</span>
                <span className="legend__val tabular">{formatSpan(p.sec)}</span>
                <span className="legend__pct tabular tertiary">{data.totalSec ? Math.round((p.sec / data.totalSec) * 100) : 0}%</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="card-surface stats-chart" aria-label="Activity over time">
        <header className="stats-card__head"><h2 className="t-headline">Activity</h2><span className="secondary t-footnote">per {g === 'day' ? 'day' : g === 'week' ? 'week' : 'month'}</span></header>
        <ActivityChart buckets={buckets} g={g} />
      </section>

      <div className="kpis">
        <Kpi icon={Trophy} label="Titles played" value={data.titlesPlayed.toLocaleString()} sub={`${data.completedTitles.toLocaleString()} finished`} />
        <Kpi icon={Flame} label="Current streak" value={`${data.streakDays} day${data.streakDays === 1 ? '' : 's'}`} sub="in a row" />
        <Kpi icon={Timer} label="Average session" value={formatSpan(data.avgSessionSec)} sub={`longest ${formatSpan(data.longestSessionSec)}`} />
        <Kpi icon={Gauge} label="Average video speed" value={`${data.avgSpeed.toFixed(2).replace(/\.?0+$/, '')}×`} sub="weighted by time" />
        <Kpi icon={Moon} label="Most active hour" value={data.mostActiveHour == null ? '—' : hourLabel(data.mostActiveHour)} sub="of the day" />
        <Kpi icon={Hourglass} label="Sessions" value={data.sessions.toLocaleString()} sub={`${formatSpan(perDay)} / day`} />
      </div>

      <div className="stats-cols">
        <section className="card-surface" aria-label="Time of day">
          <header className="stats-card__head"><h2 className="t-headline">Time of day</h2></header>
          <HourChart hourly={data.hourly} />
        </section>
        <section className="card-surface" aria-label="Day of week">
          <header className="stats-card__head"><h2 className="t-headline">Day of week</h2></header>
          <WeekChart weekday={data.weekday} />
        </section>
      </div>

      <div className="stats-masonry">
        {data.topVideos.length > 0 && (
          <TopList title="Most watched" rows={data.topVideos.map((v) => ({
            key: `v${v.item.id}`, title: v.item.title, sub: v.item.series ? v.item.series : `${v.plays} play${v.plays === 1 ? '' : 's'}`, value: v.sec, label: formatSpan(v.sec),
            art: { id: v.item.id, has: v.item.hasArt, kind: 'video' as const, shape: 'wide' as const, version: v.item.mtimeMs }, onClick: () => navigate({ name: 'media', id: v.item.id })
          }))} />
        )}
        {data.topSeries.length > 0 && (
          <TopList title="Top shows" rows={data.topSeries.map((s) => ({
            key: `s${s.title}`, title: s.title, value: s.sec, label: formatSpan(s.sec), art: { id: s.artMediaId, has: s.artMediaId != null, kind: 'video' as const, shape: 'wide' as const, version: 0 }
          }))} />
        )}
        {data.topTracks.length > 0 && (
          <TopList title="Most played songs" rows={data.topTracks.map((t) => ({
            key: `t${t.item.id}`, title: t.item.title, sub: t.item.artist ?? undefined, value: t.plays, label: `${t.plays} play${t.plays === 1 ? '' : 's'}`,
            art: { id: t.item.id, has: t.item.hasArt, kind: 'audio' as const, shape: 'square' as const, version: t.item.mtimeMs }, onClick: () => openMedia(t.item, data.topTracks.map((x) => x.item))
          }))} />
        )}
        {data.topArtists.length > 0 && <TopList title="Top artists" rows={data.topArtists.map((a) => ({ key: `a${a.name}`, title: a.name, sub: `${a.plays} play${a.plays === 1 ? '' : 's'}`, value: a.sec, label: formatSpan(a.sec) }))} />}
        {data.topGenres.length > 0 && <TopList title="Genres" rows={data.topGenres.map((x) => ({ key: `g${x.name}`, title: x.name, value: x.sec, label: formatSpan(x.sec) }))} />}
      </div>

      <LibraryCard data={data} />
    </div>
  );
}

/** Large figure like “42 h 15 m” with the units set small. */
function Big({ sec }: { sec: number }) {
  const total = Math.round(sec / 60);
  const h = Math.floor(total / 60), m = total % 60;
  if (sec > 0 && sec < 60) return <><b>{Math.round(sec)}</b><i>s</i></>;
  return <>{h > 0 && <><b>{h.toLocaleString()}</b><i>h</i></>}{(h === 0 || m > 0) && <><b>{m}</b><i>m</i></>}</>;
}

function Kpi({ icon, label, value, sub }: { icon: LucideIcon; label: string; value: string; sub?: string }) {
  return (
    <div className="kpi card-surface">
      <div className="kpi__label"><Icon as={icon} size={14} /><span>{label}</span></div>
      <div className="kpi__val">{value}</div>
      {sub && <div className="kpi__sub t-footnote secondary">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Charts (plain SVG: no chart library, fully themeable and keyboard-reachable)

const roundedTop = (x: number, y: number, w: number, h: number, r: number) => {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
};

function ActivityChart({ buckets, g }: { buckets: Bucket[]; g: 'day' | 'week' | 'month' }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const H = 220, padL = 44, padR = 8, padT = 10, padB = 26;
  const W = Math.max(280, size.width);
  const maxSec = Math.max(60, ...buckets.map((b) => b.total));
  const { ticks, unit, top } = niceTicks(maxSec);
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const slot = plotW / buckets.length;
  const barW = Math.max(2, Math.min(34, slot * 0.64));
  const y = (sec: number) => padT + plotH - (sec / top) * plotH;
  const fmtDate = (d: Date, long = false) => new Intl.DateTimeFormat(undefined, g === 'month' ? { month: long ? 'long' : 'short', year: long || buckets.length > 12 ? 'numeric' : undefined } : { month: 'short', day: 'numeric', weekday: long && g === 'day' ? 'short' : undefined }).format(d);
  // Show about 6–8 x labels, always starting from the left.
  const every = Math.max(1, Math.ceil(buckets.length / Math.max(2, Math.floor(plotW / 78))));
  const ab = active != null ? buckets[active] : null;
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - r.left) / (r.width / W) - padL) / slot);
    setActive(i >= 0 && i < buckets.length ? i : null);
  };
  const summary = `${buckets.length} ${g}s, busiest ${fmtDate(buckets.reduce((a, b) => (b.total > a.total ? b : a), buckets[0]!).start, true)}`;

  return (
    <div className="chart" ref={ref}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`Time per ${g}. ${summary}`} onPointerMove={onMove} onPointerLeave={() => setActive(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="chart__grid" x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} />
            <text className="chart__axis" x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end">{t === 0 ? '0' : unit === 'h' ? `${t / 3600} h` : `${t / 60} m`}</text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const x = padL + i * slot + (slot - barW) / 2;
          let acc = 0;
          const segs = ([['video', b.video], ['audio', b.audio], ['reading', b.reading]] as const).filter(([, v]) => v > 0);
          return (
            <g key={b.key} className={`chart__bar ${active === i ? 'is-active' : ''}`} tabIndex={b.total > 0 ? 0 : -1} role="img"
              aria-label={`${fmtDate(b.start, true)}: ${formatSpan(b.total)}${b.video ? `, video ${formatSpan(b.video)}` : ''}${b.audio ? `, music ${formatSpan(b.audio)}` : ''}${b.reading ? `, reading ${formatSpan(b.reading)}` : ''}`}
              onFocus={() => setActive(i)} onBlur={() => setActive(null)}>
              <rect className="chart__hit" x={padL + i * slot} y={padT} width={slot} height={plotH} />
              {b.total === 0 && <rect className="chart__zero" x={x} y={y(0) - 2} width={barW} height={2} rx={1} />}
              {segs.map(([k, v], si) => {
                const y1 = y(acc + v), h = Math.max(1, y(acc) - y1);
                acc += v;
                const isTop = si === segs.length - 1;
                return isTop ? <path key={k} className={`chart__seg c-${k}`} d={roundedTop(x, y1, barW, h, 3)} /> : <rect key={k} className={`chart__seg c-${k}`} x={x} y={y1} width={barW} height={h} />;
              })}
            </g>
          );
        })}
        {buckets.map((b, i) => i % every === 0 && <text key={`l${b.key}`} className="chart__axis" x={padL + i * slot + slot / 2} y={H - 6} textAnchor="middle">{fmtDate(b.start)}</text>)}
      </svg>
      {ab && (
        <div className="chart__tip" style={{ left: Math.min(W - 150, Math.max(0, padL + (active! + 0.5) * slot - 70)) }} role="status">
          <div className="chart__tip-title">{g === 'day' ? fmtDate(ab.start, true) : `${fmtDate(ab.start)} – ${fmtDate(ab.end)}`}</div>
          <div className="chart__tip-total">{formatSpan(ab.total)}</div>
          {([['video', 'Video', ab.video], ['audio', 'Music', ab.audio], ['reading', 'Reading', ab.reading]] as const).filter(([, , v]) => v > 0).map(([k, l, v]) => (
            <div key={k} className="chart__tip-row"><span className={`dot c-${k}`} />{l}<span className="tabular">{formatSpan(v)}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniBars({ values, labels, aria, highlight }: { values: number[]; labels: (i: number) => string | null; aria: (i: number, v: number) => string; highlight?: number }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const H = 128, padB = 22, padT = 6;
  const W = Math.max(240, size.width);
  const max = Math.max(1, ...values);
  const slot = W / values.length;
  const bw = Math.max(3, Math.min(26, slot * 0.62));
  const hover = useRef<number | null>(null);
  const [, force] = useState(0);
  return (
    <div className="chart" ref={ref}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group">
        {values.map((v, i) => {
          const h = Math.max(v > 0 ? 3 : 2, (v / max) * (H - padB - padT));
          const x = i * slot + (slot - bw) / 2;
          const peak = highlight === i && v > 0;
          return (
            <g key={i} tabIndex={v > 0 ? 0 : -1} role="img" aria-label={aria(i, v)} className={`chart__bar ${hover.current === i ? 'is-active' : ''}`} onPointerEnter={() => { hover.current = i; force((n) => n + 1); }} onPointerLeave={() => { hover.current = null; force((n) => n + 1); }}>
              <title>{aria(i, v)}</title>
              <rect className="chart__hit" x={i * slot} y={0} width={slot} height={H - padB} />
              {v > 0 ? <path className={`chart__seg c-video ${peak ? '' : 'is-dim'}`} d={roundedTop(x, H - padB - h, bw, h, 3)} /> : <rect className="chart__zero" x={x} y={H - padB - 2} width={bw} height={2} rx={1} />}
              {labels(i) && <text className="chart__axis" x={i * slot + slot / 2} y={H - 6} textAnchor="middle">{labels(i)}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function HourChart({ hourly }: { hourly: number[] }) {
  const peak = hourly.indexOf(Math.max(...hourly));
  return <MiniBars values={hourly} highlight={peak} labels={(i) => (i % 6 === 0 ? hourLabel(i) : null)} aria={(i, v) => `${hourLabel(i)}: ${formatSpan(v)}`} />;
}

function WeekChart({ weekday }: { weekday: number[] }) {
  // Monday first.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const values = order.map((d) => weekday[d] ?? 0);
  const names = order.map((d) => new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(2023, 0, 1 + d)));
  const full = order.map((d) => new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(new Date(2023, 0, 1 + d)));
  return <MiniBars values={values} highlight={values.indexOf(Math.max(...values))} labels={(i) => names[i]!} aria={(i, v) => `${full[i]}: ${formatSpan(v)}`} />;
}

// ---------------------------------------------------------------------------

interface TopRow { key: string; title: string; sub?: string; value: number; label: string; art?: { id: number | null; has: boolean; kind: 'video' | 'audio'; shape: 'wide' | 'square'; version: number }; onClick?: () => void }

function TopList({ title, rows }: { title: string; rows: TopRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <section className="card-surface toplist" aria-label={title}>
      <header className="stats-card__head"><h2 className="t-headline">{title}</h2></header>
      <ol>
        {rows.map((r, i) => {
          const inner = (
            <>
              <span className="toplist__rank tabular tertiary">{i + 1}</span>
              {r.art && <span className={`toplist__art toplist__art--${r.art.shape}`}><Artwork mediaId={r.art.id} hasArt={r.art.has} title={r.title} kind={r.art.kind} shape={r.art.shape} fit="cover" version={r.art.version} /></span>}
              <span className="toplist__text"><span className="toplist__title truncate">{r.title}</span>{r.sub && <span className="toplist__sub truncate secondary t-footnote">{r.sub}</span>}</span>
              <span className="toplist__val tabular secondary">{r.label}</span>
              <span className="toplist__bar" style={{ width: `${(r.value / max) * 100}%` }} aria-hidden="true" />
            </>
          );
          return <li key={r.key}>{r.onClick ? <button type="button" className="toplist__row" onClick={r.onClick}>{inner}</button> : <div className="toplist__row">{inner}</div>}</li>;
        })}
      </ol>
    </section>
  );
}

function LibraryCard({ data }: { data: StatsResult }) {
  const rows = data.library.filter((l) => l.count > 0);
  if (rows.length === 0) return null;
  const totalSize = rows.reduce((a, r) => a + r.totalSize, 0);
  return (
    <section className="card-surface stats-library" aria-label="Your library">
      <header className="stats-card__head"><h2 className="t-headline">Your library</h2><span className="secondary t-footnote">{formatBytes(totalSize)} in total</span></header>
      <div className="lib-grid">
        {rows.map((r) => (
          <div key={r.kind} className="lib-grid__item">
            <div className="lib-grid__kind"><Icon as={KIND_ICON[r.kind]} size={15} />{KIND_LABEL[r.kind]}</div>
            <div className="lib-grid__count tabular">{r.count.toLocaleString()}</div>
            <div className="t-footnote secondary">{formatBytes(r.totalSize)}{r.totalDurationSec > 0 && r.kind !== 'comic' && r.kind !== 'book' && r.kind !== 'image' ? ` · ${formatSpan(r.totalDurationSec)}` : ''}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
