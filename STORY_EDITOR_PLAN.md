# Story Editor plan

An editor for `.story.zip` files on the Story Viewer site: open a story (or
start a blank one), change its slides, photos, places and maps, and save a
new `.story.zip`. Runs entirely in the browser, like the viewer; nothing is
uploaded.

It works on the file, not on a tree. A story is a snapshot (see
STORY_FORMAT_PLAN.md), and edits made here never flow back to Gramps or
Gramps Connect. That's deliberate: two-way sync between a file and a tree
is where this would stop being simple.

Who it's for:

- Gramps desktop users. The Generate Story addon has no editing at all;
  this is where they'd polish its output before sharing.
- Whoever receives a story and wants to fix or add to it.
- Anyone without Gramps who wants to make a story by hand.

## What's shared with Gramps Connect, and how

Gramps Connect already has most of the hard parts, but tied to its API:

| In the app | What it does | Coupling |
| --- | --- | --- |
| `store/mapEditModel.ts` (235 lines, tested) | features ⇄ terra-draw parts, nothing lost on the way | pure |
| `store/kmlMedia.ts` `parseMapFile`, `rotatePoint`, `scalePoint`, `mercatorDistance`, `mercatorBearing`, bounds helpers | KML/GPX/GeoJSON → features (@tmcw/togeojson); overlay geometry | pure parts mixed with API fetches in one file |
| `store/mapFileWrite.ts` | features + image overlays → GeoJSON | pure |
| `components/MapItemEditorDialog.tsx` (2158 lines) | terra-draw drawing, name/color/opacity panel, image overlay move/resize/rotate/corner-drag | API, auth, place pickers and saving woven through |
| `components/story/StoryTextField.tsx` | text with Bold/Italic buttons (`**`/`*` markup) | Mantine + app `t()` |
| `app/src/store/edtf.ts` | Gramps date → EDTF | needs a parsed Gramps date |

The two story editors don't edit the same thing. The app's StoryEditor
edits a StorySpec, whose slides are *references* (an event, a media
object) resolved at presentation time. The file editor edits a StoryDoc,
whose slides *are* the content. So one shared editor doesn't fit, but its
parts do.

**Decision: the shared "UI library" is the story package itself.** A new
entry point, `@gramps-connect/story/editor`, holds data-agnostic pieces
that both use:

- the map editor (shapes and image overlays), as a component taking
  features, overlays and an image resolver, and reporting changes. No
  fetching or saving: the app's MapItemEditorDialog becomes a wrapper that
  loads from and saves to gramps-web-api around it.
- the map-editing model and geometry helpers (moved from the app with
  their tests).
- the story text field.
- the slide list (reorder, add, duplicate, delete), generic over the slide
  type, so the app's StoryEditor can use it for StorySpec points.

**Decision: these components use Mantine** (v8, React 18), as an optional
peer dependency of the `/editor` entry only. The app already uses Mantine,
so the shared parts look and behave the same in both places at no extra
cost, and building forms, popovers and color pickers by hand would be most
of the work. The player stays as it is: no UI library, so the embed stays
small.

Strings: the editor takes a strings object, like the player's
`strings.ts`, with English defaults. The app passes its `t()` translations
in.

## Format rules the editor must keep

- **Keep what it doesn't understand.** Unknown fields on the story, a
  slide, a place, an overlay or a media item are carried through
  untouched. Otherwise opening and saving a story from a newer program, or
  one with extension data, would silently lose things. A round-trip test
  covers it.
- Save only valid stories: the validator runs as you edit; errors block
  Save and point at the slide and field.
- Media nothing refers to any more is left out on save; identical files
  are stored once (by content hash).
- Spec version stays 1.0. If the editor needs something the format can't
  say, that's a spec change first, not an editor feature.

## Layout

Three columns on a wide screen, stacked on a narrow one:

1. **Slides**: the list, with each slide's title, date and a small photo;
   drag to reorder; add, duplicate, delete. A **Story** item at the top for
   story-wide settings.
2. **The selected slide's form** (below).
3. **Preview**: the real StoryPlayer, kept on the slide being edited.

Toolbar: Open, New, Save, Undo/Redo, and **Present** (the player full
screen, starting at this slide).

## Phases

### Phase 0: move the map-editing core into the package (built 2026-10-23, no visible change)

- Moved `mapEditModel.ts` and its tests, the pure parts of `kmlMedia.ts`
  (`parseMapFile`, geometry helpers, bounds) and `mapFileWrite.ts` into the
  package. `kmlMedia.ts` keeps only its API fetches.
- They're their own entry, `@gramps-connect/story/map-edit` (plain
  functions: no React, Mantine or map library), not part of `/editor`, so
  the app's map code doesn't pull in the editor. Names are kept as they
  were (`isKmlRegion`, `kmlBounds`, ...), so the move changes no behavior.
- `@tmcw/togeojson` is a package dependency now, not the app's.
  terra-draw and its maplibre adapter become optional peers of `/editor`
  in Phase 1, with the component that uses them.
- GeoJSON parsing and the geometry are tested in the package; GPX and KML
  parsing stay tested in the app, which has jsdom's DOMParser.
- The app imports these from the package. App tests and typecheck
  unchanged; you check maps and the overlay editor still behave the same.

### Phase 1: split the map editor out of MapItemEditorDialog (built 2026-10-23, no visible change)

- `MapEditor` in the package: the terra-draw canvas, drawing toolbar,
  name/color/opacity panel, and the image overlay handles (move, resize,
  rotate, corner drag, opacity). Props: features, overlays, `resolveImage`,
  basemap/dark, strings, `onChange`.
