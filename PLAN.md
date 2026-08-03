# Gramps Connect — layered prototype plan

## Context

The current gramps-web frontend feels dated and its list/filter performance is bad — documented in [this discourse analysis](https://gramps.discourse.group/t/gramps-web-api-list-performance/9007) (104s for a filtered query on 100k people vs 0.63s achievable). Rather than patch the existing frontend, the decision made in the planning conversation that produced this document is a **clean-break rewrite in a new repo** (this one — `gramps-connect`), built on an **extended gramps-web-api**, with two product bets that came out of discussion:

1. **Local-first client** — cache the tree locally (WASM SQLite), make browsing instant instead of fetch-per-page
2. **Real-time collaboration** — see what other family historians are editing live, via Postgres change capture

This is a multi-month effort. The explicit approach is to **de-risk via small, disposable prototypes early**, in layered order, so the biggest unknowns get tested before committing to a frontend framework or a full API rewrite.

### Grounding — verified directly in local checkouts of gramps / gramps-web-api / addons-source, not from memory

- **Gramps 6.0 storage changed**: pickle blobs are gone. `blob_data BLOB` → `json_data TEXT` (`~/gramps/gramps/gramps/plugins/db/dbapi/dbapi.py:142-147`, gated by `use_json_data()`/`upgrade_table_for_json_data()` in `~/gramps/gramps/gramps/gen/db/generic.py:672-741`). This means object data is now directly JS-parseable — the pickle blocker to a local-first client no longer exists.
- **Secondary (indexed, flat) SQL columns already exist**, derived from each class's `get_schema()` (`~/gramps/gramps/gramps/gen/lib/tableobj.py:151-166`), populated on every commit via `_update_secondary_values()`. Confirmed `Person.gender` is one of them — meaning `IsFemale`-style filters *can* already be pure SQL at the storage layer.
- **The discourse-thread bug is still live, and it's an API-layer bug, not a storage-layer one.** `GrampsObjectsResource.get()` in `~/gramps/gramps-web-api/gramps_webapi/api/resources/base.py:589-615` unconditionally does `objects = list(iter_objects_method())` (deserializes the *entire* table) before any filter (`filter`/`rules`/`gql`/`oql`) is applied at line 610+. The storage layer got faster in 6.0; the API query path never adopted it. This is fixable without touching storage.
- **gramps-web-api's actual Postgres backend is `SharedPostgreSQL`** (`~/gramps/addons-source/SharedPostgreSQL/shareddbapi.py`, `sharedpostgresql.py`), confirmed via references in `dbmanager.py`/`dbloader.py`. It adds `treeid`-based multi-tree partitioning to every table but has **no `LISTEN`/`NOTIFY` support**. (That feature only exists in the unrelated, separately-authored, experimental `PostgreSQLEnhanced` addon — not what's actually deployed.)
- **No real-time infrastructure exists anywhere in gramps-web-api today** — no websockets, SSE, or Postgres NOTIFY usage found.

### Decisions made in the planning session

- **Repo**: one new monorepo for the new work (this repo, `gramps-connect`), separate from `gramps-web-api` (extended in place, backward compatible) and `gramps` core (unmodified, consumed as-is).
- **Prototype stack**: framework-agnostic (plain TS/HTML) for the earliest risk-retiring spikes — no React/Svelte/Vue commitment until the hard technical risk is retired.
- **Plan depth**: detail the first several prototype layers; later layers (auth, full UI, design system, conflict UX) get a roadmap-level mention to revisit once the spikes teach us more.

## Layered prototype plan

Ordered so the biggest, cheapest-to-test unknowns get retired first. Layers 0–2 can start in parallel; Layer 3 depends on 0–2; Layer 4 is fully independent (different repo — `gramps-web-api` — no dependency on this monorepo).

### Layer 0 — Postgres change-capture spike (~1 day)

**Goal**: prove trigger → `pg_notify` mechanics before anything else depends on them.

- Local Postgres with a minimal slice of the existing `SharedPostgreSQL` schema (just `trees` + `person`, copied from `_create_schema()` in `shareddbapi.py`).
- Add `AFTER INSERT/UPDATE/DELETE` triggers per table calling `pg_notify('tree_changes', payload)`. Payload: `{treeid, table, handle, op}` as JSON — deliberately thin, since Postgres caps a NOTIFY payload at **8000 bytes**.
- Throwaway Python script does `LISTEN tree_changes` (on its own dedicated, non-pooled connection — required for LISTEN) and prints events while you edit rows via `psql`.
- **Success criteria**: every write produces exactly one correctly-shaped notification, sub-second latency.

### Layer 1 — WebSocket relay spike (~1-2 days)

**Goal**: prove an event can reach a browser.

