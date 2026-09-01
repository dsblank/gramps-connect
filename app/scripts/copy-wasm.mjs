// Postinstall: several dependencies ship runtime files that need to be
// served as static assets at a stable path rather than bundled, so each is
// copied into public/ (gitignored -- generated, not source, same treatment
// layer2-local-cache/client/public/ already got).
//
//   sql.js: its WASM binaries. initSqlJs's locateFile expects them at `/`.
//
//   maplibre-gl: its worker script, loaded via setWorkerUrl() in
//   MapCanvas.tsx because Vite's asset scanner can't see the dynamic
//   `new URL(...)` maplibre-gl builds internally (see the comment there).
//   Its shared.mjs is copied alongside it for the same reason the worker
//   itself is copied rather than left for `?url` to fingerprint: the worker
//   file does `import ... from "./maplibre-gl-shared.mjs"`, a plain
//   relative specifier baked into the package, unaware of any bundler.
//   Fingerprinting just the worker (a hashed name Vite chose) would leave
//   that import resolving to a same-named sibling that was never copied;
//   copying both files verbatim, under their own unhashed names, keeps
//   that relative import intact exactly as the package ships it.
//
//   plotly.js (PoC, see pyodideWorker.ts's _plotly_figure_from): the JS
//   side of `print(a plotly Figure)`, at a stable /plotly.min.js path --
//   see the `copies` entry below for the full reasoning.
//
//   pyodide (PoC, see pyodideWorker.ts): its asm/wasm/stdlib data files,
//   which loadPyodide() fetches at runtime from `indexURL` rather than
//   having them bundled by Vite. Under public/pyodide/ rather than flat in
//   public/ since it's several same-named-pattern files.
//
//   micropip (PoC, see pyodideWorker.ts): NOT bundled by the "pyodide" npm
//   package at all (that ships only pyodide's own core runtime, not its
//   package repository) -- confirmed live: pyodideWorker.ts's
//   `pyodide.loadPackage("micropip")` silently fetched it from
//   cdn.jsdelivr.net on first run, which is exactly the runtime CDN
//   dependency this project avoids everywhere else (offline Docker/
//   standalone builds). Fetched once here instead (same jsdelivr URL
//   pyodide's own loader falls back to, sha256-checked against
//   pyodide-lock.json) so it's already sitting in public/pyodide/ by the
//   time anyone's browser asks for it.
//
//   extra packages (PoC, see pyodideWorker.ts's onmessage): pure-Python
//   PyPI wheels a Gramplet might want (pygal, for html() chart output)
//   that aren't part of Pyodide's own catalog at all -- unlike the
//   "bundled-but-unshipped official Pyodide packages" block further down
//   (numpy, matplotlib, networkx, ...), which *are* in Pyodide's own
//   catalog and so keep that catalog's own dependency metadata; these
//   don't exist there under any name, so this block supplies its own
//   file_name/sha256/depends by hand. Same offline
//   concern as the micropip block above, so fetched once here (sha256-
//   pinned) into public/pyodide/ (not a separate directory: these are
//   registered as real entries in public/pyodide/pyodide-lock.json
//   itself, the exact mechanism micropip's own entry already lives in,
//   rather than a second bespoke registry/loader). Once registered there,
//   a Gramplet just writes a plain `import pygal` -- onmessage calls
//   pyodide.loadPackagesFromImports() on the code before running it,
//   Pyodide's own static-import scanner, so this needs no install()
//   builtin of our own and no special-casing in the Gramplet's own code.
//
//   local packages (PoC, see pyodideWorker.ts's onmessage): same
//   registry/mechanism as extra packages above, but for wheels this repo
//   builds itself rather than fetches from PyPI -- scripts/
//   build-stub-wheels.py's gi/orjson (real installable stand-ins for
//   gramps.gen.lib's two non-stdlib deps, replacing what used to be
//   runtime sys.modules injection -- see that script's own docstring) and
//   scripts/build-gramps-wheel.py's gramps wheel itself, `depends`-linked
//   to gi+orjson so a Gramplet's own `import gramps.gen.lib` pulls both
//   in automatically via Pyodide's own dependency resolution -- confirmed
//   live. Best-effort: most contributors haven't run either Python
//   script (the gramps one specifically needs a working gramps install),
//   so a missing dist/ subdirectory just means that package isn't
//   registered, not a failed `npm install` for everyone else.
//
// Each source resolved via require.resolve rather than a fixed
// node_modules/<pkg> path, since npm workspaces hoist both to the repo
// root's node_modules, not app/node_modules.
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import path from "node:path";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(appDir);
const require = createRequire(import.meta.url);
const destDir = path.join(appDir, "public");