- MapItemEditorDialog keeps everything that touches the tree: loading the
  file, place picking, Wikidata lookup, creating and saving media, the
  Modal. It renders `MapEditor` inside.
- This is the riskiest step (a 2158-line component). Done in small commits
  with your check of the overlay editor after each, the same way the
  stacked-dialogs work went.

### Phase 2: the editor, text first (built 2026-10-23)

- Viewer site: an **Edit** button on an open story, and **New story** on
  the landing page. The editor is its own page, `edit.html` (its own
  bundle, so the viewer doesn't load Mantine); the viewer hands it the
  story through the draft, which is also what survives a reload.
- Story settings: title, language, opening text, cover photo, map on or
  off.
- Slide form: title; text (the shared text field); date as the label
  readers see ("about 1850") plus the precise form the timeline and map
  modes use. The precise form is suggested from the label and can be
  corrected (see open question 2).
- Slide list, live preview, validation, Undo/Redo (snapshots of the doc).
- Save: downloads `<title>.story.zip`. In Chrome and Edge, **Save** writes
  back to the opened file (File System Access API), with **Save As** for a
  new one.
- An unsaved draft is kept in the browser (IndexedDB), offered back on the
  next visit; a closed tab doesn't lose work. Per browser only.
- Tests: Playwright on the site, as now: open the example, change a
  slide's text and date, reorder, save, read the saved zip back and
  validate it, and check unknown fields survived.

### Phase 3: photos (built 2026-10-23, released in 0.3.0)

- Add, replace or remove a slide's photo by picking, dropping or pasting.
  `optimizeImage` (already in the package) sizes it to 1600px WebP and, by
  re-encoding, drops camera and GPS details. Safari can't encode WebP, and
  falls back to JPEG, as now.
- Caption, credit and alt text.
- More than one photo per slide: the editor allows it (with ↑/↓ to order
  them), and the player shows the first with thumbnails to switch.
- A photo the story already has (same bytes) is reused, not stored twice;
  photos no slide uses are left out on save.

### Phase 4: places (built 2026-10-23, released in 0.4.0)

- A place is a name plus a point: click the map to set it, drag the pin to
  move it, or type coordinates.
- Search by name, opt-in: the one thing in the editor that sends anything
  out. Wikidata, as in the app's place lookup (no API key, CORS allowed).
  The package has its own two calls (`editor/placeSearch.ts`: search, then
  the item's P625), since the app's lookup also walks the "located in"
  chain to build a hierarchy, which a story place doesn't need. A host
  passes `placeSearch` to use another service, or null to leave it out.
- Reusing a place: the place field offers the story's other places, so
  every slide in Zürich points at the same coordinates and overlays.

### Phase 5: shapes and historical maps (built 2026-10-23, released in 0.5.0)

As built: **Edit map** under the place opens `PlaceMapDialog`, full
screen, on a copy (Cancel drops it, Done is one undo step). The overlay's
years are a compact field in the map editor's side panel (MapEditor's
`renderOverlayOptions`); the format has no overlay name, so that field is
hidden (`overlayNames={false}`). Imported files go through `addFeatures`
(map-edit's `addToSession`), after what's there. The player now fills an
area at its own `opacity`, as the app's Map view does.


- The slide's place gets **Edit map**, opening the shared `MapEditor` on
  `place.geometry` and `place.overlays`.
- Shapes: draw, or import a KML, GPX or GeoJSON file (`parseMapFile`).
- Historical map images: add a scan (optimized for overlays: 2048px, PNG
  when it has transparency); it starts centered on the place's current
  view, then you move, resize, rotate or drag its corners, with opacity to
  line it up. Then its date range (when it shows in the Historical map
  mode) and order.
- Converting between the story format's `place.geometry` + `overlays[]`
  and the editor's features + image overlays is a small pure function,
  tested both ways.

### Phase 6: Gramps Connect uses the shared pieces

- The app's StoryEditor switches to the package's slide list and text
  field. Its slides stay references; only the controls are shared.
- Anything learned in the file editor that the app's story editor lacks
  (Undo/Redo, the side-by-side preview) is offered for the app here, as its
  own change with its own wiki update.

## Releases

- The first phase that adds the `/editor` entry is package 0.2.0; each
  later phase is a minor release, the site going live as each lands.
  Phases 0–1 move app code, so the app's submodule pointer moves on the
  same commit.
- Wiki: phases 0–1 change nothing visible. Phase 6 and anything the app
  gains update `Stories-and-Photos.md` (and `Maps.md` if the overlay
  editor looks or acts differently). The editor itself is documented on
  the viewer site and in the stories repo README.

## Decisions (settled 2026-10-23)

1. **Mantine** for the shared `/editor` components, as an optional peer
   dependency of that entry only. The player stays without a UI library.
2. **`@gramps-connect/gramps-date` turns date text into EDTF**, in the
   story's language, with the result shown and correctable. Bundling the
   private package wasn't possible (the stories repo builds on its own), so
   it was published to npm instead (0.1.0, 2026-10-23, released from
   gramps-connect by `gramps-date-v*` tags), and `toEdtf` moved into it from
   the app. The editor takes `parseDateText` to use another parser.
3. **Saving in place** only where File System Access exists (Chrome,
   Edge); elsewhere Save downloads `<title>.story.zip`.
4. **Order: Phases 2, 3, 4 first**, so the editor is usable sooner; then
   0 and 1 (moving the map code), then 5 (shapes and historical maps),
   then 6.
