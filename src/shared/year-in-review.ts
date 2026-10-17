import { buildHeatGrid } from './heatmap';
import type { YearInReview } from './insights';
import { formatSpan } from './stats-buckets';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const hour = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'am' : 'pm'}`;
const hours = (sec: number) => {
  const h = Math.round(sec / 360) / 10;
  return h >= 100 ? Math.round(h).toLocaleString('en-US') : String(h);
};
const longDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
};

function list(title: string, rows: { name: string; sub?: string; value: string; pct: number }[]): string {
  if (rows.length === 0) return '';
  return `<section class="card"><h2>${esc(title)}</h2><ol>${rows.map((r, i) => `<li><span class="rank">${i + 1}</span><span class="name">${esc(r.name)}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span><span class="val">${esc(r.value)}</span><i style="width:${Math.max(2, Math.round(r.pct * 100))}%"></i></li>`).join('')}</ol></section>`;
}
const pct = <T,>(rows: T[], f: (r: T) => number) => { const m = Math.max(1, ...rows.map(f)); return (r: T) => f(r) / m; };

/**
 * A single self-contained HTML page: no scripts, no network requests (the CSP meta tag forbids them), every
 * string escaped. It is generated from local history only, so it can be saved, printed to PDF or screenshotted.
 */
export function renderYearInReviewHtml(y: YearInReview): string {
  const grid = buildHeatGrid(y.heatmap, `${y.year}-01-01`, `${y.year}-12-31`);
  const monthMax = Math.max(1, ...y.months);
  const facts: string[] = [];
  if (y.busiestDay) facts.push(`Your biggest day was <b>${esc(longDay(y.busiestDay.day))}</b> with ${esc(formatSpan(y.busiestDay.sec))}.`);
  if (y.longestStreak > 1) facts.push(`Longest streak: <b>${y.longestStreak} days</b> in a row.`);
  if (y.mostActiveHour != null) facts.push(`You were most active around <b>${esc(hour(y.mostActiveHour))}</b>${y.mostActiveWeekday != null ? `, especially on <b>${esc(WEEKDAYS[y.mostActiveWeekday]!)}</b>` : ''}.`);
  const sp = pct(y.topShows, (r) => r.sec), mp = pct(y.topMovies, (r) => r.sec), ap = pct(y.topArtists, (r) => r.sec), tp = pct(y.topTracks, (r) => r.plays), lp = pct(y.topAlbums, (r) => r.sec), gp = pct(y.topGenres, (r) => r.sec);
  const empty = y.sessions === 0;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${y.year} in Gravity</title>
<style>
:root{color-scheme:dark;--bg:#0b0b10;--card:#16161f;--fg:#f5f5f7;--dim:#9a9aa8;--a:#7c5cff;--b:#ff4d8d;--c:#ffb340}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(1200px 600px at 20% -10%,#2a1f5c 0,transparent 60%),var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:48px 24px 64px}h1{margin:0;font-size:clamp(2rem,6vw,3.4rem);letter-spacing:-.03em}
.sub{color:var(--dim);margin:6px 0 28px}.hero{display:grid;gap:6px;margin:28px 0}.big{font-size:clamp(3rem,12vw,6.5rem);font-weight:800;letter-spacing:-.04em;line-height:1}.big small{font-size:.32em;color:var(--dim);font-weight:600;margin-left:.2em}
.split{display:flex;height:10px;border-radius:6px;overflow:hidden;background:#22222d;margin:14px 0 8px}.split span{display:block}.legend{display:flex;gap:18px;flex-wrap:wrap;color:var(--dim);font-size:.9rem}.legend b{color:var(--fg)}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px}.v{background:var(--a)}.m{background:var(--b)}.r{background:var(--c)}
.facts{display:grid;gap:6px;margin:22px 0;color:var(--dim)}.facts b{color:var(--fg)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:24px 0}.kpi,.card{background:var(--card);border-radius:18px;padding:16px 18px}
.kpi b{display:block;font-size:1.8rem;letter-spacing:-.02em}.kpi span{color:var(--dim);font-size:.85rem}
h2{margin:0 0 10px;font-size:1.05rem}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;margin-top:14px}
ol{list-style:none;margin:0;padding:0;display:grid;gap:4px}li{position:relative;display:grid;grid-template-columns:22px 1fr auto;gap:10px;align-items:center;padding:8px 10px;border-radius:10px;overflow:hidden}
li i{position:absolute;left:0;top:0;bottom:0;background:color-mix(in srgb,var(--a) 22%,transparent);z-index:0}li>*{position:relative;z-index:1}
.rank{color:var(--dim);text-align:center}.name{display:grid;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.name small{color:var(--dim)}.val{color:var(--dim);font-variant-numeric:tabular-nums}
.months{display:grid;grid-template-columns:repeat(12,1fr);gap:8px;align-items:end;height:140px;margin-top:8px}.months div{display:grid;gap:6px;align-items:end;height:100%;text-align:center;font-size:.75rem;color:var(--dim)}.months span{display:block;border-radius:6px 6px 2px 2px;background:linear-gradient(var(--a),var(--b));min-height:3px}
.heat{display:grid;grid-template-rows:repeat(7,11px);grid-auto-flow:column;grid-auto-columns:11px;gap:3px;overflow-x:auto;padding-bottom:6px}.heat i{border-radius:3px;background:#22222d}.heat .l1{background:#3b2f78}.heat .l2{background:#5a43b8}.heat .l3{background:#7c5cff}.heat .l4{background:#b39dff}
footer{margin-top:36px;color:var(--dim);font-size:.8rem;text-align:center}
</style></head><body><main>
<h1>Your ${y.year} in Gravity</h1>
<p class="sub">Generated on this computer from your own watch, listen and read history.</p>
${empty ? '<p class="card">Nothing was played in this year.</p>' : `<div class="hero"><div class="big">${esc(hours(y.totalSec))}<small>hours</small></div>
<div class="split" role="img" aria-label="Video, music and reading split">${[['v', y.videoSec], ['m', y.audioSec], ['r', y.readingSec]].filter(([, s]) => (s as number) > 0).map(([c, s]) => `<span class="${c}" style="flex:${s}"></span>`).join('')}</div>
<div class="legend"><span><i class="dot v"></i>Video <b>${esc(formatSpan(y.videoSec))}</b></span><span><i class="dot m"></i>Music <b>${esc(formatSpan(y.audioSec))}</b></span><span><i class="dot r"></i>Reading <b>${esc(formatSpan(y.readingSec))}</b></span></div></div>
<div class="facts">${facts.map((f) => `<div>${f}</div>`).join('')}</div>
<div class="kpis"><div class="kpi"><b>${y.titles.toLocaleString('en-US')}</b><span>titles played</span></div><div class="kpi"><b>${y.activeDays}</b><span>active days</span></div><div class="kpi"><b>${y.sessions.toLocaleString('en-US')}</b><span>sessions</span></div><div class="kpi"><b>${y.longestStreak}</b><span>day best streak</span></div></div>
<section class="card"><h2>Month by month</h2><div class="months">${y.months.map((s, i) => `<div title="${esc(MONTHS[i]!)}: ${esc(formatSpan(s))}"><span style="height:${Math.round((s / monthMax) * 100)}%"></span>${MONTHS[i]}</div>`).join('')}</div></section>
<section class="card" style="margin-top:14px"><h2>Every day of ${y.year}</h2><div class="heat" role="img" aria-label="Activity calendar">${grid.cells.map((c) => `<i class="l${c.level}" style="grid-column:${c.col + 1};grid-row:${c.row + 1}" title="${esc(c.day)}: ${esc(formatSpan(c.sec))}"></i>`).join('')}</div></section>
<div class="grid">
${list('Top shows', y.topShows.map((r) => ({ name: r.title, sub: `${r.episodes} episode${r.episodes === 1 ? '' : 's'}`, value: formatSpan(r.sec), pct: sp(r) })))}
${list('Top movies', y.topMovies.map((r) => ({ name: r.title, sub: r.year ? String(r.year) : undefined, value: formatSpan(r.sec), pct: mp(r) })))}
${list('Top artists', y.topArtists.map((r) => ({ name: r.name, sub: `${r.tracks} track${r.tracks === 1 ? '' : 's'}`, value: formatSpan(r.sec), pct: ap(r) })))}
${list('Top songs', y.topTracks.map((r) => ({ name: r.title, sub: r.artist, value: `${r.plays} play${r.plays === 1 ? '' : 's'}`, pct: tp(r) })))}
${list('Top albums', y.topAlbums.map((r) => ({ name: r.album, sub: r.artist, value: formatSpan(r.sec), pct: lp(r) })))}
${list('Top genres', y.topGenres.map((r) => ({ name: r.name, value: formatSpan(r.sec), pct: gp(r) })))}
</div>`}
<footer>Made locally by Gravity. Nothing was uploaded.</footer>
</main></body></html>`;
}