// dist/* is the one subpath maplibre-gl's package.json "exports" allows for
// any resolver condition -- unlike the bare specifier, which only defines an
// "import" condition and so throws ERR_PACKAGE_PATH_NOT_EXPORTED under
// require.resolve.
const copies = [
  { src: path.dirname(require.resolve("sql.js")), files: ["sql-wasm.wasm", "sql-wasm-browser.wasm"] },
  {
    src: path.dirname(require.resolve("maplibre-gl/dist/maplibre-gl-worker.mjs")),
    files: ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"],
  },
  {
    src: path.dirname(require.resolve("pyodide/pyodide.mjs")),
    files: ["pyodide.asm.mjs", "pyodide.asm.wasm", "pyodide-lock.json", "python_stdlib.zip"],
    destSubdir: "pyodide",
  },
  {
    // plotly.js itself (PoC, see pyodideWorker.ts's _plotly_figure_from):
    // the JS side of `print(a plotly Figure)`. plotly's Python package
    // (registered under EXTRA_PACKAGES below) only builds the figure's
    // JSON spec -- rendering it still needs plotly.js in the page, the
    // same way a matplotlib figure needs nothing further (it's rasterized
    // to a PNG data: URI Python-side) but pygal's SVG needs no JS at all.
    // Bundled here rather than left to `include_plotlyjs="cdn"` for the
    // same offline-Docker/standalone-build reason micropip's wheel and
    // pygal's own wheel are fetched into public/pyodide/ above rather
    // than left to Pyodide's own jsdelivr fallback. Single un-hashed file
    // at a stable /plotly.min.js path (not fingerprinted by Vite's asset
    // pipeline), same treatment as maplibre-gl-worker.mjs above --
    // pyodideWorker.ts's _plotly_figure_from references this exact path
    // literally, the same way MapItemEditorDialog.tsx does for
    // maplibre-gl-worker.mjs.
    src: path.dirname(require.resolve("plotly.js-dist-min/plotly.min.js")),
    files: ["plotly.min.js"],
  },
];

for (const { src, files, destSubdir } of copies) {
  const dest = destSubdir ? path.join(destDir, destSubdir) : destDir;
  await mkdir(dest, { recursive: true });
  for (const file of files) {
    await copyFile(path.join(src, file), path.join(dest, file));
  }
  console.log(`copy-wasm: copied ${files.join(", ")} to ${path.relative(appDir, dest)}/`);
}

