# Gramplet Store catalog source

Source content for gramps-connect's Gramplet Store (see the plan discussed
in project memory `project_gramplet_store_plan.md`). This directory is
published as-is (static files, e.g. via GitHub Pages) and fetched by the
running app at runtime -- it ships independently of gramps-connect's own
releases, not bundled into the app build.

## Adding or editing a Gramplet

One folder per Gramplet, named by its `id` (the folder name and the
manifest's own `id` field must match):

```
gramplet-store/
  <slug>/
    manifest.json   # required
    code.py         # required -- the Gramplet's Python source
    icon.png        # optional (png/jpg/jpeg/svg/webp)
```

`manifest.json` fields:

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Must match the folder name. |
| `name` | yes | Shown as the entry's title in the Store. |
| `description` | yes | Shown under the name in the Store. |
| `version` | yes | Plain semver, e.g. `"1.0.0"` -- bump it whenever `code.py` or the manifest changes, so installed copies can detect an update is available. |
| `author` | yes | Shown in the Store. |
| `category` | yes | A short tag (`"example"`, `"detail"`, `"utility"`, `"chart"`, ...) used to group/filter entries. |
| `views` | no | Which object-type views (`"person"`, `"family"`, ...) this Gramplet can be added to -- see `app/src/pyodidePoc/objectEndpoints.ts`'s `OBJECT_TYPES`. Omit for "every type". |
| `listensToSelection` | no | Whether this Gramplet should re-run when the selected record changes. |
| `listensToFilter` | no | Whether this Gramplet should re-run when the active filter changes. |
| `kind` | no | `"view"` (default) for a View Gramplet, shown in the panel below a list; `"window"` for a Gramplet run from the Gramplets menu in its own window. `views`/`listensTo*` only apply to `"view"`. |

A Gramplet (`"kind": "window"`) runs as soon as its window opens; to ask
for input first, draw it with the `st.*` widgets and do the real work
behind an `st.button`. A long-running one can show a bar with
`st.progress(value, text=None)` (Streamlit's own API). `category` also groups Gramplets into submenus in the Gramplets menu.

`code.py` is plain Gramplet Python -- see the (i) "Writing a Gramplet" help
button in the app's own Gramplet editor for the full runtime API
(`people()`/`filter()`/`get_selected()`/`db`/`row()`/`html()`/...).

## Rebuilding the catalog

After adding or editing an entry, regenerate `catalog.json` (the single
file the app actually fetches):

```
npm --prefix app run build:gramplet-catalog
```

This validates every entry (required fields present, `id` matches its
folder, `version` looks like semver, `code.py` non-empty) and fails loudly
on the first problem rather than publishing a broken catalog.
