# 08 — Stats upgrades and year in review

Extends the Statistics page. Everything is computed on this computer from the existing `history` table;
no new tables, nothing is uploaded.

## What's new

- **Top shows, genres, artists and albums** with more detail: episodes watched per show, tracks per
  artist, video-vs-music split per genre, and a new *Top albums* list (compilations group under the album artist).
- **Streaks**: the current streak plus your best streak and when it was.
- **Calendar heatmap** of the last 53 weeks (one cell per day, shaded in quarters of your busiest day).
  It ignores the Week/Month/Year filter on purpose; hover a cell for the day's total.
- **Year in review**: pick a year, see the headline numbers, and **Export…** a single self-contained web
  page (`gravity-<year>-in-review.html`). It has no scripts and no network requests (a CSP meta tag forbids
  them), and every title is HTML-escaped. Open it, print it to PDF or screenshot it. A PNG export is not
  included.

## Counting rules

These apply to all of the new insights (`src/shared/insights.ts`):

| Case | Rule |
| --- | --- |
| Session shorter than **5 s** | Ignored: not counted in rankings, the calendar, streaks, or the review. |
| Record longer than **24 h** | Treated as corrupt (a crash or clock jump left it open) and ignored. |
| Session crossing midnight | Belongs entirely to the local day it **started** on; it is not split. |
| Day boundary | Local calendar days (SQLite `localtime`), so DST changes never drop or double a day. |
| Streak | Consecutive local days with a counted session. Still "current" if the latest day is today or yesterday. Always computed from all history, whatever range is selected. |
| Multi-genre titles | Full time is credited to every genre listed ("Action; Sci-Fi" counts for both); case differences merge. |
| Title with no genre / series / album | Counts toward totals and the calendar, but not toward that ranking. |
| Unknown artist | Grouped as "Unknown Artist". |

The existing headline numbers (total time, sessions, the activity chart) still use `StatsRepo` and count every
record. The streak shown on the page now uses the 5 s rule above (it previously used 10 s) so the number
matches the calendar.

## Files

`src/main/stats/insights.ts` (queries), `src/shared/insights.ts`, `heatmap.ts`, `year-in-review.ts` (pure
logic and the HTML renderer), `src/renderer/views/stats/Insights.tsx`, `src/renderer/styles/insights.css`,
tests in `tests/unit/insights.test.ts`. The queries live outside `src/main/db/` on purpose.

## IPC

`stats:insights` (range), `stats:yearInReview` (year), `stats:exportYearInReview` (year; opens a save dialog).