- Minimal Python service (lightest option available — plain `websockets` lib or FastAPI's websocket support, no auth yet) holding the Layer 0 `LISTEN` connection, re-broadcasting each notification to all connected WebSocket clients.
- Static HTML page opens a WebSocket, logs incoming events to the DOM.
- **Success criteria**: editing a row in `psql` appears in the browser within ~1s, and works correctly with 2+ tabs open (proves fan-out).

### Layer 2 — Local-first cache spike (~2-3 days, parallel with 0/1)

**Goal**: prove a client-side cache of Gramps JSON objects is fast and workable.

- Plain TS + a WASM SQLite (evaluate `wa-sqlite` vs `sql.js`, both with OPFS persistence — pick one after a quick spike of each).
- Fetch a real dataset from gramps-web-api's existing `/api/people/` endpoint; mirror the JSON into local SQLite tables using the *same* secondary-column fields Gramps already flattens (`given_name`, `surname`, `gender`, per `tableobj.py`'s `get_secondary_fields()`), so the local schema deliberately mirrors the server schema rather than inventing a new one.
- Query locally (filter/sort on a couple of fields) and measure — the client-side analog of the discourse thread's benchmark.
- **Success criteria**: sub-50ms local queries against a few thousand cached records; a clean, repeatable mapping from `to_struct()`-shaped JSON to local relational rows.

### Layer 3 — Sync round-trip (~2-3 days, depends on 0-2) — ✅ done

**Goal**: prove the actual core bet of the whole system, end-to-end.

- Wire Layer 1's WebSocket events into Layer 2's local cache: on notification, patch (or refetch-and-patch, since the NOTIFY payload is intentionally thin) the corresponding local row and re-render a bare list.
- Two browser tabs side by side; edit a person in one (raw SQL or a minimal API call), watch the other tab's local cache update live without a page refresh.
- **Success criteria**: this is the demo that proves "see what your fellow family historians are working on" is achievable — however ugly the UI. Also surfaces whether thin NOTIFY payloads are sufficient or a refetch step is required in practice.

**Result** (originally `layer3-sync/`, now `dev-fixtures/layer3-sync/` — see below): a real Postgres (SharedPostgreSQL) instance with Layer 0's trigger installed on its `person` table, Layer 1's relay pointed at it, and Layer 2's client patched with a live-sync handler — refetch-and-patch confirmed necessary and sufficient (thin `{treeid, table, handle, op}` payload, `where_expr: handle == "..."` refetch). Verified end-to-end: a raw Postgres `UPDATE`/`DELETE` shows up in the browser's local cache and re-renders without a page refresh, scoped to the Person view for this first pass.

**Since superseded**: the Layer 0-2 spike directories (`layer0-notify-spike/`, `layer1-ws-relay/`, `layer2-local-cache/client/`) were removed once `app/` (see the Frontend framework decision below) fully replaced their functionality — the mechanics they proved live on in `app/`'s real code, not as standalone spikes anymore. `layer2-local-cache`'s and `layer3-sync`'s *fixtures* (the backend instances to develop against, not the spike client code) survive, relocated to `dev-fixtures/layer2-local-cache/` and `dev-fixtures/layer3-sync/` — see the top-level README's Repo layout for current paths.

### Layer 4 — gramps-web-api filter pushdown fix (~2-4 days, fully independent)

**Goal**: validate the discourse-thread performance bug is fixable without a storage rewrite — directly in the existing `gramps-web-api` repo, backward compatible.

- Change `GrampsObjectsResource.get()` (`base.py:589-615`) so that when `filter`/`rules` args are present, the query goes to SQL against the secondary columns (e.g. `gender`) instead of `iter_objects_method()` + Python-side `apply_filter`.
- Reuse the existing benchmark methodology (`gramps-bench` + `gramps-api-client`, both already checked out under `~/gramps/`) for an apples-to-apples before/after number against the 100k-person dataset.
- **Success criteria**: `IsFemale`-style filtered queries drop from the ~104s baseline by at least an order of magnitude.

## Roadmap after the prototypes (not detailed yet — revisit once Layers 0-4 report back)

- ~~Frontend framework decision~~ — ✅ **React**, chosen over gramps-web's Lit/Material Web Components approach (see `app/`'s own notes): the app's real complexity is client-side state (multiple SQLite caches, scroll position, filter expressions, live-sync patches), which calls for an app framework with real state primitives, and React has the largest contributor/tooling pool for a volunteer open-source project. `app/` ports the Layer 2/3 spike's functionality onto it in full (all ten views, filtering, OPFS-persisted cache, live sync); the layer directories remain as the historical record of the spikes that de-risked this.
- Presence layer (who's viewing/editing what) — deliberately ephemeral, in-memory/Redis, kept separate from the durable NOTIFY change-capture path
- Auth/permissions integration with gramps-web-api's existing JWT model — `app/` has a minimal login form (real credentials, no hardcoding) but no refresh-token rotation or expiry handling yet; gramps-web's own `Auth` class (`~/gramps/gramps-web/src/api.js`) is the reference to build against for that
- Merge/conflict UX for genuinely concurrent edits to the same object — open design question, not yet resolved
- Full object-model UI redesign, design system, search-as-navigation
- Multi-server scaling of the relay (Postgres NOTIFY doubles as the cross-instance fanout bus, noted during design discussion)

## Verification

Each layer's success criteria above *is* its test — the point of this plan is empirically retiring risk before writing product code. Layer 4 additionally has a concrete, reusable before/after benchmark via existing `gramps-bench`/`gramps-api-client` tooling.
