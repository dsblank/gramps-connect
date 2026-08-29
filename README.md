# Gramps Connect

A faster, real-time-collaborative web frontend for
[Gramps](https://gramps-project.org/), the free genealogy software.

## Overview

[Gramps](https://gramps-project.org/) is free, open-source genealogy
software for building and researching your family tree.
[gramps-web](https://github.com/gramps-project/gramps-web) is its
established web frontend — it lets you access your tree from a browser,
share it with family members, and collaborate on research together.

Gramps Connect is a newer web frontend for that same
[gramps-web-api](https://github.com/gramps-project/gramps-web-api)
server, built around two ideas:

- **Instant browsing, even on a huge family tree.** Searching or
  filtering a large tree (tens of thousands of people) can otherwise mean
  waiting a long time — one real example took over a minute and a half
  for a single search. Gramps Connect keeps a smart, local copy of the
  parts of your tree you're looking at, right in your browser, so
  browsing, sorting, and filtering feel instant — closer to searching
  contacts already on your phone than looking someone up over a slow
  connection.
- **Watching each other work, live.** Family history is often a group
  effort — several people editing the same tree. Gramps Connect shows you
  what other researchers are changing as they change it, without needing
  to refresh the page, the same way collaborative documents show you a
  co-author's edits appearing in real time.

Gramps Connect is under active development. The standalone build,
**gramps-connect-desktop**, is the easiest way to try it today (see
[Installing](#installing), below); a containerized deployment is
available for hosting it for a family to share (see
[Deploying](#deploying)). If you're looking for a fully mature,
feature-complete option right now, [gramps-web](https://github.com/gramps-project/gramps-web)
or the [desktop application](https://gramps-project.org/download/) cover
more ground.

For a full tour of the app itself, see [docs/Overview.md](docs/Overview.md);
for the search-box query language behind it, see [docs/GOQL.md](docs/GOQL.md).

<img width="1489" height="704" alt="image" src="https://github.com/user-attachments/assets/1183bb72-520f-44fb-ace7-d88c84724697" />

## FAQ

**How does gramps-connect-desktop differ from the server-based
deployment?**

gramps-connect-desktop is the standalone build (see Installing, below).
One file bundles `app/`'s frontend and
`gramps-web-api`'s backend together with SQLite, runs entirely on your
own machine, and only listens on `127.0.0.1` — nothing about it is
reachable over a network, and it always has exactly one hardcoded user
(`admin`/`admin`). It's for trying Gramps Connect on your own machine,
not for sharing a tree with anyone else.

`deploy/` (see Deploying, below) is the real multi-user shape: a
containerized `app/` + `gramps-web-api` backed by real Postgres, fronted
by Caddy for TLS, meant to actually be hosted somewhere — real secrets, a
real domain/certificate, and multiple users each with their own login.
It's also the only way to see live collaboration in action — the
standalone build is single-user by design, so there's no one else's
edits to watch appear.

**How does gramps-connect-desktop compare to Gramps Desktop?**

Closer than "server-based deployment" above might suggest — both are
single-user, local-only apps built on the same underlying Gramps
database. Today, Desktop is far ahead on functionality: decades of
native tools, gramplets, and reports that `gramps-web-api`'s REST layer
doesn't (yet) cover, so this isn't a drop-in replacement. But a faster,
browser-based UI over the same data is a real candidate to eventually
rival Desktop for day-to-day use.

**Will my data or anything I do in gramps-connect-desktop get sent
anywhere?**

No. It only listens on `127.0.0.1`, telemetry is disabled, and everything
it stores lives in `~/.gramps-connect-desktop` on your own machine.

**Can I import my real family tree into gramps-connect-desktop?**

Yes — Family Trees → Import... takes a Gramps XML (`.gramps`) or GEDCOM
(`.ged`) file, same as the real deployment. Just don't treat it as your
only copy — keep a backup regardless, the way you should for any tool
still under active development.

**Does upgrading gramps-connect-desktop wipe my data?**

No — `~/.gramps-connect-desktop` is separate from the app binary, so
installing a newer version reuses whatever's already there. Delete that
folder yourself if you want a clean slate.

## Installing

**Want to try it without building anything?** Every current download lives
on the **[latest release](https://github.com/dsblank/gramps-connect/releases/latest)**
— pick the section below for your platform. All of them are
gramps-connect-desktop, not the real multi-user deployment shape (see
[Deploying](#deploying) below for that): a single downloadable app or
package, no separate install,
server, or database setup beyond what's noted per platform. Every variant
starts with an empty tree — import your own Gramps XML (`.gramps`) or
GEDCOM (`.ged`) file via the app's own Family Trees → Import... screen
once it's running — and shares one login: **`admin`** / **`admin`**.

First run creates a small data directory in your home folder
(`.gramps-connect-desktop`) holding that tree; later runs reuse it. Delete that
folder to reset back to a blank slate. The app only listens on `127.0.0.1`
(your own machine) — it isn't reachable from other devices on your network.
These are unsigned, x86_64-only builds, hence the OS warnings described
below — not a sign anything is wrong.

### Windows

1. Download `gramps-connect-desktop-windows.zip` from the
   [latest release](https://github.com/dsblank/gramps-connect/releases/latest)
   and unzip it (right-click → Extract All).
2. Open the extracted folder and double-click `gramps-connect-desktop.exe`.
3. Windows will likely show a **SmartScreen** warning ("Windows protected
   your PC") because this isn't a signed executable. Click **More info**,
   then **Run anyway**.
4. A window opens automatically, running the app. Log in as `admin` /
   `admin`.

### macOS (Apple Silicon)

For M1/M2/M3/M4 Macs.

1. Download `gramps-connect-desktop-macos-arm64.zip` from the
   [latest release](https://github.com/dsblank/gramps-connect/releases/latest)
   and unzip it (double-click, or right-click → Open, depending on your
   Mac's settings) to get `gramps-connect-desktop.app`.
2. Double-click `gramps-connect-desktop.app`. This build is signed with a
   Developer ID and notarized by Apple, so it should open normally with no
   Gatekeeper warning at all. If you see one anyway, see Troubleshooting.
3. A window opens automatically, running the app. Log in as `admin` /
   `admin`.

### macOS (Intel)

For older Intel-based Macs (pre-Apple Silicon). Same steps as Apple Silicon
above, but download `gramps-connect-desktop-macos-intel.zip` instead.

### Linux (.deb — Debian, Ubuntu, and derivatives)

1. Download the `.deb` file (`gramps-connect-desktop_*_amd64.deb`) from the
   [latest release](https://github.com/dsblank/gramps-connect/releases/latest).
2. Install it: `sudo apt install ./gramps-connect-desktop_*_amd64.deb`
   (installing from a local file rather than a repo, so apt will likely
   warn that the package isn't signed — expected, see Troubleshooting).
3. Run `gramps-connect-desktop` from a terminal, or find "Gramps Connect Desktop"
   in your applications menu.
4. This opens in its own **native window**, using GTK3 + WebKit2 already on
   your system (common on Linux desktops — many apps depend on them
   already; neither is bundled by this package). If your system doesn't
   have them, it opens in a **browser tab** instead (see Troubleshooting).
   Log in as `admin` / `admin`.
5. To uninstall: `sudo apt remove gramps-connect-desktop`.

### Linux (.rpm — Fedora, RHEL, AlmaLinux, and derivatives)

1. Download the `.rpm` file (`gramps-connect-desktop-*.x86_64.rpm`) from the
   [latest release](https://github.com/dsblank/gramps-connect/releases/latest).
2. Install it: `sudo dnf install ./gramps-connect-desktop-*.x86_64.rpm` (on a
   system without `dnf`, `sudo rpm -i gramps-connect-desktop-*.x86_64.rpm`
   works too, just without automatic dependency resolution). As with the
   `.deb` above, installing from a local file means dnf/rpm will likely
   warn that the package isn't signed — expected.
3. Run `gramps-connect-desktop` from a terminal, or find "Gramps Connect Desktop"
   in your applications menu.
4. This opens in its own **native window** (or falls back to a browser tab)
   — same as the `.deb` above. Log in as `admin` / `admin`.
5. To uninstall: `sudo dnf remove gramps-connect-desktop`.

## Troubleshooting

- **Windows SmartScreen ("Windows protected your PC")** — expected, since
  this build isn't code-signed. Click **More info** → **Run anyway**.
- **macOS Gatekeeper ("cannot be opened because Apple cannot check it for
  malicious software")** — this build is signed with a Developer ID and
  notarized by Apple, so this shouldn't happen. If it does, first try
  clearing the quarantine flag from the whole `.app` at once:
  `xattr -cr gramps-connect-desktop.app` (run from Terminal, in the folder
  you unzipped it into). Please also report it — it likely means the
  notarization ticket didn't survive being downloaded/unzipped as expected,
  or the build wasn't notarized correctly.
- **apt/dnf warns the `.deb`/`.rpm` isn't signed, or skips an OpenPGP
  check** — expected. These packages are built by this repo's own CI, not
  published to a signed distro repository, so installing them from a local
  file always looks this way; it doesn't mean anything is wrong.
- **`dnf: command not found` / `rpm: command not found`** — your distro is
  Debian/Ubuntu-based (or otherwise doesn't ship `rpm`), so the `.rpm`
  package is the wrong download. Grab the `.deb` file instead and install it
  with `sudo apt install ./gramps-connect-desktop_*_amd64.deb` (see the `.deb`
  section above).
- **No window or browser tab appears on any platform** — the app always
  tries to open one automatically once its server is up; if that somehow
  fails, open `http://127.0.0.1:5050` yourself. If nothing is listening
  there either, something crashed before reaching that point — check the
  terminal output (Windows: run `gramps-connect-desktop.exe` from a `cmd`/
  PowerShell window instead of double-clicking, so you can see it) for an
  error, and consider opening an issue with that output.
- **The app won't start / port already in use** — only one instance can run
  at a time (it's hardcoded to `127.0.0.1:5050`). Close any other running
  copy, or anything else using port 5050, and try again.
- **A browser tab opens instead of a native window** — the app always
  tries a native window first and falls back automatically if it can't:
  WebView2 on Windows (present by default on Windows 10/11) or WKWebView
  on macOS (always present) couldn't be reached, or on Linux, GTK3 +
  WebKit2 aren't installed system-wide (install `python3-gi`,
  `gir1.2-gtk-3.0`, and `gir1.2-webkit2-4.1`, or your distro's
  equivalents, and relaunch to get a native window instead). The app
  still works fully in the browser tab either way — this only affects how
  it's presented, not what it can do.
- **Start over from a blank tree** — delete the `.gramps-connect-desktop`
  folder in your home directory, then relaunch.
- **Looking for a real multi-user deployment instead of this single-user
  local build?** See [Deploying](#deploying) below.

## For Developers

### Architecture

Two mechanisms make `app/` possible:

1. **Local-first cache** — a WASM build of SQLite runs inside the
   browser, mirroring server data (fetched via `gramps-web-api`'s fast,
   SQL-pushed-down `/api/<type>/query/` endpoints) into local tables and
   persisting them to [OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
   so a repeat visit skips the network entirely.
2. **Live sync** — the client polls `gramps-web-api`'s existing
   `GET /api/transactions/history/` endpoint (the object-edit audit/undo
   log it already ships) on a short interval, and for each object it
   reports as changed, refetches and patches just that row in the local
   cache. No persistent connection or Postgres-specific change capture
   required — a plain authenticated `GET`, so it works against any
   backend.

### Repo layout

- **`app/`** — the production React client: all ten object-type views,
  `where_expr` filtering, an OPFS-persisted WASM SQLite cache, and live
  sync, behind a `useSyncExternalStore`-based store layer (`app/src/store/`)
  with `@tanstack/react-virtual` for scrolling.
- **`dev-fixtures/`** — real `gramps-web-api` backends to run `app/`
  against locally (see Getting started below); not part of the product,
  just what makes local development possible without a hand-configured
  server of your own.
  - **`layer2-local-cache/api-fixture/`** and **`api-fixture-example/`** —
    two plain-SQLite instances: the former loaded with
    `gramps-bench`-generated synthetic data (scale testing), the latter
    with Gramps' own official `example.gramps` sample database (real date
    variety — modifiers, quality, ranges/spans). Live sync works against
    either of these too — it's just a poll against
    `/api/transactions/history/`, not tied to Postgres.
  - **`layer3-sync/`** — a real Postgres (`SharedPostgreSQL`)-backed
    instance, useful for exercising genuinely concurrent multi-writer
    edits against the same tree; what `app/.env.example`'s defaults point
    at.
- **`packages/gramps-date/`** — a TypeScript port of Gramps' `Date`
  model, calendar conversion, and locale-aware date display, used by
  `app/` (and anything else that needs to render/build a Gramps `Date`
  struct without a slow per-object round trip through Gramps' own Python
  date displayer). See its own README for scope and provenance.

A root-level npm workspace (`packages/*`, `app`) ties `app/` and
`packages/gramps-date` together as real workspace dependencies. The
fast `/query/` endpoints `app/` depends on live in `gramps-web-api`
itself (a separate repo, extended in place, backward compatible) via
[gramps-object-query-language](https://github.com/dsblank/gramps-object-query-language),
not in this repo.

### Getting started

```sh
npm install                 # installs the workspace (app/ + packages/gramps-date)
cp app/.env.example app/.env.local   # points at a running gramps-web-api instance
npm run dev -w app          # starts the Vite dev server
```

`app/` needs a real `gramps-web-api` backend to talk to — the quickest
way to get one locally is `dev-fixtures/layer3-sync/api-fixture/setup.sh`,
which stands up a Postgres-backed instance with example data;
`app/.env.example`'s defaults already point at it. **Read the script
before running it** — it is not idempotent against an already-populated
tree.

### Deploying

The dev setup above (`npm run dev -w app` plus a `dev-fixtures/` backend)
is for working on the code — it's two separate processes, one of them
unauthenticated-by-default and meant to be thrown away. `deploy/` is the
other thing entirely: a single containerized `app/` + `gramps-web-api`,
backed by real Postgres and fronted by Caddy for TLS, for actually running
Gramps Connect somewhere. Frontend and backend share one container/origin,
so there's no separate frontend image or CORS setup.

**Locally**, to try the real deployment shape rather than the dev server:

```sh
cp deploy/.env.example deploy/.env    # then edit it -- see the file's comments
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Then visit `https://localhost` (Caddy issues itself a local, self-signed
certificate automatically — accept the browser warning).

**On a real host**, build once on GitHub's runners instead of on the host
(`gh workflow run build-docker.yml`, or trigger it from the Actions tab),
which pushes `ghcr.io/<owner>/gramps-connect:latest`, then on the host:

```sh
cp deploy/.env.example deploy/.env    # real secrets/domain this time
docker compose -f deploy/docker-compose.yml --env-file deploy/.env pull
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d
```

Point a domain at the host and edit `deploy/Caddyfile` (one block swap) to
get a real certificate instead of the self-signed one — see
[deploy/README.md](deploy/README.md#tls).

Either way, first boot seeds a site admin from `deploy/.env` but creating
the first tree and assigning a user to it is a one-time API call, not a UI
flow yet — **[deploy/README.md](deploy/README.md)** covers that, plus
importing existing Gramps data, day-to-day `docker compose` commands, and
deployment-specific gotchas.

### Testing

```sh
npm run test -w app         # Vitest: pure store/sync logic, not full-app rendering
npm run typecheck -w app    # tsc --noEmit
npm run test -w packages/gramps-date
```

### Translations

`app/`'s UI strings go through `t()` (`app/src/i18n/i18n.ts`), which mirrors
[gramps-web](https://github.com/gramps-project/gramps-web)'s own approach —
a plain `{english: translated}` lookup, no i18n library — merged from two
sources per language, chosen at `setLanguage()` time and cached in-memory
until the next language switch:

- **The Gramps desktop vocabulary** — translated *live*, per request, by
  POSTing the strings actually in use to `gramps-web-api`'s existing
  `GET/POST /api/translations/<lang>` endpoint, which runs them through the
  installed `gramps` package's own gettext catalog. No static copy to keep
  in sync; always as fresh as whatever `gramps` version the server has
  installed. The fixed list of which desktop-vocabulary strings to request
  lives in `i18n.ts`'s `desktopStrings` array — grown by hand, one entry per
  string, whenever a newly-wrapped `t()` call turns out to be real Gramps
  vocabulary rather than something gramps-connect-specific.
- **gramps-web's own UI strings, and Gramps addons' strings** — bootstrapped
  as static `app/public/lang/{locale}.json` files (tracked in git, so the
  app works without anyone needing a Weblate connection) by
  `scripts/bootstrap-translations.py`, which reads `../gramps-web/lang/`
  and `../addons-source/*/po/*-local.po` — sibling checkouts of this repo,
  not a network call. Run it (`python3 scripts/bootstrap-translations.py`,
  needs `pip install polib`) whenever those sibling checkouts get updated
  and you want the static corpus refreshed; it's not wired into any build
  step, so nothing runs it automatically. Safe to re-run: without `--force`
  it skips any locale `.json` that already exists, and even with `--force`
  it only ever overwrites files under `app/public/lang/` — no network
  calls, no git operations, and any bad result is a `git checkout` away
  from undone.

Wrapping more of the app's own strings in `t()` is ongoing, incremental
work — `app/scripts/wrap-translations.mjs` is a one-time codemod (kept
around as a reusable tool) that mechanically wraps plain JSX text and a
safe attribute allowlist (`label`/`title`/`placeholder`); anything sourced
from a variable or object-literal property (view/column configs in
`app/src/store/views.ts`, dynamic API data, `notifications.show()` calls)
needs a manual `t(...)` at whatever component renders it instead.

### Contributing

Discussion happens on the [Gramps Discourse forum](https://gramps.discourse.group/);
issues and pull requests against this repo are welcome.

## License

AGPL-3.0-or-later, matching `gramps-web-api` and `gramps-web`. See
[LICENSE](LICENSE). `packages/gramps-date` translates GPL-2.0-or-later
Gramps core code into this project's AGPL-3.0-or-later codebase — see
its own README for how those two licenses combine.