// Bundled-but-unshipped official Pyodide packages -- packages already
// listed (with real file_name/sha256) in the base pyodide-lock.json the
// "pyodide" npm package ships, but whose .whl the npm package doesn't
// actually include (it ships only its own core runtime -- asm/wasm/stdlib
// -- plus, as of the current version, micropip's wheel). Confirmed live:
// leaving one of these unfetched doesn't break the Gramplet that imports
// it -- Pyodide's own loader falls back to fetching it from
// cdn.jsdelivr.net at runtime instead -- but that's exactly the runtime
// CDN dependency this project avoids everywhere else (offline Docker/
// standalone builds), so each is fetched once here instead (same jsdelivr
// URL Pyodide's own loader falls back to, sha256-checked against the
// lock file's own entry) so it's already sitting in public/pyodide/ by
// the time anyone's browser asks for it. Version pin comes from the
// "pyodide" npm package's own version (the CDN path segment pyodide's own
// loader uses, e.g. v314.0.6), not the lock file (which has no such field
// -- it only names packages, not the pyodide release they belong to).
//
//   micropip: needed to satisfy `import micropip` if a Gramplet still
//   uses it directly (see the "extra packages" block below for the
//   preferred offline alternative).
//
//   numpy: not imported by any Gramplet boilerplate itself, but pulled in
//   transitively by `networkx`'s and `matplotlib`'s own `depends` entries
//   already present in the base lock file (several of networkx's
//   algorithms, e.g. spring_layout, `import numpy` lazily at call time).
//
//   matplotlib (+ its full dependency closure -- contourpy/cycler/
//   fonttools/kiwisolver/packaging/pillow/pyparsing/python-dateutil/pytz/
//   six): confirmed live that leaving even one of these unfetched doesn't
//   surface as a load error at all -- loadPackagesFromImports() catches
//   each package's fetch failure individually and reports it only via the
//   (suppressed) messageCallback, then silently proceeds, so a Gramplet's
//   `import matplotlib` fails downstream with a bare ModuleNotFoundError
//   instead of anything pointing at the real cause. Every entry needs to
//   be listed explicitly here (unlike EXTRA_PACKAGES's `depends` chains,
//   which Pyodide's resolver walks on its own once one entry is
//   registered) because this list is what actually gets pre-fetched --
//   the resolver only walks `depends` at load time to know what to ask
//   for, not to decide what this script fetches ahead of time.
//
//   networkx (+ decorator/setuptools, the two of its four `depends` --
//   matplotlib/numpy are already covered above -- not otherwise needed by
//   anything else here): it's a real Pyodide catalog package, confirmed
//   against the base lock file, so it belongs in this list rather than
//   EXTRA_PACKAGES below -- an earlier version of this file fetched a
//   plain PyPI wheel for it under EXTRA_PACKAGES instead, which
//   *overwrote* this correct catalog entry's `depends` (decorator,
//   setuptools, matplotlib, numpy) with an incomplete hand-written one
//   (just numpy), silently missing the same way matplotlib's own gap did
//   above until a code path that actually needs decorator/setuptools hit
//   it. Same file_name/sha256 either way (3.6.1), so no behavior changed
//   here beyond fixing `depends`.
const BUNDLED_PYODIDE_PACKAGES = [
  "micropip",
  "numpy",
  "matplotlib",
  "contourpy",
  "cycler",
  "fonttools",
  "kiwisolver",
  "packaging",
  "pillow",
  "pyparsing",
  "python-dateutil",
  "pytz",
  "six",
  "networkx",
  "decorator",
  "setuptools",
];

