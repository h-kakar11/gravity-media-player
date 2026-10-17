# Architecture

Gravity is an Electron application: a Node.js main process that owns the data and does the heavy lifting, and a
sandboxed React renderer that owns the pixels. There is no server and nothing listens on the network.

```
┌────────────────────────── main process (Node 24, Electron 44) ───────────────────────────┐
│  settings-store ─ window manager ─ menu                                                   │
│  db (node:sqlite) ─ repo / playlists / stats                                              │
│  library: indexer ─ watcher (@parcel/watcher) ─ extract (music-metadata, nfo) ─ art       │
│  media:   ffmpeg/ffprobe wrapper ─ playback-service ─ sprites ─ subtitles ─ lyrics        │
│  readers: zip cache ─ epub ─ comic                                                        │
│  ipc.ts (typed handlers) ─ protocol.ts (gravity://)                                       │
└──────────────▲──────────────────────────────────────────▲────────────────────────────────┘
               │ invoke / events (contextBridge)           │ gravity://app/… (media, art, streams, UI)
┌──────────────┴───────────── preload ──────────┐  ┌──────┴──────────── renderer (Chromium 152) ────────┐
│  window.gravity.invoke / on / pathForFile      │  │ React 19 · zustand · @tanstack/react-virtual       │
└────────────────────────────────────────────────┘  │ views · players · readers · audio graph · styles   │
                                                    └─────────────────────────────────────────────────────┘
```

## Process boundaries and security

* `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. The renderer has no filesystem access.
* The only bridge is `window.gravity`, generated from one typed contract (`src/shared/ipc.ts`): every channel is
  `name → [args, result]`, so a handler or a call with the wrong shape fails `tsc`.
* The renderer **never names a file path** to read. It refers to media by database id; the main process maps an id to
  a path. Paths only flow outward (to display) or in through explicit user actions (dialogs, drops via
  `webUtils.pathForFile`).
* `gravity://app/…` is a privileged custom scheme (standard, secure, `stream`, `corsEnabled`). It serves, with Range
  support: the original media bytes (`/media/:id`), live ffmpeg output (`/stream/:sid`), artwork (`/art/:id?s=…`),
  seek-preview sprites, comic pages, EPUB entries (`/book/:id/…`) and — in production — the renderer bundle itself.
  Books are served with a restrictive CSP and rendered in a sandboxed, script-less iframe.
* The renderer's CSP is `default-src 'self' gravity:` with no remote origins. Nothing in the codebase makes an outbound
  request.

## Data model (`src/main/db`)

SQLite via the built-in `node:sqlite`, WAL mode, schema version tracked with `PRAGMA user_version`.

| Table | Purpose |
|---|---|
| `roots`, `dirs` | Library folders and every directory seen (with its mtime, for quick scans) |
| `media` | One row per file (or per comic folder): kind, parsed title/series/season/episode/album…, technical info, artwork keys, `missing` flag, inode/device |
| `probe` | Cached ffprobe JSON, fetched on demand |
| `state` | Per-item user state: favourite, rating, notes, progress, position, location (page / EPUB position), completed, play count |
| `history` | One row per viewing/listening session (feeds Continue Watching and Statistics) |
| `playlists`, `playlist_items` | Playlists; items are entries, so one track can appear twice |
| `collection_state` | Favourited albums, series and folders |
| `media_fts` | FTS5 index (external-content) for instant search across titles, artists, albums, series, plots |

`state` is keyed by `media.id`, which is why a renamed or moved file keeps its favourites and progress.

## The indexer (`src/main/library`)

Designed for large libraries on spinning disks:

1. **Quick scan.** A directory is re-read only if its mtime changed since last time. Unchanged subtrees cost one `stat`.
2. **Sequential, sorted walk.** Directories are visited depth-first in natural-sort order, so a rotational drive's head
   moves forward instead of seeking. Concurrency is 1 on hard drives and 6 on flash. `library/drive.ts` asks the OS
   what each library folder lives on (Linux: `/sys/dev/block/…/queue/rotational`; macOS: `diskutil`; Windows:
   `Get-PhysicalDisk`) and remembers the answer; network shares and virtual disks come back *unknown* and get 3. The
   setting can force "always gentle" or "always fast", and the parallelism can be pinned by hand.
3. **Cheap change detection.** Files are skipped when `size` and `mtime` are identical; only changed files are
   re-parsed.
