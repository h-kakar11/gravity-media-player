# Smart playlists

Rule-based playlists whose members are computed from the library every time they are opened, so they follow ratings, plays, favourites and new files with no bookkeeping.

## Using it
- Sidebar → **Playlists** → the filter button (**New Smart Playlist**). Smart playlists are listed with the ordinary ones (filter icon); right-click for *Edit Rules…* / *Delete*.
- The editor builds nested groups: *Match all / any of the following*, with **Add rule** and **Add group**. A live preview shows the match count, duration and first titles.
- Rules: **genre** and **artist** (is / is not / contains; artist also matches album artist), **year** and **rating** (is, at least, at most, more than, less than, between), **play status** (unplayed / played), **recently added** (last N days), **favourite**. Order by title, date added, last played, year, rating or shuffled; optional limit.
- The page plays like a normal playlist (Play, Shuffle, double-click a row).

## Design
- `src/shared/smart.ts` types; `src/main/smart/rules.ts` validation + SQL translation; `src/main/smart/service.ts` storage and evaluation.
- Only rules are stored (`smart_playlists.definition`, JSON, `CHECK json_valid`). No item copies.
- **Parameterized SQL only.** `parseDefinition` rebuilds a clean definition from a whitelist of fields, operators and sorts (unknown keys are dropped, anything else is rejected); `compile` emits constant SQL fragments with `?` for every value. Limits: depth 5, 60 rules, 200 chars per text value, limit ≤ 10 000.
- Members are playable (`video`/`audio`), present (`missing = 0`) files. A NULL year never satisfies a year rule; unrated counts as 0 stars. Text matching uses `instr(lower(..), lower(?))`, so `%`/`_` are literal; SQLite `lower()` is ASCII-only.
- A stored definition that fails validation shows as an empty playlist with an error and can be rebuilt in the editor; it never breaks the sidebar.

## IPC / DB / deps
- Channels `smart:list|create|update|delete|items|preview` (types referenced inline in `src/shared/ipc.ts`). Changes emit the existing `playlists:changed` event.
- Migration `03-smart-playlists` in the named registry (slot `// [03] smart playlists`): one new table. No dependencies.

## Tests
`tests/unit/smart-rules.test.ts` (validation, translation) and `tests/integration/smart-playlists.test.ts` (real SQLite: every rule, AND/OR/nesting, sorting/limits, lifecycle, corrupt rows, persistence, SQL-injection attempts).

## Limitations
- Genre "is" splits stored genres on `;` `/` `,`; other separators are only found by "contains".
- Smart playlists can't be dragged into, and aren't offered in "Add to Playlist". They don't appear on the Music → Playlists grid, only in the sidebar.
- Evaluated per request (capped at 5 000 items per open); very large libraries recompute counts in the sidebar on every library change.
- The editor UI was verified by typecheck/build only (no screenshot or e2e run).