{
  const pyodideDir = path.join(destDir, "pyodide");
  const lockPath = path.join(pyodideDir, "pyodide-lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const pyodideVersion = require("pyodide/package.json").version;
  for (const name of BUNDLED_PYODIDE_PACKAGES) {
    const pkg = lock.packages[name];
    const dest = path.join(pyodideDir, pkg.file_name);
    const alreadyValid = await readFile(dest).then(
      (buf) => createHash("sha256").update(buf).digest("hex") === pkg.sha256,
      () => false
    );
    if (alreadyValid) {
      console.log(`copy-wasm: ${pkg.file_name} already present in public/pyodide/`);
      continue;
    }
    const url = `https://cdn.jsdelivr.net/pyodide/v${pyodideVersion}/full/${pkg.file_name}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const sha256 = createHash("sha256").update(buf).digest("hex");
      if (sha256 !== pkg.sha256) {
        throw new Error(`sha256 mismatch: expected ${pkg.sha256}, got ${sha256}`);
      }
      await writeFile(dest, buf);
      console.log(`copy-wasm: fetched ${pkg.file_name} from jsdelivr to public/pyodide/`);
    } catch (err) {
      console.warn(
        `copy-wasm: could not pre-fetch ${pkg.file_name} (${err.message}) -- ` +
          "pyodideWorker.ts will fall back to fetching it from jsdelivr.net at runtime instead"
      );
    }
  }
}

// Extra packages -- see the doc comment above. `name` is PEP 503
// normalized (hyphens, matching pygal's own PyPI distribution name) --
// confirmed live that Pyodide's own dependency walker normalizes `depends`
// references that way when resolving them against its repository, even
// though this doesn't affect file_name (the literal wheel filename PyPI
// publishes, which importlib_metadata's own project keeps underscored) or
// the Python import name (also underscored -- `import importlib_metadata`,
// unrelated to the distribution-name field here). `depends` chains
// pygal -> importlib-metadata -> zipp (both plain runtime imports at
// pygal's own top level, not extras -- verified against the installed
// package's own metadata, not guessed) so requesting just "pygal" pulls
// in the whole closure via Pyodide's own resolution, the same as it does
// for every package already in its distribution.
const EXTRA_PACKAGES = [
  {
    name: "pygal",
    file_name: "pygal-3.1.3-py3-none-any.whl",
    url: "https://files.pythonhosted.org/packages/c3/43/5441ea0f9a35a0f2d30a79712cc21c737cf959a3451565d41e09d2fd90de/pygal-3.1.3-py3-none-any.whl",
    sha256: "c0b9bc2d31df4094c9f65b0969b62571a47b28197aced081b1a9433c3a760f32",
    imports: ["pygal"],
    depends: ["importlib-metadata"],
  },
  {
    name: "importlib-metadata",
    file_name: "importlib_metadata-9.0.0-py3-none-any.whl",
    url: "https://files.pythonhosted.org/packages/38/3d/2d244233ac4f76e38533cfcb2991c9eb4c7bf688ae0a036d30725b8faafe/importlib_metadata-9.0.0-py3-none-any.whl",
    sha256: "2d21d1cc5a017bd0559e36150c21c830ab1dc304dedd1b7ea85d20f45ef3edd7",
    imports: ["importlib_metadata"],
    depends: ["zipp"],
  },
  {
    name: "zipp",
    file_name: "zipp-4.1.0-py3-none-any.whl",
    url: "https://files.pythonhosted.org/packages/3a/13/547360d81e6d88d58492968ffda9f9542854f11310ee556fef14260cc886/zipp-4.1.0-py3-none-any.whl",
    sha256: "25ad4e16390cd314347dd8f1de67a2ac538ae658ed4ab9db16029c07c188e97f",
    imports: ["zipp"],
    depends: [],
  },
  // plotly -> narwhals + packaging, its only two *required* runtime deps
  // per its own PyPI metadata -- confirmed live that a plain
  // `import plotly.graph_objects as go` plus building/rendering a
  // go.Figure needs nothing more than these two. Deliberately NOT
  // including numpy/pandas here even though `import plotly.express`
  // needs numpy just to import, and go.Figure/express both reach for
  // pandas once real chart data (not a pre-built dataframe) flows
  // through -- unlike matplotlib's own closure above (bundled in full
  // because every one of those is required for *any* matplotlib use),
  // numpy/pandas are only needed by the heavier plotly.express/numpy-
  // array codepaths, so forcing them as a `depends` here would tax every
  // plain go.Figure Gramplet (the common case) for weight only some
  // Gramplets need. A Gramplet that does need express with plain
  // lists (or numpy arrays) just adds its own `import pandas`/
  // `import numpy` -- picked up by the existing loadPackagesFromImports
  // scan below like any other import, no special-casing needed since
  // both are already real Pyodide catalog packages (pandas depends only
  // on numpy/python-dateutil/pytz, all already bundled via matplotlib's
  // own closure above).
  {
    name: "plotly",
    file_name: "plotly-7.0.0-py3-none-any.whl",
    url: "https://files.pythonhosted.org/packages/e0/2f/6f492108d9955bac97979d9949c1b35eab30fc630b1f22bbdd2c7cacbab4/plotly-7.0.0-py3-none-any.whl",
    sha256: "78cbf7bd06d1b05bb3b8ec1b709864695229b55151b6f7530fbf55517ead6fdd",
    imports: ["plotly"],
    depends: ["narwhals", "packaging"],
  },
  {
    name: "narwhals",
    file_name: "narwhals-2.25.0-py3-none-any.whl",
    url: "https://files.pythonhosted.org/packages/eb/dc/55481808fd70ef1567cf13540ffd4702af3f74b112e35427564b03f79c2d/narwhals-2.25.0-py3-none-any.whl",
    sha256: "1f0f403e8c7e4463cde9bfe78b12fdd809e3ae3dda6d9b2f802934fb9c7a6a8f",
    imports: ["narwhals"],
    depends: [],
  },
];

{
  const pyodideDir = path.join(destDir, "pyodide");
  const lockPath = path.join(pyodideDir, "pyodide-lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  for (const { name, file_name, url, sha256, imports, depends } of EXTRA_PACKAGES) {
    const dest = path.join(pyodideDir, file_name);
    const alreadyValid = await readFile(dest).then(
      (buf) => createHash("sha256").update(buf).digest("hex") === sha256,
      () => false
    );
    if (alreadyValid) {
      console.log(`copy-wasm: ${file_name} already present in public/pyodide/`);
    } else {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const gotSha256 = createHash("sha256").update(buf).digest("hex");
        if (gotSha256 !== sha256) throw new Error(`sha256 mismatch: expected ${sha256}, got ${gotSha256}`);
        await writeFile(dest, buf);
        console.log(`copy-wasm: fetched ${file_name} to public/pyodide/`);
      } catch (err) {
        console.warn(`copy-wasm: could not pre-fetch ${file_name} (${err.message}) -- \`import ${imports[0]}\` will fail until this succeeds (rerun npm install)`);
        continue; // don't register a lock entry for a wheel that isn't actually there
      }
    }
    // version omitted -- Pyodide's loader doesn't require it for a
    // package it's just about to fetch by file_name, and pinning would go
    // stale independently of PYODIDE_VERSION the way it does for every
    // other package here.
    lock.packages[name] = {
      name, version: "0", file_name, install_dir: "site",
      sha256, package_type: "package", imports, depends,
      unvendored_tests: false,
    };
  }
  await writeFile(lockPath, JSON.stringify(lock));
  console.log(`copy-wasm: registered ${EXTRA_PACKAGES.map((p) => p.name).join(", ")} in public/pyodide/pyodide-lock.json`);
}

