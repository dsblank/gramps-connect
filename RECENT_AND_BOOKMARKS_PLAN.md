# View > Changed / Visited / Bookmarks — plan

Three new routed pages, added to the View menu right below **Search all**,
in the same separated group:

```
Map
Timeline
Graphs
─────────────
Search all
Changed
Visited
Bookmarks
```

## What gramps-web-api already gives us

| View      | Server support | Source |
|-----------|----------------|--------|
| Changed   | Yes | `GET /api/search/?query=*&sort=-change&type=…&page=…` — already used by Home's "Recently changed objects" panel (`homeStats.ts` `fetchRecentlyChanged`). Also takes `change=>ISO` / `<ISO` filters. |
| Bookmarks | Yes | `GET /api/bookmarks/` (all 9 namespaces at once), `PUT`/`DELETE /api/bookmarks/<namespace>/<handle>` (needs `EditObject`). These are Gramps' own DB bookmarks (`DbGeneric` metadata), so they're **tree-wide, shared by every user, and the same list Gramps desktop shows**. No Tag namespace. |
| Visited   | **None** | gramps-web-api has no per-user history or prefs storage. Must be client-side. |

No backend changes needed for any of the three.

## Routing / shell

- `hash.ts`: add `"changed"`, `"visited"`, `"bookmarks"` to `VISUAL_KEYS`
  (same no-store, no-subject treatment as `"search"`); update the doc comment.
- `App.tsx`: render each the same way `SearchView` is (`visualHeight` Box,
  mounted only while active).
- `MenuBar.tsx`: three items after "Search all".

## Shared result list (refactor first)

`SearchView`'s `TypeTabs`, `SearchResultRow` and `RecordThumbnail` move to a
shared `components/visuals/ObjectResultList.tsx`. All four pages render the
same Google-style cards (icon + type badge, title, snippet, thumbnail,
"Last changed …"), so they look like one family. Each new page adds one
extra line per card where it matters ("Visited 5 min ago", a bookmark star).

The card needs a raw object (+ `profile` for the snippet). Search hits
already are that. For Visited/Bookmarks, which start from a list of handles,
fetch per type with one GOQL query each (`handle in [...]`, the indexed
handle column — same pattern as `placeReconnect.ts`), selecting what
`summaryLine`/`snippetFor` read; at most ~10 small requests per page load,
all through `apiFetch()`. A handle that no longer exists (deleted record) is
dropped from the display.

## 1. Changed (`ChangedView.tsx`)

- Data: `/api/search/?query=*&sort=-change&profile=all`, with the same
  type tabs as Search all (`type=` param) and a **Load more** button
  (next `page`) instead of SearchView's fixed top 10.
- Group headings by age: Today / Yesterday / This week / This month / Older
  (client-side from `change`; no extra requests).
- Excludes topic / story / topic-message notes, same as Home
  (`RECENT_EXCLUDED_NOTE_TYPES` — export and reuse it). Client-side, so a
  page may show fewer than `pagesize`; that's fine with Load more.
- Depends on the search index: reuse SearchView's `checkIndex()` /
  `IndexNotice` (move into the shared module) so an unbuilt index says so
  instead of showing an empty list.
- Home's "Recently changed objects" panel gets a "See all" link to `#/changed`.

## 2. Visited (`VisitedView.tsx`, `store/visitedHistory.ts`)

- Recorded client-side in `localStorage`, keyed by tree id **and** username
  (shared browsers; same `getTreeId() ?? "unknown"` convention as
  `homePersonPreference.ts`). Entries `{type, handle, at}`, most-recent-first,
  de-duplicated (revisiting moves an entry to the top), capped at 200.
- Recorded in one place: `useHistorySync.ts`, whenever the route settles on
  a `#/<view>/<handle>` (row click, Back/Forward, pasted link, drill-down).
  Only records opened in a table (the ten primary types), never
  Map/Timeline/Graphs subjects or Story/Topics/Output. (Decided.)
- Page: type tabs, cards grouped by visit time like Changed, a
  "Clear history" button. Per-browser by nature — the wiki page says so.

## 3. Bookmarks (`BookmarksView.tsx`, `store/bookmarksApi.ts`)

- Data: `GET /api/bookmarks/` → map namespaces (`people`→`person`, …) to
  view keys; keep Gramps' stored order within a type. Type tabs, no paging
  (bookmark lists are small).
- Adding/removing: a star toggle in the detail pane header (`RelatedPanel.tsx`,
  next to `EditButton`) for the nine bookmarkable types, plus "Remove" on each
  card in the Bookmarks page. Hidden for users without `EditObject` (they
  can still view the list). Optimistic update, rolled back on error.
