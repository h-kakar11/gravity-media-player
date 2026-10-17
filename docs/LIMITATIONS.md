# Known limitations

Gravity is a working application, not a mock-up — but it has edges. This is the honest list, grouped by how much it
is likely to matter. Anything marked **untested** is implemented but has not been exercised on real hardware or a real
OS by the author.

## Verification status

| Area | Status |
|---|---|
| Linux (x64) | Built, packaged (`npm run pack`), launched and driven end to end under Xvfb with software rendering. Unit, integration and end-to-end suites pass. |
| macOS | **Untested.** Native vibrancy, hidden-inset title bar, menu bar, `open-file`, Spotlight-style drive detection (`diskutil`), DMG packaging are written against the Electron docs only. |
| Windows | **Untested.** Mica backdrop, title-bar overlay, `Get-PhysicalDisk` drive detection, NSIS installer, file associations are written but unverified. |
| Real GPUs / hardware decode / hardware encoders | **Untested.** The test machine has none. Hardware encoders are chosen by test-encoding at run time, and every conversion falls back to software x264, so a bad driver degrades to "slower", not "broken" — but this path has only been exercised in software. |
| High-refresh displays (120–360 Hz) | **Untested on hardware.** 120 and 300 fps clips play at their source rate in the test environment (`High Frame Rate (2023).mp4`, `Smooth 120 (2022).mp4`), and nothing in Gravity limits the rate, but actual presentation at 240–360 Hz was not measured. |
| Large libraries | The indexer and database are designed for tens of thousands of files (quick scans, batching, FTS5, virtualised lists) but were only exercised on a ~25-file generated library. No 100k-file benchmark has been run. |
| Screen readers | Controls are real buttons with labels, roles and focus handling, and all of it is keyboard-operable; it has **not** been tried with VoiceOver, NVDA or Orca. |
| Installers | Built unpacked on Linux only. They are **unsigned and un-notarised**, and there is **no auto-update**. |

## Formats

* **Books: EPUB only.** MOBI, AZW/AZW3/KFX, FB2, PDF, DjVu and TXT are not supported. There is no format called "EBK"
  that Gravity recognises. Supporting more formats means adding a parser or renderer per format (FB2 and MOBI are
  mostly a conversion to the same HTML pipeline; PDF needs a renderer such as pdf.js). EPUB scripts and media overlays
  are intentionally not run; fixed-layout EPUBs are shown as ordinary flowing pages. DRM-protected books cannot be opened.
* **Comics: CBZ and folders of images.** CBR (RAR), CB7 (7-zip) and CBT (tar) are not supported — RAR in particular needs a
  non-free decoder. Convert with any archive tool (rename a ZIP of the pages to `.cbz`).
* **Video** depends on what the bundled Chromium and your OS can decode. HEVC, AC-3/E-AC-3/DTS/TrueHD, 10-bit and
  HDR often need ffmpeg: they play, but through a remux or a real-time conversion. HDR sources are **tone-mapped to SDR
  when converted** (and need an ffmpeg build with `zscale`/`tonemap`); played directly, HDR is whatever Chromium and the
  OS present. Dolby Vision layers are not interpreted. DVD/Blu-ray folders, ISOs, menus and disc subtitles are not
  supported; neither are network streams or URLs — only files the OS can see as paths.
* **Bitmap subtitles** (PGS, VobSub, DVB) cannot be drawn by the overlay; they are burned into a converted stream, so
  switching them restarts the session.
* **ASS/SSA** is rendered by a deliberately simple overlay: text, italic/bold/underline and top/middle/bottom
  alignment. Styles, fonts, colours, positions, animations, karaoke and vector drawings in the script are ignored (your
  subtitle style from Settings applies instead). Typesetting-heavy fansubs will look plainer than in a full renderer.
* **Audio**: DSD is converted to PCM; CUE sheets, multi-track images (single-file albums) and tracker formats are not
  supported. ReplayGain uses tags only (no loudness analysis of untagged files).

## Playback

