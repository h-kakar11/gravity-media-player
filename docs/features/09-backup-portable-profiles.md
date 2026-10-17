# 09 — Portable profile backup & restore

Settings → Performance → Database: **Export profile…** / **Import profile…**

## File format (`gravity-profile`, version 1)
One JSON file: `media[]` (only items with user data), `playlists[]`, `favorites[]` (albums/series), `matches[]`.
Media is identified by **path relative to its library folder + file size** (plus kind, title, library name as tie-breakers) — never by database id or absolute path.
Contains: ratings, notes, favourites, play count, last played, position/progress, completed, history sessions, playlists (ordered), album/series favourites, metadata matches.
Never contains: settings, API keys, tokens, absolute paths, poster URLs with credentials/query strings (only plain `https` links are kept).

## Import
1. Pick file → size cap (200 MB), JSON parse, strict validation (format name, version, ranges, sizes, unsafe `..` paths, dangling playlist/match references; unknown keys dropped). A newer version is refused with an explanation.
2. **Preview**: the same merge code runs in a transaction that is rolled back, so the preview equals the result.
3. **Apply** (one transaction): nothing is deleted or blindly overwritten.
   - Matching: relative path + size (library name breaks ties) → else file name + size + kind if unique ("found at a different location") → otherwise skipped as ambiguous/unmatched and listed.
   - State: favourite/completed OR-ed, play count and last-played take the max, position/progress from the more recently played side, empty fields filled. Rating and notes that differ are **conflicts**.
   - History de-duplicated on (item, kind, start time). Playlists merge by name (case-insensitive), appending missing items. Favourites only added. Matches only added; a differing local match is a conflict. Blank media fields are filled as when a match is applied (no network).
   - Conflict policy chosen in the sheet: *keep mine* (default) or *use backup*.

## Limitations
Not included: smart playlists, watchlist, folder favourites (keys are absolute paths), settings, per-episode metadata, poster images (re-fetched on next metadata run). Matching depends on file size, so re-encoded files are treated as different. No migration/dependency changes.