4. **Moves are renames, not deletes + adds.** A new file is matched to a vanished row by inode/device/size, then by a
   unique (size, mtime) twin. A row that was relinked in the same pass is never marked missing.
5. **Nothing is forgotten hastily.** Vanished files become `missing` (hidden, kept for 30 days). If a root's folder
   can't be reached or is suddenly empty (an unplugged drive, an unmounted share), the scan aborts and marks the root
   offline instead of wiping its rows.
6. **Watching.** `@parcel/watcher` uses FSEvents / inotify / ReadDirectoryChangesW — kernel notifications, not
   polling. Events are debounced (1.5 s) into targeted directory rescans. A polling fallback covers filesystems that
   don't deliver events.
7. **Lazy artwork.** Cover art, video frames and comic covers are generated on demand by a LIFO queue (what the user is
   looking at first) with sharp, cached on disk with a size budget, and trimmed LRU. Seek-preview sprite sheets are made
   from keyframe-only ffmpeg seeks (6×5 tiles) the first time a video is played.

Metadata comes only from the files themselves: names (`parse-name.ts`), embedded tags (`music-metadata`), `.nfo`
sidecars, folder images, ffprobe.

## Playback (`src/main/media`, `src/renderer/lib/video-engine.ts`)

A **planner** (`src/shared/playback-plan.ts`, pure and unit-tested) decides how to play a file, from the ffprobe result
and what the renderer reports via `canPlayType` / `mediaCapabilities`:

| Mode | When | Cost |
|---|---|---|
| `direct` | container and codecs are supported | none: the file is served with Range requests into `<video>` |
| `remux` | codecs are fine but the container, or the choice of audio track, isn't | `ffmpeg -c copy` into fragmented MP4 on stdout: lossless, nearly free |
| `transcode` | video or audio codec unsupported, HDR tone-mapping, bitmap subtitles to burn in | real-time H.264/AAC; hardware encoders (VideoToolbox, NVENC, QSV, AMF, VAAPI) are found by *test-encoding*, not by name |

The fallback chain is direct → remux → transcode, retried automatically if the element reports a decode error.
Conversion never writes a file; ffmpeg output streams straight to the renderer over `gravity://app/stream/:sid`.

Because a converted stream starts wherever the user seeked, each session carries `offsetSec`; the UI clock is
`offset + element.currentTime`. Seeking inside the buffered range just moves the element; outside it, a new session
opens at the target (for stream copy, at the preceding keyframe, with the real start time reported back). Frame rate
is never touched: there is no `fps` filter anywhere in the pipeline, so 120/300 fps sources stay 120/300 fps.

Subtitles are parsed in the renderer (SRT/VTT/ASS → sanitised cues) and drawn by Gravity's own overlay, so size,
colour, background, outline, position and delay work identically for every source. Bitmap subtitles are burned in by
ffmpeg. Chapters, audio-track labels and HDR/10-bit flags come from ffprobe.

