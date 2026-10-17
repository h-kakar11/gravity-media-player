# Feature 01 — Fix Match everywhere, and per-episode metadata

Branch: `agent/01-episode-metadata`. Online lookups stay strictly opt-in (Settings → Metadata); nothing here runs, and
nothing leaves the machine, unless the user has turned them on.

## What it does

* **Fix Match** is now on movie pages and album pages as well as show pages. It reuses `meta:search` / `meta:apply`.
  Album searches send `album\u0001artist` (the existing MusicBrainz convention). The sheet shows what the item is
  currently matched to, and whether the user chose it.
* **Episode titles and summaries.** After a show is matched (by hand, or by "Match Now"), the app fetches each episode's
  title, summary and air date and stores them locally. They are shown in the episode list on the show page and on the
  episode's own page.
  * **TMDB:** one request per season that exists in the library (`/tv/{id}/season/{n}`); unknown seasons (404) are skipped.
  * **AniList:** episode titles only (AniList has no per-episode summaries) and only when the service lists streaming
    titles; otherwise the rows exist but are empty. AniList has no seasons, so everything is filed under season 1.
* **Refresh Episode Info** (show page, matched shows only) re-fetches on demand and reports what happened.
* **Match Now** (Settings → Metadata) also back-fills episode info for shows matched before this feature existed
  (including manual matches), refreshes info older than 14 days, and picks up seasons added to the library since.
  It never searches again and never changes an existing match.

## Rules that protect existing data

1. **Nothing is written into `media.title` or `media.plot`.** Episode text lives in its own table and is merged at
   display time by `mergeEpisodeText` (`src/shared/metadata.ts`).
2. **Local text always wins.** A title that came from the file name, tags or a `.nfo` is kept; online text is used only
   where the local title is empty or the scanner's `Episode N` placeholder, and only where the local summary is empty.
   So `.nfo` metadata is never overwritten, by construction.
3. **Locked matches are never replaced.** Manual picks are `locked = 1`; auto-match skips shows that already have a
   match. The back-fill reads the stored provider id and does not search.
4. **A different match drops the old show's episode rows** (same transaction as the new match). Re-picking the *same*
   show keeps them, so a failed re-fetch costs nothing.
5. **Failures never lose the match.** If episode info cannot be fetched (offline, bad key, provider down), the match is
   saved and `meta:apply` returns `episodeError` with a readable reason; the UI shows it as a notice. A season that
   fails keeps its previous rows while the other seasons refresh.
6. **Secrets.** The TMDB key is never stored in `meta_cache` (explicit cache keys) and is scrubbed from error messages.

## Database

Migration `01-episode-metadata` (named, in `src/main/db/migrations.ts`; see "Migrations" in `docs/ARCHITECTURE.md`):

```sql
CREATE TABLE IF NOT EXISTS meta_episode (
  series_key TEXT NOT NULL,   -- lower-cased series name = media.series_key
  season INTEGER NOT NULL,
  episode INTEGER NOT NULL,
  provider TEXT NOT NULL,     -- 'tmdb' | 'anilist'
  ext_id TEXT NOT NULL,       -- the provider's show id this row came from
  title TEXT, plot TEXT, air_date TEXT,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (series_key, season, episode)
) WITHOUT ROWID;
```

No dependencies were added.

## IPC

| Channel | Purpose |
| --- | --- |
| `meta:apply` | **Return type changed** from `number` to `MetaApplyResult { rows, episodes, episodeError }`. |
| `meta:episodes` | Stored episode info for a show (local read; works offline and with lookups turned off). |
| `meta:episodesSync` | Re-fetch for an already matched show; rejects with a readable reason when nothing could be fetched. |
| `meta:run` | `MetaRunResult` gained `episodes` (shows whose episode info was filled or refreshed). |

## Also fixed

Album matches were applied with `kind = 'music'`, but audio rows are stored as `'audio'`, so applying a match to an album
saved the match and updated no rows (the online cover was never applied). The filter now uses `'audio'`. The new
integration test covers it.

## Limitations

* AniList: titles only, season 1 only, and only when AniList lists streaming episode titles.
* A multi-episode file (`S01E01-E02`) is looked up by its first episode number.
* Only seasons present in the library are fetched. A season added later is picked up by "Match Now" or Refresh.
* Episodes with no season number are shown under season 1, matching how the show page already groups them.
* The back-fill is manual ("Match Now"); the app never calls a provider on its own.
* Poster artwork for episodes is not fetched (out of scope); the existing frame thumbnails are unchanged.

## Tests

* `tests/unit/episode-metadata.test.ts`: TMDB/AniList parsing, credential handling (v3 query param vs v4 header, never
  cached), 404/401/500/network failures, and the `mergeEpisodeText` matrix. All network is mocked.
* `tests/integration/episode-metadata.test.ts`: end-to-end through `MetadataService` with a mocked fetch and an in-memory
  database: storing, local-season selection, local text untouched, offline/total/partial failure, match change, clear,
  disabled lookups, back-fill, 14-day staleness, new-season pickup, early stop on a rejected key, the movie plot/year
  non-overwrite regression, and the album fix.
* `tests/unit/migrations.test.ts`: the migration registry (shared foundation).
