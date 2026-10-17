# Feature 04 — Watchlist, Up Next and new-episode badges

Branch: `agent/04-watchlist-up-next`. Gravity Home gets two new shelves — **Up Next** (the next unplayed episode of each
show you are partway through) and **Watchlist** (a manual list of movies and shows) — plus **New** badges for episodes that
arrive after you started following a show. A **Watchlist** page in the sidebar manages all of it.

## What the user sees

| Where | What |
| --- | --- |
| Sidebar → **Watchlist** (Collections group, after Favourites) | Page with an *Up Next* section and the saved list. Add… opens a library search; rows have Play, Move up/down, Remove; *Clear Watched* (confirmed) drops finished items. Up Next rows have *Dismiss new episodes* and *Hide from Up Next*. |
| Home → **Up Next** shelf | One card per show, newest activity first. Click or ▶ plays that episode with the rest of the show queued. Context menu: Play, Open Show, Dismiss New Episodes, Hide from Up Next, Add to/Remove from Watchlist. A `New` / `n new` pill marks fresh episodes. |
| Home → **Watchlist** shelf | Unwatched, available items in the order you arranged them. Hidden when empty. |
| Home → Continue Watching | When the Up Next shelf is on, this keeps to things actually under way (partly watched), so an episode is not offered twice. Turning Up Next off restores the old behaviour. |
| Show page, Movie page | Bookmark button (toggle). |
| Movie right-click menu | *Add to Watchlist* / *Remove from Watchlist*. |
| Show cards (Videos → Shows, search, …) | `n new` pill (shown on hover like other badges). |
| Settings → Appearance → Home shelves | The two shelves can be reordered or hidden like any other. |

## Rules

* **Up Next** — a show qualifies once any numbered episode has been played or started. The suggestion is the first
  unplayed, unstarted episode *after the furthest episode reached* (so skipping ahead and finishing S02E01 does not drag
  you back to S01E05). A partly-watched episode is the frontier and is owned by *Continue Watching*. Order: most recently
  played show first, then title, then key — stable, never shuffles.
* **Specials (season 0)** are never suggested and are not needed to finish a show, but a new special still counts as new.
* **Several files for one episode** share a slot; a later duplicate does not make the episode "new".
* **New episodes** — unplayed episodes whose `media.added_at` is later than when you started following the show. "Following
  since" is the latest *Dismiss* mark, otherwise the earlier of your first playback and the day you added the show to
  the watchlist. Shows with no relationship to you never get badges.
* **Hide from Up Next** hides the show until something is played again.
* **Adding an episode adds its show** (a single episode is not something you plan to watch).
* **Offline items stay on the list** (muted, "Not in your library") and can always be removed. They are not treated as watched.

## Design

```
src/shared/watch.ts                       types + watchKey()
src/main/watch/upnext.ts                  pure planner (planShow, compareUpNext) — no DB, no clock
src/main/watch/service.ts                 WatchService: overview / keys / badges / update (SQL, 3 queries per overview)
src/main/ipc.ts                           WatchService is constructed inside registerIpc (the Services interface is unchanged)
src/renderer/state/watch.ts               store + debounced reload on library revision
src/renderer/components/WatchCards.tsx    UpNextCard, WatchlistCard, menus, toggle
src/renderer/components/NewEpisodesBadge.tsx
src/renderer/views/Watchlist.tsx          the page and Add sheet
src/renderer/styles/watch.css
```

Up Next and new counts are **derived on every read** from playback state and `added_at`; only the watchlist and the
two per-show marks are stored, so there is nothing to drift out of sync or to repair when files move.

### IPC

All four channels sit together under `// [04] watchlist and Up Next` in `src/shared/ipc.ts` (no preload change):

| Channel | Returns |
| --- | --- |
| `watch:overview` | `{ upNext: UpNextEntry[], watchlist: WatchlistEntry[] }` |
| `watch:update(action)` | `{ overview, changed }` — actions: `add`, `remove`, `reorder`, `clearWatched`, `hideUpNext`, `markSeen` |
| `watch:badges` | `{ [seriesKey]: newEpisodeCount }` |
| `watch:keys` | `string[]` of `watchKey`s on the list (cheap, for toggles and menus) |

Show keys are the database's `series_key` and are **opaque**: SQLite's `lower()` is ASCII-only, so the renderer passes
them back exactly as received and never re-cases or trims them.

## Database

One migration in the named registry (`src/main/db/migrations.ts`, slot `// [04] watchlist and Up Next`), name
`04-watchlist`, idempotent (`IF NOT EXISTS`, `INSERT OR IGNORE`), tracked in `schema_migrations`:

| Table | Purpose |
| --- | --- |
| `watchlist(id, kind, media_id, series_key, title, added_at, position)` | `kind` is `movie` (FK to `media`, `ON DELETE CASCADE`) or `show` (by `series_key`); a `CHECK` enforces exactly one of the two, unique partial indexes forbid duplicates. `title` is remembered so an offline entry stays readable. |
| `show_tracking(series_key, seen_at, hidden_at)` | The two per-show marks. `WITHOUT ROWID`. |

The migration also **seeds `show_tracking.seen_at` = now for every show already watched**, so existing users do not see a
burst of false "new" badges on first launch. It does not use `user_version` and does not alter existing tables.

## Dependencies

None added.

## Tests

* `tests/unit/up-next-plan.test.ts` — the planner: frontier, skipping ahead, specials, duplicates, unnumbered files,
  partial episodes, new-episode baseline, ordering.
* `tests/integration/watchlist.test.ts` — service against a real SQLite database: add/remove/reorder/clear, duplicate
  and invalid targets, persistence across reopen, offline entries, progress, ordering, hide/seen marks, badge counts,
  non-ASCII show names, migration idempotence and seeding.
* `tests/unit/settings.test.ts` — the new shelves and sidebar item are normalised into older saved settings.
* `tests/e2e/watchlist.test.ts` — drives the real built app: sidebar entry, search-and-add, show page toggle, Up Next on
  Home and the Watchlist page, playing the suggestion (correct episode, full queue), a file arriving after the show was
  followed (badge appears, then is dismissed), hide, remove, and no renderer errors.

## Limitations

* Unnumbered episodes cannot be sequenced and are ignored by Up Next.
* Multi-episode files (S01E01-E02) count by their first number.
* A show with only specials has an episode count of 0 and never reaches Up Next.
* "New" depends on `media.added_at` (first time the file was indexed). Playing a show *while the library is still doing
  its first scan* can flag episodes indexed afterwards as new.
* Hide/seen marks for an unknown key create a harmless row.
* There is no *Dismiss New Episodes* control on the Show page or the show card itself — only in the Up Next/Watchlist
  rows and context menus. Episode context menus have no "add show to watchlist" (the opaque key is not derivable from a
  single item).
* The Up Next list is capped at 30 shows (the Home shelf scrolls horizontally and its title links to the Watchlist page).
* The e2e test needs a display and is not part of CI (like the other e2e files). On Windows the shared harness
  (`scripts/e2e-harness.mjs`) builds the app path from `URL.pathname` and cannot launch Electron; I patched that locally to
  run this test and did not include the change, because it is a shared file unrelated to this feature (`fileURLToPath` fixes it).
  Electron also refuses to start if `ELECTRON_RUN_AS_NODE` is set in the environment (as it is inside VS Code terminals).

## Suggested README lines

> **Up Next & Watchlist** — Home shows the next episode of every show you're partway through, plus a Watchlist of movies
> and shows you mean to watch. Shows that gain new episodes are badged.
