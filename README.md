# Gramps Connect

An experimental, faster, real-time-collaborative web frontend for
[Gramps](https://gramps-project.org/), the free genealogy software.

## Overview

[Gramps](https://gramps-project.org/) is free, open-source genealogy
software for building and researching your family tree.
[gramps-web](https://github.com/gramps-project/gramps-web) is its
existing web frontend — it lets you access your tree from a browser,
share it with family members, and collaborate on research together.

Gramps Connect is an early-stage experiment exploring what a faster,
more collaborative version of that web frontend could look like. It's
being built alongside gramps-web, not as a finished replacement — the
question this project is trying to answer is *whether* two specific
ideas actually work well in practice, before committing to them:

- **Instant browsing, even on a huge family tree.** Today, searching or
  filtering a large tree (tens of thousands of people) can mean waiting
  a long time — one real example took over a minute and a half for a
  single search. Gramps Connect keeps a smart, local copy of the parts
  of your tree you're looking at, right in your browser, so browsing,
  sorting, and filtering feel instant — closer to searching contacts
  already on your phone than looking someone up over a slow connection.
- **Watching each other work, live.** Family history is often a group
  effort — several people editing the same tree. Gramps Connect aims to
  show you what other researchers are changing as they change it,
  without needing to refresh the page, the same way collaborative
  documents show you a co-author's edits appearing in real time.

**This is a research project, not a product yet.** It isn't something
to move your family tree to today — there's no finished user interface,
no guarantee any particular part of it will end up in a real release,
and the whole thing is still being actively built and re-shaped. If
you're just looking to use Gramps, [gramps-web](https://github.com/gramps-project/gramps-web)
(or the [desktop application](https://gramps-project.org/download/)) is
where you want to be today. If you're curious about where the project
might be headed, or want to help figure that out, read on.

<img width="1489" height="704" alt="image" src="https://github.com/user-attachments/assets/1183bb72-520f-44fb-ace7-d88c84724697" />

## Installing

**Want to try it without building anything?** Every current download lives
on the **[latest release](https://github.com/dsblank/gramps-connect/releases/latest)**
— pick the section below for your platform. All of them are the same
experimental prototype described above, not a finished product or the real
deployment shape (see [Deploying](#deploying) below for that): a single
downloadable app or package, no separate install, server, or database setup
beyond what's noted per platform. Every variant starts with an empty tree —
import your own Gramps XML (`.gramps`) or GEDCOM (`.ged`) file via the app's
own Family Trees → Import... screen once it's running — and shares one
login: **`admin`** / **`admin`**.

First run creates a small data directory in your home folder
(`.gramps-connect-demo`) holding that tree; later runs reuse it. Delete that
folder to reset back to a blank slate. The app only listens on `127.0.0.1`
(your own machine) — it isn't reachable from other devices on your network.
These are unsigned, x86_64-only builds, hence the OS warnings described
below — expected for an experimental build like this, not a sign anything
is wrong.

### Windows

1. Download `gramps-connect-demo-windows.zip` from the
   [latest release](https://github.com/dsblank/gramps-connect/releases/latest)
   and unzip it (right-click → Extract All).
2. Open the extracted folder and double-click `gramps-connect-demo.exe`.
3. Windows will likely show a **SmartScreen** warning ("Windows protected
   your PC") because this isn't a signed executable. Click **More info**,
   then **Run anyway**.
4. A window opens automatically, running the app. Log in as `admin` /
   `admin`.

### macOS (Apple Silicon)

For M1/M2/M3/M4 Macs.

1. Download `gramps-connect-demo-macos-arm64.zip` from the
   [latest release](https://github.com/dsblank/gramps-connect/releases/latest)
   and unzip it (double-click, or right-click → Open, depending on your
   Mac's settings).
2. Open Terminal, `cd` into the extracted folder, and run
   `./gramps-connect-demo`.
   - Double-clicking the executable directly from Finder will likely be
     blocked by **Gatekeeper** ("cannot be opened because the developer
     cannot be verified") since it isn't signed/notarized — running it from
     Terminal avoids that dialog, or you can right-click the file → Open →
     Open Anyway if you'd rather not use Terminal.
3. A window opens automatically, running the app. Log in as `admin` /
   `admin`.

### macOS (Intel)

For older Intel-based Macs (pre-Apple Silicon). Same steps as Apple Silicon
above, but download `gramps-connect-demo-macos-intel.zip` instead.

### Linux (.deb — Debian, Ubuntu, and derivatives)

1. Download the `.deb` file (`gramps-connect-demo_*_amd64.deb`) from the
   [latest release](https://github.com/dsblank/gramps-connect/releases/latest).
2. Install it: `sudo apt install ./gramps-connect-demo_*_amd64.deb`
   (installing from a local file rather than a repo, so apt will likely
   warn that the package isn't signed — expected, see Troubleshooting).
3. Run `gramps-connect-demo` from a terminal, or find "Gramps Connect Demo"
   in your applications menu.
4. Unlike Windows/macOS, this opens in a **browser tab**, not its own
   window — GTK/WebKit2, which would be needed for a native window, is
   deliberately not bundled or required by this package (see
   Troubleshooting). Log in as `admin` / `admin`.
5. To uninstall: `sudo apt remove gramps-connect-demo`.

### Linux (.rpm — Fedora, RHEL, AlmaLinux, and derivatives)

1. Download the `.rpm` file (`gramps-connect-demo-*.x86_64.rpm`) from the
   [latest release](https://github.com/dsblank/gramps-connect/releases/latest).
2. Install it: `sudo dnf install ./gramps-connect-demo-*.x86_64.rpm` (on a
   system without `dnf`, `sudo rpm -i gramps-connect-demo-*.x86_64.rpm`
   works too, just without automatic dependency resolution). As with the
   `.deb` above, installing from a local file means dnf/rpm will likely
   warn that the package isn't signed — expected.
3. Run `gramps-connect-demo` from a terminal, or find "Gramps Connect Demo"
   in your applications menu.
4. This opens in a **browser tab**, not its own window — same reason as the
   `.deb` above. Log in as `admin` / `admin`.
5. To uninstall: `sudo dnf remove gramps-connect-demo`.

## Troubleshooting

- **Windows SmartScreen ("Windows protected your PC")** — expected, since
  this build isn't code-signed. Click **More info** → **Run anyway**.
- **macOS Gatekeeper ("cannot be opened because the developer cannot be
  verified")** — expected, since this build isn't signed/notarized. Run it
  from Terminal instead of double-clicking, or right-click → Open → Open
  Anyway.
- **apt/dnf warns the `.deb`/`.rpm` isn't signed, or skips an OpenPGP
  check** — expected. These packages are built by this repo's own CI, not
  published to a signed distro repository, so installing them from a local
  file always looks this way; it doesn't mean anything is wrong.
- **No window or browser tab appears on any platform** — the app always
  tries to open one automatically once its server is up; if that somehow
  fails, open `http://127.0.0.1:5050` yourself. If nothing is listening
  there either, something crashed before reaching that point — check the
  terminal output (Windows: run `gramps-connect-demo.exe` from a `cmd`/
  PowerShell window instead of double-clicking, so you can see it) for an
  error, and consider opening an issue with that output.
- **The app won't start / port already in use** — only one instance can run
  at a time (it's hardcoded to `127.0.0.1:5050`). Close any other running
  copy, or anything else using port 5050, and try again.
- **Windows/macOS open a browser tab instead of a native window** — this is
  the same automatic fallback Linux always uses, just triggered
  unexpectedly; it means the OS's built-in web view component (WebView2 on
  Windows, present by default on Windows 10/11; WKWebView on macOS, always
  present) couldn't be reached. The app still works fully in the browser
  tab — this only affects how it's presented, not what it can do.
- **Start over from a blank tree** — delete the `.gramps-connect-demo`
  folder in your home directory, then relaunch.
- **Looking for a real multi-user deployment instead of this single-user
  local demo?** See [Deploying](#deploying) below.

## For Developers

### Approach

Rather than rewriting the frontend in one large effort, this project is
being de-risked through small, disposable prototypes — proving each hard
technical question in isolation before committing to it. See
[PLAN.md](PLAN.md) for the full reasoning, the two product bets above in
technical detail, and the layered plan each prototype followed.

The two bets translate to two technical mechanisms:

1. **Local-first cache** — a WASM build of SQLite runs inside the
   browser, mirroring server data (fetched via `gramps-web-api`'s fast,
   SQL-pushed-down `/api/<type>/query/` endpoints) into local tables and
   persisting them to [OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
   so a repeat visit skips the network entirely.
2. **Live sync** — the client polls `gramps-web-api`'s existing
   `GET /api/transactions/history/` endpoint (the object-edit audit/undo
   log it already ships) on a short interval, and for each object it
   reports as changed, refetches and patches just that row in the local
   cache. No server changes, persistent connection, or Postgres-specific
   change capture required — a plain authenticated `GET`, so it works
   against any backend.

### Repo layout

- **`app/`** — the production React client (React was chosen over
  gramps-web's Lit/Material Web Components approach — see
  [PLAN.md](PLAN.md)'s roadmap notes for why): all ten object-type views,
  `where_expr` filtering, an OPFS-persisted WASM SQLite cache, and live
  sync, behind a `useSyncExternalStore`-based store layer (`app/src/store/`)
  with `@tanstack/react-virtual` for scrolling. Started as a port of an
  earlier plain-TS/HTML spike (Layers 0-3 in [PLAN.md](PLAN.md)); that
  spike code has since been removed now that `app/` fully supersedes it,
  but the fixtures it's developed and tested against live on in
  `dev-fixtures/` (below).
- **`dev-fixtures/`** — real `gramps-web-api` backends to run `app/`
  against locally (see Getting started below); not part of the product,
  just what makes local development possible without a hand-configured
  server of your own.
  - **`layer2-local-cache/api-fixture/`** and **`api-fixture-example/`** —
    two plain-SQLite instances: the former loaded with
    `gramps-bench`-generated synthetic data (scale testing), the latter
    with Gramps' own official `example.gramps` sample database (real date
    variety — modifiers, quality, ranges/spans). Live sync works against
    either of these too now — it's just a poll against
    `/api/transactions/history/`, not tied to Postgres.
  - **`layer3-sync/`** — a real Postgres (`SharedPostgreSQL`)-backed
    instance, useful for exercising genuinely concurrent multi-writer
    edits against the same tree; what `app/.env.example`'s defaults point
    at. No longer has any Postgres-specific change-capture wiring of its
    own (the `pg_notify` trigger + WebSocket relay this fixture used to
    also set up were removed once live sync moved to polling — see
    PLAN.md's Layer 3 section).
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

### Contributing

This is still a fast-moving, early-stage prototype — expect things to
be restructured or thrown out as the layered plan in [PLAN.md](PLAN.md)
teaches us more. Discussion happens on the
[Gramps Discourse forum](https://gramps.discourse.group/) (see
[this thread](https://gramps.discourse.group/t/gramps-web-api-list-performance/9007)
for the performance problem that originally motivated this project);
issues and pull requests against this repo are welcome, especially ones
that engage with the reasoning in PLAN.md rather than just the code.

## License

AGPL-3.0-or-later, matching `gramps-web-api` and `gramps-web`. See
[LICENSE](LICENSE). `packages/gramps-date` translates GPL-2.0-or-later
Gramps core code into this project's AGPL-3.0-or-later codebase — see
its own README for how those two licenses combine.
