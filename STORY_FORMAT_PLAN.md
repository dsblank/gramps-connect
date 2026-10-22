# Portable Story Format + open viewer — plan

Status (2026-10-22): **Phase 1 done.** The
[gramps-connect-stories](https://github.com/dsblank/gramps-connect-stories)
repo has the 1.0 spec, JSON Schema, examples and the package core
(`readStoryZip`, `writeStoryZip`, `validate`, `upgradeStory`,
`optimizeImage`, `mediaBlob`), and is the `packages/story` submodule here,
with CI checking it out and testing it. **Phase 2 done** the same day:
Download on a story, with the privacy dialog (see Phase 2's notes).
**Phase 3 done** the same day too: Present runs on the package's
`StoryPlayer` (see Phase 3's notes). **Phase 4 built** the same day:
the Gramps Connect Story Viewer is live at
https://dsblank.github.io/gramps-connect-stories/, with the
`<gramps-connect-story>` embed and the npm packaging ready; the first npm
publish is waiting on the `@gramps-connect` scope (see Phase 4's notes).
**Phase 5 built** too: the Python writer, and the Gramps 6.0 **Export
Story** addon on branch `story-export-gramps60` of the addons-source fork,
not yet a pull request. Decisions are under [Settled decisions](#settled-decisions);
what's still open is under [Open questions](#open-questions).

## Goal

Today a story is a Note of type "story" whose text is a `StorySpec`
(`app/src/store/storyBuilder.ts`): a title and a list of points that are
mostly **handles** (`eventRef`, `mediaRef`) plus seeded `title`/`text`.
Only gramps-connect, logged in to the same tree, can present one:
`storyHydration.ts` resolves those handles against the live tree every
time it's opened, and `StoryView.tsx` fetches every photo through the
authenticated API.

The aim is to separate the **story** from the **database and the code**:

1. **A documented, versioned format** for a finished story: one zip
   holding `story.json` and every image it needs, with no handles and
   no API calls required.
2. **Download** from gramps-connect: a button next to "Present", opening
   a small dialog with privacy options.
3. **An open-source viewer** that presents any such file: a static web
   page, a React component, and an embeddable web component.
4. **Other programs can write the format** (Gramps desktop, Gramps Web,
   a script, a different genealogy program) and get the same
   presentation for free.

## Settled decisions

- **`format` identifier: `gramps-connect-story`** (settled 2026-10-22),
  matching the repo and package names. Permanent now that Download ships.

- **One zip file, always.** `story.json` plus a `media/` folder, in a
  single `.story.zip`. No bare-JSON variant: one packaging means one
  loader and nothing to choose between.
- **Repo: `gramps-connect-stories`**, under the user's own GitHub
  account, next to `gramps-connect`.
- **License: AGPL-3.0-or-later**, the same as gramps-connect. That lets
  code move between the two repos freely. Consequence: a site that embeds
  a *modified* viewer must offer its source; using the published viewer
  unmodified is unaffected.
- **Images are optimized for presentation**, not archived. The export
  re-encodes each image to a viewer-sized version (see
  [Image optimization](#image-optimization)); originals stay in the tree.
- **Privacy options are switches in the Download dialog**, in the same
  style as the report options dialog (e.g. Fan Chart's "Include data
  marked private"), not a fixed default.
- **One shared package**, used by both gramps-connect and the viewer
  site, so there is exactly one implementation of the format and one
  renderer (see [The shared package](#the-shared-package)).

## The key design decision: export the *hydrated* story, not the spec

The stored `StorySpec` is deliberately references-only, so that edits to
the tree show up next time. That's right inside the app and wrong for a
portable file: handles mean nothing outside the tree.

`HydratedStory`/`HydratedSlide` (`storyHydration.ts`) already *is* almost
exactly the portable shape: title, text, place title, lat/long, date
text, year, photo, place overlays. So:

- **Inside the tree** nothing changes: the Note keeps storing the
  references-only `StorySpec`.
- **Download** = hydrate (as Present already does), convert to the
  portable document, fetch and optimize the images, zip. It's a
  **snapshot**: the file doesn't change when the tree does, which is what
  you want from something you email to a cousin.
- **gramps-connect's own Present uses the shared player**: hydrate,
  convert to the portable document in memory, hand it to the same
  component the standalone viewer uses. One renderer, not two, and every
  story presented in the app tests the format. If the format can't
  express something the app shows, it shows up in the app right away.

## The format (v1.0)

### Packaging

A `.story.zip` file:

```
my-family.story.zip
├── story.json
└── media/
    ├── m1.webp
    ├── m2.webp
    └── m4.png
```

- `story.json` is at the root. A viewer that doesn't find it rejects the
  file ("not a story").
- Media `src` values in `story.json` are paths relative to the zip root.
  Nothing points outside the zip, so a story works offline, forever.
- The `.story.zip` double extension keeps it openable by any unzip tool,
  while still being recognizable as a story.

### Versioning rules

```json
{ "format": "gramps-connect-story", "version": "1.0", ... }
```

- `format` is a fixed identifier, so a viewer can reject a JSON file that
  isn't a story at all.
- `version` is `MAJOR.MINOR`:
  - **MINOR** bumps only *add optional fields*. A 1.0 viewer must open a
    1.3 file and **ignore fields it doesn't know**. A 1.3 viewer opens 1.0
    files natively, since every new field is optional.
  - **MAJOR** bumps are for changes old viewers can't handle safely
    (renamed/removed/re-typed fields). A viewer refuses a major version
    newer than its own, with a clear "this story needs a newer viewer"
    message, never a half-broken render.
- **Backwards compatibility lives in the shared package as a chain of
  upgraders**: `upgrade_1_to_2(doc)`, `upgrade_2_to_3(doc)`, … run on load
  until the document is at the package's own major version. The renderer
  only ever sees the current shape. Old upgraders are never deleted, and
  each has a fixture story from the version it upgrades.
- **A JSON Schema per version** is published in the repo
  (`spec/1.0/story.schema.json`, served via GitHub Pages at a stable
  URL) and referenced by an optional `$schema` field, so producers in
  other languages can validate without running the viewer.
- **Extensions** go under `extensions`, keyed by namespace
  (`"gramps-connect": {...}`). Viewers ignore them. This is where
  gramps-connect can put provenance (handles, gramps_ids) without
  polluting the core. A field that proves generally useful graduates
  into the core in a MINOR bump.

### Shape

```jsonc
{
  "$schema": "https://<user>.github.io/gramps-connect-stories/spec/1.0/story.schema.json",
  "format": "gramps-connect-story",
  "version": "1.0",
  "title": "The Story of Josef Meyer",
  "language": "en",                     // BCP 47; viewer chrome may follow it
  "created": "2026-10-22T14:03:00Z",
  "generator": { "name": "Gramps Connect", "version": "0.9.2" },
  "authors": [{ "name": "Doug Blank" }],
  "license": "CC-BY-4.0",               // optional: the story's content license
  "presentation": {                     // optional hints; viewer may ignore
    "basemap": "auto"                   // "standard" | "historical" | "auto" | "none"
  },
  "slides": [
    {
      "id": "s0",                       // stable within the file (deep links: #s3)
      "title": "The Story of Josef Meyer",
      "text": "12 moments from Josef Meyer's recorded life.",
      "media": [{ "ref": "m1" }]
    },
    {
      "id": "s1",
      "title": "Birth of Josef Meyer",
      "text": "Josef Meyer was born *about* 1850 in **Zürich**.",
      "date": {
        "text": "about 1850",           // display string, always present if date is
        "edtf": "1850~",                // optional machine form (Library of Congress EDTF)
        "sortYear": 1850                // optional; places the slide on the timeline strip
      },
      "place": {
        "name": "Zürich, Switzerland",
        "lat": 47.3769, "lon": 8.5417,
        "geometry": { "type": "FeatureCollection", "features": [] },  // optional GeoJSON
        "overlays": [{                  // optional historical image overlays
          "media": "m4",
          "corners": [[8.50, 47.39], [8.58, 47.39], [8.58, 47.36], [8.50, 47.36]],
          "opacity": 0.7,
          "order": 0,
          "date": { "text": "1850–1890", "edtf": "1850/1890" }
        }]
      },
      "media": [{ "ref": "m2", "caption": "Baptismal record", "credit": "Stadtarchiv" }],
      "people": [{ "name": "Josef Meyer", "role": "Primary" }]   // optional
    }
  ],
  "media": {                            // de-duplicated; slides point here by key
    "m1": { "src": "media/m1.webp", "mime": "image/webp", "alt": "Portrait of Josef Meyer", "width": 1200, "height": 1600 },
    "m2": { "src": "media/m2.webp", "mime": "image/webp", "width": 1600, "height": 1067 },
    "m4": { "src": "media/m4.png",  "mime": "image/png",  "width": 2048, "height": 1536 }
  },
  "extensions": {
    "gramps-connect": { "slides": { "s1": { "event": "E0012" } } }
  }
}
```

Choices worth noting:

- **Text markup** is the exact subset the editor writes today
  (`StoryTextField.tsx`: `**bold**`, `*italic*`), specified in the
  format doc, *not* "Markdown" (that would promise the whole spec and
  invite HTML injection). New marks (links, say) are a MINOR addition; an
  old viewer shows them as literal text, which is acceptable degradation.
- **Dates** carry a display string (what Gramps would print, in the
  story's language) *plus* optional EDTF, an existing standard for
  approximate/ranged dates, instead of inventing a Gramps-date JSON.
  Dates that EDTF can't express (textual dates, non-Gregorian calendars)
  omit `edtf` and keep `text` and `sortYear`.
- **`lon`, not `long`**: matches GeoJSON conventions. The in-app
  `HydratedSlide` keeps its own names; only the converter maps.
- **Media is a list per slide**, though today's slides have at most one
  photo. Going from one to a list later would be a MAJOR change; starting
  with a list costs nothing.
- **Slide order is array order.** The viewer doesn't re-sort; `sortYear`
  only places a slide on the timeline strip.
- **No "fallback to the opening photo" rule in the format.** That's
  hydration behavior today (`introMediaRef`). The converter writes the
  fallback photo into each slide explicitly (it's stored once in `media`
  either way), so the player stays a dumb renderer and other producers
  aren't bound by our rule.
- **Overlay geometry is resolved into the JSON.** Today
  `StoryMapBackground` fetches a place's GeoJSON/KML overlay media by
  handle at slide time. In the format, `geometry` and `overlays` are
  already resolved, so the player never fetches or parses map files.

### Prior art checked against

- **Knight Lab StoryMapJS / TimelineJS JSON**: the in-app layout is
  modeled on StoryMapJS already. Their formats aren't versioned and are
  web-URL-centric, so not adopted, but an export-to-StoryMapJS converter
  is cheap (Later).
- **EPUB / DOCX** for "zip with a well-known root file".
- **GeoJSON** for geometry and **EDTF** for dates, used rather than
  reinvented.

## Image optimization

Done in the browser at download time, by the shared package's
`optimizeImage()`, so any browser-based producer gets the same result:

- Fetch each distinct image once, via the existing
  `/api/media/<handle>/thumbnail/<size>` endpoint at a larger size than
  the viewer needs (no full-resolution originals over the wire), through
  `apiFetch` per CLAUDE.md.
- Resize so the long edge is at most **1600px** for slide photos (the
  player shows them at up to ~42vh in the side panel and full-bleed in
  the no-map layout). Overlay images go up to **2048px**, since they're
  stretched across a map at zoom.
- Re-encode slide photos to **WebP** (quality ~0.82) via
  `OffscreenCanvas.convertToBlob`, with a JPEG fallback where WebP
  encoding isn't supported. Overlays stay **PNG** if they have
  transparency, else WebP.
- Re-encoding through a canvas **drops all EXIF metadata**, including
  GPS, which is what we want in a file that leaves the tree.
- Record `width`/`height` in `story.json`, so the player can lay out
  before the image decodes.
- Show progress in the dialog ("Optimizing photos 4 of 12"). A typical
  person story ends up a few MB.

## Download dialog

"Download" button beside "Present" in `StoryActions.tsx` opens a small
modal, styled like the report options in `ReportDialog.tsx`:

- **Include data marked private** (switch, default off). Off drops slides
  whose event is private and photos whose media is private, and drops
  private places from slides, keeping the rest of the slide. This switch
  only appears for users who can view private records; everyone else
  can't see them in the first place (the same rule `ExportDialog.tsx`
  follows for its "export will be incomplete" warning).
- **Include living people** (switch, default off). Off drops slides
  about someone who is still living, and their photos, using the same
  living rule as the server's exports. A family story keeps the slides
  about deceased members.
- **Include record IDs** (switch, default off). Writes the
  `extensions.gramps-connect` block, so a reader with tree access can
  find the records again.
- A live summary under the switches: "12 slides, 9 photos (3 slides left
  out)". If the switches would remove every slide, the download button
  is disabled and says why.
- **Download** builds the zip in the browser and saves it as
  `<story title>.story.zip`, with progress while photos are optimized.

The opening slide is never dropped. If its photo is removed, it falls
back to having no photo.

## The shared package

Yes, one package. Both gramps-connect and the viewer site use it.

**`@gramps-connect/story`**, living in the `gramps-connect-stories`
repo, with two entry points:

- **`@gramps-connect/story`** (no React, no DOM beyond canvas and Blob):
  - TypeScript types for the current format version
  - `readStoryZip(blob) → StoryDoc` (unzip, check `format`, run the
    upgrader chain, validate) and `writeStoryZip(doc, files) → Blob`
  - `validate(doc)` against the bundled JSON Schema, plus checks the
    schema can't express (every `ref` resolves, every `src` exists in
    the zip)
  - `optimizeImage(blob, opts)`
  - The upgrader chain
- **`@gramps-connect/story/player`** (React): `<StoryPlayer story={doc}
  resolveMedia={...} />`. Map background, timeline strip, map-mode
  control, slide layout, keyboard navigation. Generalized from today's
  `StoryView.tsx`, `story/StoryMapBackground.tsx`,
  `story/StoryTimelineStrip.tsx`, `story/storyTimelineLayout.ts`,
  `visuals/mapStyles.ts` and `visuals/MapModeControl.tsx`.

The **repo** also holds:

- `spec/`: the format document, the JSON Schema for each version, and a
  changelog.
- `examples/`: conformance stories (minimal, no map, map with overlays,
  undated, right-to-left language, every optional field, one fixture per
  past version for the upgraders).
- `site/`: the standalone viewer on GitHub Pages: drop or open a
  `.story.zip`, or `?src=<url-of-zip>`, plus `#s3` deep links,
  fullscreen, keyboard and swipe. Runs entirely in the browser: a dropped
  file never leaves the machine.
- `embed/`: a built `<gramps-connect-story src="...">` web component
  bundle for pages that don't use React, published inside the npm
  package and so served by jsDelivr/unpkg automatically (see
  [Publishing to npm](#publishing-to-npm)).

### How gramps-connect consumes it

**A git submodule at `gramps-connect/packages/story`**, pointing at
`gramps-connect-stories`. `packages/*` are already npm workspaces (that's
how `@gramps-connect/gramps-date` works today), so the app imports
`@gramps-connect/story` with no publishing step, and Vite compiles it
from source just like gramps-date.

- Day to day: edit inside `packages/story`, commit and push there, then
  bump the submodule pointer in gramps-connect, like any other pinned
  dependency.
- The GitHub workflows (`build-standalone.yml`, `build-docker.yml`, CI)
  need `submodules: true` on checkout, and `Dockerfile` builds need the
  submodule present in the build context.
- The package is *also* published to npm for everyone else (next
  section). gramps-connect keeps using the submodule rather than the npm
  release, so a change can be made and tried in the app without a release
  in between.

Rejected alternative: keeping the package in gramps-connect's
`packages/` and having the stories repo depend on it. That splits the
spec from the code that implements it.

### Publishing to npm

**`@gramps-connect/story` on the public npm registry**, so other
programs and websites can `npm install` the reader, writer and player,
or load the web component from a CDN with no build step:

```html
<script type="module"
  src="https://cdn.jsdelivr.net/npm/@gramps-connect/story@1.2.0/dist/embed.js"></script>
<gramps-connect-story src="josef-meyer.story.zip"></gramps-connect-story>
```

- **Claim the scope first.** The `@gramps-connect` npm organization
  doesn't exist yet (checked 2026-10-22). Create it (free for public
  packages) under the user's npm account before anyone else does, then
  move `@gramps-connect/gramps-date` there too if it's ever published.
- **What's published is built, not source.** gramps-connect compiles the
  TypeScript source through the submodule, but npm consumers get `dist/`:
  ES modules + `.d.ts` types for both entry points, the player's CSS
  file, the JSON Schemas, and the self-contained `embed.js` bundle (which
  inlines React and maplibre, so a plain HTML page needs nothing else).
  `package.json` `exports` maps `.`, `./player`, `./player.css`,
  `./schema/*` and `./embed` to those, with a `source` condition
  pointing at `src/` so the gramps-connect workspace keeps compiling from
  source.
- **Dependencies.** `react`/`react-dom` and `maplibre-gl` are
  **peer dependencies** of `./player`, so an app that already has them
  doesn't get a second copy. The core entry has no React or maplibre
  imports at all, so a script that only writes zips doesn't install them.
  The zip library (e.g. `fflate`) is an ordinary dependency.
- **`"license": "AGPL-3.0-or-later"`**, with the LICENSE file in the
  tarball and `repository`/`homepage` pointing at the GitHub repo and the
  viewer site.
- **Two version numbers, kept apart.** The npm package follows semver for
  its *API*. The *format* version (`"version": "1.0"` in `story.json`)
  is separate. The README keeps a table of which package versions read
  and write which format versions, and the package exports
  `FORMAT_VERSION` and `SUPPORTED_FORMAT_MAJORS`. Rule: a new format
  MINOR version is a package minor release; a new format MAJOR version is
  a package minor release too, as long as old files still open (that's
  what the upgraders are for). Only breaking the package's own API is a
  package major release.
- **Releases from CI, not a laptop.** A GitHub Actions workflow in
  `gramps-connect-stories` runs tests, builds, and publishes when a
  `v*` tag is pushed, using npm trusted publishing (OIDC) so there's no
  long-lived npm token in repo secrets, and `--provenance` so the npm
  page links the tarball to the exact commit and workflow that built it.
  The same workflow deploys the viewer site to GitHub Pages, so the site
  always runs the latest release.
- **Check before each release:** `npm pack --dry-run` lists exactly the
  intended files (no `examples/`, test fixtures or `site/`), and a
  smoke test installs the packed tarball into an empty project and
  imports both entry points.
- **Starts at 0.x.** Publish `0.x` releases while gramps-connect is the
  only user and the API is still moving; `1.0.0` once the player API has
  survived Phase 4 and a second producer (Phase 5).

### Decoupling needed when the player moves

- **Auth.** `SlidePhoto` and the overlay code call `getToken()` +
  `fetchAuthedBlobUrl()` directly. Replace with a `resolveMedia(src) →
  Promise<string>` prop: the standalone site resolves zip entries to
  blob URLs, and gramps-connect resolves its in-memory document's
  `media/<handle>` entries to authed blob URLs (still through `apiFetch`
  / `apiImage.ts`, per CLAUDE.md). In-app presenting doesn't optimize or
  zip anything; that's only for Download.
- **Map files.** The player takes resolved geometry and overlays from
  the document; gramps-connect's hydration resolves them up front
  (moving the fetch now in `StoryMapBackground` into `storyHydration.ts`).
- **Mantine.** The player is plain React and CSS with custom properties
  for theming (light/dark via a prop, defaulting to
  `prefers-color-scheme`), so the standalone site and embeds don't pull
  in a UI kit. gramps-connect keeps wrapping it in its Mantine `Modal`.
- **Gramps date types.** The overlay date gate uses
  `nameDate: GrampsDate` today. In the format it's the overlay's own
  `date` (EDTF), compared to the historical basemap year, so
  `@gramps-connect/gramps-date` isn't a dependency of the package.
- **i18n.** The player's few chrome strings get a small translation
  table inside the package, picked by the story's `language`, falling
  back to the browser locale; gramps-connect can pass its own `t()`
  instead.
- **Tile sources.** Defaults stay OpenFreeMap + OpenHistoricalMap,
  configurable by prop; `basemap: "none"` gives the plain-card layout.

## Phases

### Phase 1: Repo, format v1.0, shared package core

Done 2026-10-22. Notes from building it:

- `validate()` uses a validator compiled ahead of time from the schema
  (`npm run generate`, checked by the tests), because Ajv's runtime
  compiler needs `new Function`, which a strict Content-Security-Policy
  blocks on sites embedding the viewer. Non-empty strings are
  `pattern: "\\S"` rather than `minLength: 1`, since `minLength` makes
  the generated module `require()` an Ajv helper, which an ES module
  can't.
- Unknown fields produce *warnings* (likely typos) only in files whose
  minor version the package fully knows; in a newer minor version they're
  ignored silently, as the spec requires.
- `optimizeImage()` is tested in real headless Chrome
  (`npm run test:browser`, in the stories repo's CI only): EXIF rotation
  applied, 1600px WebP, camera and GPS metadata gone, and overlay
  transparency kept as PNG.
- Readers also accept a story inside one top-level folder (what "compress
  this folder" makes), ignoring `__MACOSX/`, and cap total uncompressed
  size and file count before inflating anything.

- Create `gramps-connect-stories` (AGPL-3.0-or-later): `spec/1.0`
  (document + JSON Schema), `examples/`, and the non-React package entry
  (`readStoryZip`, `writeStoryZip`, `validate`, `optimizeImage`, types),
  with tests run against the examples.
- Add it to gramps-connect as the `packages/story` submodule; update the
  workflows and Dockerfiles for submodule checkout.

### Phase 2: Download in gramps-connect

Done 2026-10-22. Notes from building it:

- `store/storyExport.ts` works in three steps: `gatherStoryExport`
  (async, once per dialog open: hydration plus the privacy facts no local
  cache holds), `planStoryExport` (pure, re-run on every switch change, so
  the summary is live), and `buildStoryZip` (fetch, optimize, zip). Each
  step has its own tests.
- The overlay shapes and images are resolved in the gather step
  (`kmlMedia.ts`, per map file so a private file can be left out by
  itself), not moved into `storyHydration.ts`. Moving them into hydration
  is now part of Phase 3, when the player needs them.
- "Who a slide is about" = the event's subject-role participants
  (`isSubjectRole`: Primary, Family) plus both spouses of a family
  event; witnesses and clergy don't count. A photo is left out when it
  shows (is linked from) anyone living. The opening card is about the
  story's own subjects (the Note's backlinks); if they're hidden, the
  download is blocked rather than the card dropped.
- Living status comes from `/api/living/<handle>` (Gramps'
  `probably_alive`, as the server's exports use); a failed lookup counts
  as living. Any other failed privacy lookup fails the whole gather
  rather than guessing.
- Photos come from the thumbnail endpoint at 2048px (AVIF from the
  server, which `optimizeImage` decodes fine; checked in Chrome), overlays
  from `/file` to keep transparency.
- Slide ids are renumbered after filtering, so a gap can't reveal that
  something was left out. Dates get EDTF only when Gregorian with a real
  year (`store/edtf.ts`).

- `app/src/store/storyExport.ts`: `HydratedStory → StoryDoc` (including
  the explicit per-slide photo fallback), the privacy filtering, and
  image fetch and optimize through the package.
- Hydration resolves overlay geometry and corners up front.
- `StoryDownloadDialog.tsx` + a "Download" button in `StoryActions.tsx`.
- App tests validate exports from the dev fixture against the schema.
- Wiki: `### Downloading a story` in `Stories-and-Photos.md`.

### Phase 3: Shared player, dogfooded in the app

Done 2026-10-22. Notes from building it:

- `@gramps-connect/story/player` exports `StoryPlayer` plus its pure
  parts (text markup, EDTF year ranges and timeline positions, geometry
  bounds, timeline layout, basemap styles), each tested in Node; the
  component itself is tested in headless Chrome against every example
  story, read through `writeStoryZip` → `readStoryZip` → blob URLs
  (`scripts/test-player.mjs`).
- In the app: hydration now resolves each slide's map files (shapes and
  overlays) and its EDTF date; `store/storyDoc.ts` converts a hydrated
  story to a story document, used both by Present (`presentationDoc`,
  unfiltered, media srcs `photo/<handle>`/`overlay/<handle>` that
  `StoryView.tsx` resolves to authed blob URLs) and by Download
  (`slideToDoc`, after filtering). `StoryView.tsx` is now just the host.
- The app's map view imports the basemap code (styles, crossfade, OHM
  year filter) back from the package, so there's one copy.
- **A host must call `maplibregl.setWorkerUrl()`** where its bundler
  serves maplibre's worker (`maplibre-gl-worker.mjs` + `-shared.mjs`,
  side by side) or the map draws nothing; found when the old
  `StoryMapBackground` (which did this at import) was deleted. The
  Phase 4 site has to serve those two files too.
- Behavior changes: line breaks and blank-line paragraphs in slide text
  now show (the spec always said so; the old renderer collapsed them).
  A story is hydrated when Present opens rather than whenever its panel
  is shown, so there's a brief spinner. Overlay era gating uses EDTF, so
  a place-name date in a non-Gregorian calendar no longer hides an
  overlay (no EDTF, so always shown).
- Deferred: the player's translation table (it has English defaults and
  a `strings` prop the app fills with `t()`; Phase 4's site needs the
  table), and showing more than one photo per slide (it shows the first).

- Move and generalize the presentation components into
  `@gramps-connect/story/player`; `StoryView.tsx` becomes
  hydrate → convert → `<StoryPlayer>`.
- Visual parity check against today's Present on the dev fixture (map,
  no map, overlays, OHM modes, timeline), checking the rendered output,
  not just the converted JSON.

### Phase 4: Standalone site, embed, npm

Built 2026-10-22. Notes:

- **Site** (`site/`, deployed by `pages.yml` on every push to main, not
  per release as first planned: the viewer should always have the latest
  fixes, while embeds pin a version). Pick/drop a file, `?src=`, `#s3`
  slide links (none for the opening slide), F for full screen, examples
  zipped at build time, and the schema served at its `$id` URL.
- **Embed** (`src/embed/` → `dist/embed.js`, everything bundled, no
  source map): a shadow root with maplibre's CSS inside it;
  `keyboard: "focus"` so several stories can share a page; maplibre's
  worker loads from beside the script, and from another origin (a CDN)
  through a `blob:` URL that imports it, since a page can't start a
  worker from another origin's URL directly. A page whose CSP sets
  `worker-src` has to allow `blob:`.
- **npm**: `dist/` built by esbuild with dependencies left as imports
  (including maplibre's stylesheet); declarations by tsc. Exports put a
  `source` condition (→ `src/`) before `types`, and Gramps Connect's Vite
  and tsconfig enable it, so the app never needs `dist/`. 577 KiB packed.
  `test:pack` installs the tarball into an empty project and bundles and
  typechecks every entry point there. TypeScript 6+ consumers of
  maplibre need `"types": ["geojson"]` (maplibre's declarations, not
  ours).
- **Player additions**: en/de/es/fr/nl strings by story then browser
  language, `onSlideChange`, swipe on the slide panel.
- **Still to do by hand**: claim the `@gramps-connect` org on npmjs.com,
  publish 0.1.0 once (manually, or via an `NPM_TOKEN` secret and a
  `v0.1.0` tag), then set up trusted publishing for `release.yml`. Until
  then the embed snippet's jsDelivr URL doesn't resolve.
- Found on the way: Phase 3's move had dropped maplibre's stylesheet from
  Present (pin unpositioned unless the Map view had been opened first);
  fixed in the player, and the browser test now checks it.

- GitHub Pages viewer and `<gramps-connect-story>` web component.
- Claim the `@gramps-connect` npm scope, add the build (`dist/`,
  `exports`, peer dependencies) and the tag-triggered publish workflow,
  and publish the first `0.x` release.
- Wiki: how to share a downloaded story (send the zip, open it on the
  viewer site, embed it on a blog), with a link to the viewer site.

### Phase 5: Second producers (proves the format is independent)

Built 2026-10-22, kept simple. Notes:

- **Python writer**: `python/gramps_connect_story.py` in
  gramps-connect-stories, one file, standard library only, Pillow
  optional (1600px WebP, metadata stripped). **GPL-2.0-or-later**, not
  AGPL like the rest of that repo, so the GPL addon can ship it.
  `test:python` has it write stories that the TypeScript reader must
  accept with no warnings.
- **Addon** `StoryExport` (addons-source, `maintenance/gramps60`):
  Tools > Utilities > Export Story, for the active person. Their own
  events (Primary role) and their families' events, by date, undated last;
  opening slide with their portrait, which is also each slide's fallback
  photo. Save dialog with "Include data marked private" and "Include
  living people" (both off), applied with Gramps' own PrivateProxyDb /
  LivingProxyDb plus a living-in-photo check. Note Gramps' LivingProxyDb
  clears all events of a family with a living parent, so a marriage to a
  living spouse is dropped -- the same outcome as Gramps Connect's
  download. `storyexport_builder.py` has no GUI imports; tested on a temp
  database.
- **End to end**: on Gramps' example tree, loaded through Gramps' own
  plugin manager, every person exported both ways (3,073 stories, 9,951
  slides) and every file validated by the TypeScript reader with no
  warnings.
- Not done (kept simple): no map shapes/overlays or record IDs from the
  addon, no CLI mode, and the Gramplet `story()` helper.

- A **Python reference writer** (`gramps_connect_story.py`, standard
  library only, using Pillow when available for image optimization) in
  the stories repo, so Gramps desktop, Gramps Web and scripts don't
  reimplement packaging.
- A **Gramps desktop addon** that writes a `.story.zip` for the active
  person. This is the real test that the format isn't secretly shaped
  around gramps-connect.
- Possibly a **Gramplet helper** so gramplet authors can build stories
  from queries (same Python-owns-logic / TS-renders split as
  `relationship_chart()`).

### Later

- **Open a `.story.zip` in gramps-connect** to present it (present
  only; importing into a tree is out of scope).
- **Export to StoryMapJS JSON.**
- **Publish to a URL** from gramps-connect (needs hosting; ties into the
  stashed public-trees work).
- Audio narration per slide (`media` with `audio/*` mime: a MINOR bump).

## Open questions

1. **Living people, finer control.** One switch for now. The server's
   exporters also offer "replace names with Living" and a years-after-
   death setting (`ExportDialog.tsx`); worth adding only if someone
   asks.
