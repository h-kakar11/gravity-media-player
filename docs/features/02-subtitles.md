# 02 — Online subtitle search (OpenSubtitles)

Find and download subtitles from inside the player. Off by default.

## Using it

1. **Settings → Metadata → Online subtitles**: turn the switch on and paste your own
   [OpenSubtitles.com API key](https://www.opensubtitles.com/consumers). Add your
   OpenSubtitles username and password too if you want downloads (see below).
2. In the player, open the subtitles menu and choose **Find Subtitles Online…**.
3. Pick a result. It is saved next to the video and switched on straight away.

## What is sent

Only when you open the search and press Search/Download:

- the video's **moviehash** (file size plus a checksum of the first and last 64 KiB — not the file),
- the title, or series name with season and episode, and release year,
- the language codes you asked for,
- your API key (and, for downloads, your login).

Nothing is sent in the background and nothing is sent while the switch is off.

## Where things are stored

- **Downloads** go to a sidecar next to the video, named `Movie.en.srt` (`Movie.en.sdh.srt` for
  hearing-impaired). Existing files are never overwritten: identical content is reused, different
  content gets a numbered name (`Movie.en.2.srt`). Files are converted to UTF-8 and checked to
  contain at least one cue; downloads over 5 MB, non-https links and bad payloads are rejected.
- If the video folder is read-only, the file goes to `<cache>/subtitles/<mediaId>/` instead and is
  still discovered by the player.
- **Search results** are cached in `meta_cache` (`opensubtitles:search:…`, 12 hours). The API key
  is never part of a cache key.

## Secrets

The key, username and password live in `settings.json` beside the TMDB key (plain text, like TMDB).
They are **blanked when settings are exported** and **kept from the local copy when settings are
imported** (`src/main/secrets.ts`, covered by tests). Error messages never contain them.

## Rate limits

Requests to `api.opensubtitles.com` go through the shared `MetaHttp` queue (one at a time per
host, with a minimum gap). HTTP 429 is reported as "rate limit reached"; the download quota
returned by the service is shown when available.

## Honest status

- Covered by unit tests with a mocked `fetch`: hashing, parameters, caching, error mapping, login,
  download, sidecar naming, the read-only fallback and secret redaction.
- **Not verified against the live OpenSubtitles service** — no key was available while building.
  OpenSubtitles requires a logged-in token for `/download`; this implementation logs in with your
  username and password and keeps the token in memory for 20 hours. If their API differs from the
  documented v1 behaviour, the error is shown in the sheet.
- Files under 128 KiB have no moviehash and fall back to title search.

## Files

`src/main/subtitles/{opensubtitles,moviehash}.ts`, `src/main/secrets.ts`,
`src/shared/subtitle-search.ts`, `src/renderer/player/SubtitleSearch.tsx`,
`src/renderer/styles/subtitle-search.css`, `tests/unit/opensubtitles.test.ts`.
