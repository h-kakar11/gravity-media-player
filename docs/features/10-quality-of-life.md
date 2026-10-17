# 10 · Quality-of-life pack

Six small features that make everyday use smoother. Each lives in its own files and was added in its own commit.

## 10.1 Command palette

`Ctrl/Cmd+K` opens a search box over the whole app (press it again, or `Esc`, to close). It lists:

- every page in the sidebar,
- every hotkey action that applies right now (player actions only while a video plays, and so on), each with its current shortcut,
- library matches for what you typed: titles, albums, shows and artists.

The palette is built from `SIDEBAR` and `shared/hotkeys.ts`, so a new page or action appears in it without extra work. Ranking is in `shared/palette.ts`. The shortcut is an ordinary action (`app.palette`) and can be rebound in Settings → Keyboard. It uses a modifier, so it still works while a text field has focus, and it does not interfere with typing.

## 10.2 Drag-and-drop folders

Drop files or folders on the window:

- media files play straight away,
- folders that are not yet in the library are offered as new library folders,
- folders already covered by a library folder are left alone, and the result says why.

`library:classifyPaths` (main) decides what each dropped path is; `shared/drop.ts` holds the rules and `renderer/lib/drop.ts` the prompts. Dropping several folders at once asks once. Where one dropped folder contains another, only the outer folder is added.

## 10.3 "Recently added" everywhere

The sort menu offers *Recently Added* on Videos, Music (albums and songs), Favourites, Playlists, Comics, Books and Photos. Sorting stays in `renderer/lib/sort.ts` and the view controls. The songs table gains an optional *Added* column.

Known gaps, listed rather than papered over:

- The Artists tab has no such sort: artists have no timestamp of their own, and giving them one needs a change in `src/main/db`.
- Browse (folders) has no added date.
- The first scan stamps every item with the scan time, so a freshly added library shows no meaningful order until new files arrive.
- Ties in the repository's `ORDER BY m.added_at DESC, m.id` break by ascending id.

## 10.4 Chapter thumbnails

- The seek bar snaps to a chapter boundary when the pointer is within 7 px of it, and the hover preview names the chapter (`shared/chapters.ts`).
- The chapters button opens a strip of chapter thumbnails over the player. `←`/`→` move between them, `Enter` jumps, `Esc` closes. The chapter being watched is marked.
- Thumbnails come from the existing seek-preview sprites, so they cost nothing extra. If previews are turned off or not generated yet, the cards show the chapter number and time instead.

## 10.5 Skip intro and credits

A **Skip Intro** or **Skip Credits** button appears while playing inside such a stretch (`Shift+K` does the same from the keyboard). The stretch is found in this order:

1. A chapter in the file called *Intro*, *Opening*, *Credits*, *Ending* or similar, in a plausible position and of a plausible length (`detectFromChapters`).
2. Markers you saved for that show.

To save markers, play an episode and use the command palette (or bind the actions in Settings → Keyboard): *Mark Intro Start*, *Mark Intro End*, *Mark Credits Start*, *Forget Skip Markers for This Show*. The intro is stored as an absolute stretch; the credits as a distance from the end, because episodes differ in length. Markers apply to every other episode of the same show (matched by series name, ignoring case) and are an approximation: an episode with a cold open may need its own chapter or a re-mark.

Settings → Video → *Skip intro & credits* has two switches, both off by default: skip intros automatically, and skip credits automatically (which moves on to the next episode). Each segment is auto-skipped at most once per viewing, so rewinding into it works. The same pane lists shows with saved markers and lets you forget them.

Markers live in `settings.json` under `skip.markers`; no database tables were added.

## 10.6 First-run welcome

A one-time dialog for an empty library: add a folder, the palette shortcut, and a note that everything stays local and online lookups are off by default (with a link to Settings → Metadata). It never switches anything on. `Esc` or *Skip for now* dismisses it for good (`welcome.done` in settings). A library that already has folders is marked done without the dialog ever showing.

## Tests

Unit: `palette`, `drop`, `sort`, `chapters`, `skip`, `welcome`. End to end: `palette`, `welcome`. The drop flow has no end-to-end test, because the test driver cannot supply real file paths to a drop event.