* **Picture-in-Picture** is Chromium's native element PiP: it shows the picture only. Gravity's own subtitle overlay is
  part of the page and is **not visible in the PiP window**. Use the Overlay window mode (always on top, shows subtitles)
  or burned-in subtitles instead.
* **Speed 0.1×–5×**: audio keeps playing across the whole range (verified in the end-to-end suite), time-stretched by
  Chromium with pitch preserved. Quality degrades at the extremes (at 0.1× and above 4× speech becomes artefact-prone);
  that is the engine's algorithm, not something Gravity can tune.
* **Frame rate.** Gravity never throttles or resamples frame rate, but what you *see* is bounded by the display's
  refresh rate, the compositor (60 fps unless **Uncap frame rate** is on, which needs a restart), the GPU and the
  decoder. Software decoding of 300 fps 1080p content will drop frames on most CPUs; hardware decoding helps only if the
  driver exposes it to Chromium.
* **Seek accuracy on converted streams.** Remuxed (stream-copy) starts land on the preceding keyframe; the clock reports
  the real position, so a seek can start up to one GOP early. Re-encoded streams seek exactly.
* Seek-bar thumbnails come from keyframes, so they are approximate for long-GOP files.
* **Gapless/crossfade** use two pre-loaded audio elements and are accurate to a few milliseconds, **not
  sample-accurate**; encoder padding is whatever Chromium's decoders trim. Crossfade needs both tracks to be directly
  playable (not converted).
* **Audio output** goes through the browser engine's mixer to the system. Exclusive mode, bit-perfect output, sample-rate
  switching and ASIO/WASAPI-exclusive are not available. Output-device choice uses `setSinkId`, which Chromium exposes
  on all three platforms but which depends on OS device naming.
* The **equaliser** is a graphic EQ applied to Gravity's own output: it can't process audio from other apps, has no
  per-device profiles and doesn't (yet) import AutoEQ/Equalizer APO files.

## Library

* **Network shares** (SMB/NFS/WebDAV mounted as folders) work, but file-system notifications often don't arrive
  for remote changes; Gravity then relies on a 15-minute quick scan. Drive-type detection returns *unknown* for them.
* **Naming heuristics are local-only.** There is no online lookup (by design): titles, years, seasons and episodes come
  from file and folder names, tags and `.nfo` files. Unconventional naming (absolute anime numbering, multi-episode
  files, several versions of one film) can group imperfectly. Fix it with an `.nfo` or by renaming; Gravity follows.
* No multi-user profiles, parental controls, smart playlists, scrobbling, podcasts or internet radio.
* Search is prefix/word based (SQLite FTS5); it is not typo-tolerant.
* A file's **inode** is used to follow renames. On filesystems that don't keep stable inodes (some network shares,
  FAT/exFAT) a move falls back to matching size and modification time, and a *copy then delete* can lose the link.

## Interface

* English only; no localisation framework yet. The reading direction can be right-to-left, but the app chrome does not
  mirror for RTL languages.
* Window material (vibrancy/mica) is a platform feature; elsewhere Gravity draws its translucent surfaces with CSS
  backdrop blur, which costs GPU time on weak hardware (turn on *Reduce transparency* for solid surfaces).
* Native menu accelerators on Windows and Linux are display-only (the in-app dispatcher handles the keys); on macOS a
  rebound shortcut that collides with a system or menu key may be consumed by the OS first.

## Security and privacy notes

* The renderer is sandboxed and has no filesystem or network access; the privileged `gravity://` scheme only serves
  items that exist in the library database. Anything opened from outside the library (drag and drop, "Open with…")
  is indexed first, then served by id.
* ffmpeg runs as a child process on files you chose. If you point Settings at a custom ffmpeg binary, that binary runs
  with your user rights.
* There is no telemetry and no update check, which also means you must update by hand.

## Licensing

* No licence has been chosen for Gravity's own source yet.
* The bundled ffmpeg from `@ffmpeg-installer` is a GPL build, run as a separate program. If you redistribute
  installers, you are responsible for the GPL source offer for that binary; swapping in an LGPL build or relying on a
  system ffmpeg avoids that. See `THIRD_PARTY_LICENSES.md`.
