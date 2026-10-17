# 06 — Synced lyrics and LRCLIB

Now Playing already showed time-synced lyrics from a sidecar `.lrc` or embedded tags, with the current
line highlighted and click-to-seek. This adds an opt-in online source, [LRCLIB](https://lrclib.net)
(free, no key), and a way to keep what it finds.

## Order of sources

1. A `.lrc` file next to the song.
2. Lyrics embedded in the file's tags.
3. LRCLIB, only if **Settings → Audio → Online lyrics (LRCLIB)** is on.

Synced local lyrics always win. If the local lyrics are plain text and LRCLIB has synced lyrics, the synced
version is shown. If the local lyrics are plain and LRCLIB only has plain text, the local text stays.

## What is sent

When you open a song's lyrics with the switch on, one request goes to `lrclib.net` with the song's
**title, artist, album and duration** (rounded to seconds). No file content, paths or identifiers are sent.
Songs with no title or no artist tag are never looked up. Nothing is sent while the switch is off (default).

## Caching and offline

Responses are cached in `meta_cache` (`lrclib:get:…`, `lrclib:search:…`) for 30 days. A "not found" is
remembered for 7 days (`lrclib:miss:…`) so a song is not retried on every play. A network failure is not
remembered as a miss, and falls back to whatever local lyrics exist, so offline use is silent.

## Matching

An exact lookup (`/api/get`, needs artist, title, album and duration) is tried first. If it 404s or has no
lyrics, `/api/search` runs and results are filtered to within 3 s of the file's duration, preferring synced
lyrics and then the closest duration. Instrumental tracks show "No lyrics".

## Saving a sidecar

- **Save as .lrc** appears under synced lyrics that came from LRCLIB.
- **Save found lyrics** (Settings → Audio) writes the `.lrc` automatically the first time synced lyrics
  are found.
- Files are written next to the song with the same name and a `.lrc` extension, and an existing file is
  **never overwritten**. A read-only folder shows an error toast; the lyrics still display.

## Honest status

Covered by unit tests with a mocked `fetch` (matching, caching, misses, offline, sidecar writes). **Not tried
against the live LRCLIB service** from the build environment; the request shapes follow LRCLIB's published
`/api/get` and `/api/search` documentation.

## Files

`src/main/lyrics/lrclib.ts`, `src/shared/lrclib.ts`, `src/renderer/styles/lyrics.css`,
`tests/unit/lrclib.test.ts`; hooks in `src/main/ipc.ts`, `src/renderer/music/NowPlaying.tsx` and the Audio
settings pane.
