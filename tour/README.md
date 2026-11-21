# The Gramps Connect tour

A narrated, self-playing walkthrough of Gramps Connect, published with the
rest of the repo on GitHub Pages at
<https://dsblank.github.io/gramps-connect/tour/>. Any push to `main`
republishes it.

| File | What it is |
| --- | --- |
| `tour.js` | Everything the tour says and shows: titles, narration, cards, links, button labels. This is the file to edit. |
| `img/*.jpg` | One screenshot per frame, all the same size (here 1519 × 784). |
| `index.html` | The player (camera, pointer, highlighter, read-aloud). It holds no text of its own, apart from the `?edit` tool bar for authors. |

Because all of the words live in `tour.js`, the player can be reused for a
tour of a different app: copy `index.html`, write a new `tour.js`, and add
screenshots.

## The tour.js format

`tour.js` is one JSON object assigned to `window.TOUR`. (It is a script
rather than a `.json` file so the tour still works when `index.html` is
opened straight from disk, where browsers block loading JSON.) Everything
after `window.TOUR =` is plain JSON.

| Field | Meaning |
| --- | --- |
| `lang` | Language of the tour, e.g. `en-US`: the page's language and the read-aloud voice's. |
| `title`, `description`, `icon` | The browser tab's title, the page's description and its icon. |
| `kicker`, `heading`, `intro` | The small label, the heading and the paragraph at the top of the narration column. |
| `screen` | `[width, height]` of every screenshot, in pixels. |
| `address` | Shown in the window's address bar, followed by each scene's `path`. |
| `typeAt` | Default `[x, y]` for typed text (see `type` below). |
| `labels` | The player's button labels and screen-reader text. `{scene}` in `jumpTo` is replaced with a scene's title. |
| `credits` | Below the narration: `paragraphs` (plain text) and `links`. |
| `scenes` | The scenes, in order; see below. |

Each scene has a `title` (shown in the narration column and under the
progress bar), a `path` added to `address` (or an `address` of its own,
which replaces it) and its `steps`. Each step has:

| Field | Meaning |
| --- | --- |
| `text` | The narration: shown on the right, highlighted and read aloud. |
| `img` | Screenshot in `img/`, without `.jpg`. |
| `cam` | `[x, y, zoom]`: where the camera centres, in screenshot pixels; zoom 1 shows it all. |
| `cur` | `[x, y]`: where the pointer moves to. |
| `click` | `true` shows a click ripple when the pointer arrives. |
| `type`, `typeAt` | Text typed into a box at `typeAt` `[x, y]` (default: the tour's `typeAt`). |
| `path`, `address` | Override the scene's `path` or `address` for this step, e.g. when a scene shows several parts of the app. |
| `card` | Shows a card instead of a screenshot, with no `img`, `cam` or `cur`: `logo`, `title`, `subtitle`, `buttons` (`label`, `href`, `primary`) and `links` (`label`, `href`). |

Links starting with `http` open in a new tab; others, like `../`, open in
place. All text is plain text, not HTML.

## Changing the words

Edit the `text` of a step in `tour.js`. The highlighter, the read-aloud
voice, the timing and the progress bar all follow the text, so nothing else
needs to change. Adding, removing or reordering steps and scenes works the
same way. Read aloud, the tour runs about 9 minutes; keep the `heading`
in step if it grows a lot.

## The opening and closing cards

The first scene, **Welcome**, introduces Gramps Connect on a title card
before any screenshots. The last scene, **Where next**, ends on a card
with the same links as the [home page](../index.html): download, hosting,
the documentation, the forum and GitHub. Keep those links in step with the
home page's.

## Changing where the camera and pointer go

Positions are in screenshot pixels, which are hard to guess, so the player
has an edit mode for finding them:

1. Serve the repo locally, for example `python3 -m http.server` from the
   repo root, and open `http://localhost:8000/tour/?edit`. (Opening the file
   directly also works, but copying to the clipboard may not.)
2. Go to the step you want with the arrows or by clicking its line.
3. Click on the screenshot to pick a point, then **Pointer here**,
   **Camera here** or **Typing here**. **Zoom −/+** and **Click** adjust the
   rest. Each change plays straight away so you can see it.
4. **Copy tour.js** copies the whole file with your changes; paste it over
   `tour/tour.js`. **Copy step** copies just the current step.

Edit mode never saves anything itself, so reloading the page discards
changes that weren't copied.

## Adding a screenshot

Take it from the app in a browser window whose page area is 1519 × 784, so
it lines up with the others when the frames crossfade. (A screenshot of a
1920 × 991 page area scaled down by 1.264 comes out at exactly that size;
Claude in Chrome's screenshots of a maximized 1080p window do this.) Move the mouse
pointer off the page first; the player draws its own. Save it as
`img/<name>.jpg` and use `<name>` as the step's `img`.

The tour uses the US Presidents example tree. Photos shown in it come from
Wikimedia Commons; keep the `credits` in `tour.js` in step with any you
add.