// Locally-built packages -- see the doc comment above. srcDir is relative
// to <repo root>/dist/; filePrefix picks out that package's wheel (each
// script's own version stamp makes the exact filename unpredictable, so
// this discovers it the same way the old gramps-wheel-only version of
// this block did: newest matching file in the directory, sorted).
const LOCAL_PACKAGES = [
  { name: "gi", srcDir: "stub-wheels", filePrefix: "gi-", imports: ["gi"], depends: [], buildHint: "scripts/build-stub-wheels.py" },
  { name: "orjson", srcDir: "stub-wheels", filePrefix: "orjson-", imports: ["orjson"], depends: [], buildHint: "scripts/build-stub-wheels.py" },
  {
    name: "gramps-gen-lib", srcDir: "gramps-wheel", filePrefix: "gramps_gen_lib-",
    imports: ["gramps"], depends: ["gi", "orjson"], buildHint: "scripts/build-gramps-wheel.py",
  },
];

{
  const pyodideDir = path.join(destDir, "pyodide");
  const lockPath = path.join(pyodideDir, "pyodide-lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const registered = [];
  for (const { name, srcDir, filePrefix, imports, depends, buildHint } of LOCAL_PACKAGES) {
    const wheelSrcDir = path.join(repoRoot, "dist", srcDir);
    let files = [];
    try {
      files = (await readdir(wheelSrcDir)).filter((f) => f.startsWith(filePrefix) && f.endsWith(".whl")).sort();
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    const wheelFile = files.at(-1);
    if (!wheelFile) {
      console.log(`copy-wasm: no dist/${srcDir}/${filePrefix}*.whl found -- skipping ${name} (run ${buildHint} to enable it)`);
      continue;
    }
    const buf = await readFile(path.join(wheelSrcDir, wheelFile));
    await writeFile(path.join(pyodideDir, wheelFile), buf);
    lock.packages[name] = {
      name, version: "0", file_name: wheelFile, install_dir: "site",
      sha256: createHash("sha256").update(buf).digest("hex"),
      package_type: "package", imports, depends, unvendored_tests: false,
    };
    registered.push(name);
    console.log(`copy-wasm: copied ${wheelFile} to public/pyodide/`);
  }
  await writeFile(lockPath, JSON.stringify(lock));
  if (registered.length) {
    console.log(`copy-wasm: registered ${registered.join(", ")} in public/pyodide/pyodide-lock.json`);
  }
}