- Since bookmarks are shared with every user of the tree and with Gramps
  desktop, the page header says so in one short line ("Shared by everyone
  working on this tree").
- No live-sync event for bookmark changes: the list refetches on each open,
  and the star state comes from a small module-level cache refreshed then.

## 4. Back / Forward buttons (`components/HistoryNav.tsx`, `store/navHistory.ts`)

The desktop app's window (pywebview on Windows/macOS) has no browser
toolbar, so there's no visible way to step back through records. Since every
row selection and view switch is already a real history entry
(`useHistorySync.ts` sets `location.hash`), the buttons just call
`history.back()` / `history.forward()`; no second history stack of our own.

- Scope: app-wide, one history across every page (decided 2026-11-01), the
  same list the browser's own Back/Forward walks. Back from People can land
  on the Map or a Place you looked at earlier, as in a browser.
- Placement: once, in the app header (`App.tsx`'s `AppShell.Header`), so
  they're on every page: Home, every list view, every full-page view, the
  three new pages. A pair of small chevron `ActionIcon`s between the
  wordmark and the menu bar in the wide layout; in the two-row (narrow)
  layout, next to the wordmark on the top row, since the menu row scrolls
  sideways. Tooltips "Back" / "Forward". Nothing added to `ListHeader` or
  `VisualFrame`.
- Enabled state: the History API can't say whether Back/Forward is possible,
  and the Navigation API (`navigation.canGoBack`) isn't available in
  WKWebView, so we track it ourselves. On every `hashchange`, if
  `history.state` carries no index it's a new entry: stamp
  `{ navIdx: last + 1 }` with `replaceState` and set `max = navIdx` (a new
  entry drops the forward branch). If it already carries one, it was a
  Back/Forward: `current = navIdx`. Back is enabled while `current > 0`
  (stops at the app's first entry instead of leaving the app), Forward while
  `current < max`. `max` lives in `sessionStorage` so a reload keeps it.
  `replaceState` keeps the same URL, so it doesn't fire another
  `hashchange` or disturb `useHistorySync`'s equality checks.
- Keyboard: Alt+Left / Alt+Right (Cmd+[ / Cmd+] on macOS) bound to the same
  calls. Browsers already do this, but the webviews don't always.
- Shown on narrow screens too: an installed PWA has no toolbar either.

## Wiki / docs

Per CLAUDE.md, a `###` section for each of the three in
`../gramps-connect.wiki/Search-and-Filters.md` (next to Search all), and a
bookmark-star mention in `Data-Model-and-Editing.md`, and a Back/Forward
section on whichever page describes the app header and menus; committed and pushed
with the code.

## Tests

- `hash.ts` parse/format for the three keys.
- `visitedHistory.ts`: dedupe, cap, per-tree/user keying, clear, tolerant
  of corrupt storage.
- `bookmarksApi.ts`: namespace ↔ view-key mapping, toggle requests.
- Changed: date-bucket grouping, note-type exclusion.
- `navHistory.ts`: new entry vs Back/Forward, forward branch dropped on a
  new entry, Back disabled at the first entry, `max` survives reload.

## Order of work

1. Extract `ObjectResultList` from SearchView (no visible change).
2. Routing + menu + Changed.
3. Visited (history recording + page).
4. Bookmarks (API module, star toggle, page).
5. Back/Forward buttons (independent of 1–4; could ship first).
6. Wiki, tests, version notes.

## Decisions (2026-11-01)

1. **Bookmarks:** Gramps' shared tree bookmarks (`/api/bookmarks/`), not
   per-user local ones.
2. **Changed:** the search index (`/api/search/?query=*&sort=-change`), with
   SearchView's index-missing notice when it isn't built.
3. **Visited:** only records opened from a table.
4. **Back/Forward buttons** added to the scope (section 4): app-wide
   history, in the app header on every page.
5. **"Changed" is labeled "Change Log"** in the menu and page title
   (route stays `#/changed`, component `ChangedView.tsx`). Each row also
   shows When / Who / What columns from the record's newest history entry.

## Status

- Back/Forward: shipped (25af817).
- Shared result list + Change Log: shipped.
- Visited: built (records only after a 1 s dwell; records fetched with
  `GET /api/<type>/?handles=…&profile=all`, chunked at 50).
- Bookmarks: built. Star beside the title in PanelHeader (and the note
  header); page groups by type in stored order; records that no longer
  exist are hidden, never deleted from the shared list.