Watch history is recorded by a tracker that counts *wall-clock* viewing time (so 2× speed doesn't double your hours)
and media time separately, and ignores sessions under five seconds.

## Audio (`src/renderer/lib/audio-graph.ts`, `music-engine.ts`)

Music and video share one Web Audio graph:

```
source → trim → preamp → 10-band biquad EQ → night-mode compressor → make-up → limiter → [mono] → balance → master → analyser → output
```

All of it runs in 32-bit float, so boosting a band cannot clip before the limiter. Parameter changes are ramped to
avoid zipper noise. The EQ's drawn curve is computed from the *actual* filters (`getFrequencyResponse`), so what you
see is what you hear. Output device selection uses `AudioContext.setSinkId`.

The music engine owns two `<audio>` elements for gapless transitions and crossfade, applies ReplayGain from tags,
resumes long audiobooks (> 20 min) where they stopped, and exposes transport through the same layer that feeds the
Media Session API, hardware media keys and the mini player. FLAC/Opus/etc. play natively; formats Chromium lacks go
through the same ffmpeg pipeline (as FLAC).

## Renderer

* **State**: small zustand stores (`settings`, `router`, `library`, `ui`, `reader`, plus the video and music engines).
  Settings updates are optimistic and confirmed by the main process (`settings:changed`).
* **Routing**: a tiny history stack in `state/router.ts`; sections, detail pages, playlists, search and settings are
  routes, so Back/Forward and ⌘[ ⌘] work everywhere.
* **Lists**: grids, tables and column views are virtualised (`@tanstack/react-virtual`) so a 100k-item library scrolls
  at display rate. Artwork loads lazily and decodes off-thread.
* **Live data**: `useLibraryQuery` re-runs when the library revision changes (the main process coalesces bursts of file
  events into a few notifications a second).
* **Hotkeys**: `src/shared/hotkeys.ts` declares every action once (label, group, scope, default keys). The renderer's
  dispatcher, the native menu accelerators, the shortcut sheet and the rebinding UI all read that registry. Scopes
  (global / player / music / reader) decide which handler wins; typing in a field suppresses single-key shortcuts.
* **Readers**: `ComicReader`, `EpubReader` and `ImageViewer` share chrome (`readers/shared.tsx`) and a reading-session
  hook that debounces progress saves and records active reading time. EPUBs are paginated with CSS columns inside the
  sandboxed iframe; the position is `{spine, fraction}`, so it survives font-size changes.
* **Window modes** (`src/main/window.ts`): normal, mini (always on top, follows the picture's aspect ratio for video)
  and overlay (frameless, always on top, aspect-locked, adjustable opacity, optional click-through with a global
  shortcut to get back). The previous geometry is restored on return.

## Design system (`src/renderer/styles`)

Following Apple's Human Interface Guidelines:

* **Two layers.** An opaque *content* layer (artwork, lists, text) and a translucent *functional* layer (sidebar, toolbar,
  player controls, menus). Translucency is used sparingly, never behind long text, and replaced by solid surfaces when
  *Reduce transparency* is on (or on the OS). The toolbar only gains a material once content scrolls under it.
* **Type.** A macOS-like scale on a 13 px base (SF Pro on Apple platforms, Inter elsewhere), scaled by the user's text
  size. Large titles collapse into the toolbar.
* **Colour.** Semantic tokens for light and dark plus Midnight, Paper and High Contrast themes. Eight accents, each with a
  light-mode and a dark-mode value; text-on-accent and accent-on-surface contrast is asserted by a unit test.
  Artwork-derived ambient colour tints detail pages and Now Playing.
* **Spacing & shape.** A 4 px grid and concentric radii.
* **Motion.** Springs for direct manipulation, short fades otherwise; everything is disabled under *Reduce motion*.
* **Accessibility.** Real buttons/roles/labels, visible focus rings, keyboard access to every control (including chart
  bars), `aria-live` for toasts and counters, no information conveyed by colour alone.

## Performance choices

* Scans touch the disk as little as possible (above); the database is the working set, not the filesystem.
* Writes are batched (transactions per directory, debounced settings and progress saves).
* No timers poll the library; no watcher polls (except the fallback).
* The renderer virtualises lists (only what is on screen is mounted, and only mounted cards request artwork); the main
  process generates artwork lazily, newest request first, a few at a time (one on a hard drive), into a cache sized by a
  user budget.
* `backgroundThrottling` is off, so playback timers, crossfades and progress saving continue when the window is hidden.
* Optional Chromium switches (frame-rate limit off, hardware decode toggles) are applied before the app is ready.

## Testing strategy

| Layer | Where | What it proves |
|---|---|---|
| Unit | `tests/unit` | Pure logic: name parsing, subtitle/lyrics/NFO parsers, playback planner, ffmpeg arguments, settings merging and clamping, hotkey normalisation and conflicts, spread pairing, stats bucketing, packaging config |
| Integration | `tests/integration` | The real indexer, database and artwork service over a generated sample library: scans, quick scans, renames/moves, deletions, offline roots, FTS search, thumbnails |
| End to end | `tests/e2e` | The built app under Playwright: live library updates, every route, search, playback in each mode (direct, remux, transcode, speeds 0.1–5×, seeking, tracks, subtitles, resume), music formats and EQ, readers and progress, settings and rebinding, statistics, mini/overlay windows |

`scripts/make-sample-media.mjs` builds the fixture library with ffmpeg (multi-audio MKV with chapters and subtitles,
HEVC + AC-3, 120 and 300 fps clips, 10-bit, AVI, tagged audio with covers and lyrics, GIF/PNG/WebP, CBZ and image-folder
manga, an EPUB), so tests never depend on copyrighted files.
