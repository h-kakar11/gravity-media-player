# Feature 05 — Library Health

Branch: `agent/05-library-health`. **Read-only.** The scan never writes to the database or the disk. The only things the
UI can do to a file are *Reveal in Folder* and — after an explicit confirmation — *Move to Trash* on a member of a
duplicate group, both through the existing `shell:reveal` / `shell:trash` handlers.

## Where it lives

Settings → **Library Health** (next to *Tidy Library*). Press **Check Library**; results are grouped as Duplicates,
Missing episodes and Problem files, each finding with a plain-language explanation and, per file, a Reveal button.

## What it checks

| Finding | How it is decided |
| --- | --- |
| **Duplicate movies** | Same normalised title (case, accents and punctuation ignored) and year. A file with no year joins the only year present for that title; if the title has several years it is left out (it could be either film). `cd1`/`cd2`/`part 2` releases are never duplicates of each other. |
| **Duplicate episodes** | Same show (case-insensitive), season and episode number. A missing season counts as season 1. |
| **Lower-quality copies** | Inside each duplicate group the best copy is chosen by resolution → codec generation (AV1 > HEVC > VP9 > H.264 > MPEG-4 > MPEG-2) → bitrate → size → path (deterministic). Every other copy lists why it ranks lower ("Lower resolution (720p vs 1080p)", "Older codec (H.264 vs HEVC)", "Lower bitrate (3.0 vs 12.0 Mbps)"); identical copies are duplicates but not "lower quality". Bitrate is estimated from size ÷ duration when the container reports none, and differences under 15 % are ignored. |
| **Missing episodes** | Per season that exists locally. If the show has a synced online episode list (see below) the missing numbers are that list minus local files, ignoring episodes that have not aired yet, and each is named. Otherwise only *interior gaps* in the local numbering are reported (never before the first or after the last file, never season 0, never a gap of more than 100). |
| **Unreadable files** | The file exists but `open`/`read` fails (permissions, lock, I/O error). |
| **Zero-length files** | 0 bytes on disk (or in the database when disk checks are off). Comic folders are not flagged. |
| **Missing files** | Indexed but gone from disk (or already marked missing by the library). |
| **Possibly damaged** | Video/audio the indexer could not read a duration from. |

A file is reported once, under its most serious problem (missing > unreadable > empty > damaged). Hard links to one inode
are not counted as copies, and do not add to the "could be reclaimed" figure.

## Safe by construction

* **Read-only SQL** over `media`/`roots` (plus `meta_episode` when present). A test snapshots `media`, `state`, `roots`
  and the schema before and after a scan and asserts they are byte-identical.
* **Never deletes on its own.** *Move to Trash* is offered only on duplicate-group files, always behind a confirmation
  that names the file, its path and size and the copy that would be kept, and uses the system Trash (recoverable) via the
  existing `shell:trash`. The list is re-scanned afterwards.
* **Partial failures are findings or warnings, not crashes.** A library folder that is offline is skipped with a
  warning (its files are *not* all reported unreadable). A checker that throws, a 15 s per-file timeout (dead network
  share), and an unreadable file each become one finding. Each category is capped at 1000 findings with a notice.
* **Concurrent requests share one scan**, so a double-click does not walk the library twice.
* Optional **Check files on disk** switch: off gives a fast, database-only pass.
* No network access of any kind, no secrets involved.

## Design

```
src/shared/health.ts            report types (no logic beyond labels)
src/main/health/quality.ts      pure ranking + reasons (unit-tested)
src/main/health/scan.ts         HealthScanner: SQL → findings; injectable FileChecker + clock
src/main/ipc.ts                 'health:scan'  (HealthScanner is created inside registerIpc; no Services change)
src/renderer/views/settings/HealthPane.tsx + styles/health.css
```

IPC: `'health:scan': [[options?: { checkFiles?: boolean }], HealthReport]` (one line in `src/shared/ipc.ts`).

## Database

**No tables, no migrations.** Nothing is persisted; reports live in the renderer until the user leaves Settings.

The missing-episode check reads `meta_episode` (created by feature 01, *Episode metadata*) **if it exists**, via a
`PRAGMA table_info` probe that requires `series_key`, `season` and `episode` columns (`title`, `air_date` optional).
Without the table — or with one of a different shape — it falls back to numbering gaps. This branch does not depend on
01 being merged; the integration tests create a table with 01's schema themselves to cover the online path.

## Dependencies

None added.

## Limitations

* Duplicates are matched by title/year and show/season/episode, not by content hashing, so two different films with the
  same title and no year can be grouped (the explanation says "matched by title only"), and different *editions* of one
  film (Theatrical / Director's Cut) are listed as duplicates. Nothing is ever acted on automatically.
* Multi-episode files (`S01E01E02`) are filed under their first episode number only, so the second number can show as
  "missing".
* Anime that uses absolute episode numbering across seasons can show false gaps (or be compared against the wrong
  season's online list).
* Missing-episode accuracy online depends on 01: only seasons present locally have a synced list, and AniList has titles
  but no air dates.
* The disk check opens each file and reads one block; on a very large library or a slow network share a full check takes
  a while (it runs 16 files at a time and the pane shows a spinner). There is no progress bar or cancel yet.
* A file briefly locked by another program (a download in progress) shows as unreadable until the next check.
* The trash action removes a file from the library immediately (existing `shell:trash` behaviour), but a file already
  re-scanned elsewhere will reappear on the next scan.
