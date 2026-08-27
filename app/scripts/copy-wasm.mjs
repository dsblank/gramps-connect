// Postinstall: a couple of dependencies ship runtime files that need to be
// served as static assets at a stable path rather than bundled, so both are
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
//   gramps wheel (PoC, see pyodideWorker.ts): best-effort only, see the
//   separate block below -- unlike the above, not an npm dependency.
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
];

for (const { src, files, destSubdir } of copies) {
  const dest = destSubdir ? path.join(destDir, destSubdir) : destDir;
  await mkdir(dest, { recursive: true });
  for (const file of files) {
    await copyFile(path.join(src, file), path.join(dest, file));
  }
  console.log(`copy-wasm: copied ${files.join(", ")} to ${path.relative(appDir, dest)}/`);
}

// micropip -- see the doc comment above. Version pin comes from the
// "pyodide" npm package's own version (the CDN path segment pyodide's own
// loader uses, e.g. v314.0.6), not the lock file (which has no such field
// -- it only names packages, not the pyodide release they belong to).
{
  const pyodideDir = path.join(destDir, "pyodide");
  const lock = JSON.parse(await readFile(path.join(pyodideDir, "pyodide-lock.json"), "utf8"));
  const micropip = lock.packages.micropip;
  const dest = path.join(pyodideDir, micropip.file_name);
  const alreadyValid = await readFile(dest).then(
    (buf) => createHash("sha256").update(buf).digest("hex") === micropip.sha256,
    () => false
  );
  if (alreadyValid) {
    console.log(`copy-wasm: ${micropip.file_name} already present in public/pyodide/`);
  } else {
    const pyodideVersion = require("pyodide/package.json").version;
    const url = `https://cdn.jsdelivr.net/pyodide/v${pyodideVersion}/full/${micropip.file_name}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const sha256 = createHash("sha256").update(buf).digest("hex");
      if (sha256 !== micropip.sha256) {
        throw new Error(`sha256 mismatch: expected ${micropip.sha256}, got ${sha256}`);
      }
      await writeFile(dest, buf);
      console.log(`copy-wasm: fetched ${micropip.file_name} from jsdelivr to public/pyodide/`);
    } catch (err) {
      console.warn(
        `copy-wasm: could not pre-fetch ${micropip.file_name} (${err.message}) -- ` +
          "pyodideWorker.ts will fall back to fetching it from jsdelivr.net at runtime instead"
      );
    }
  }
}

// Minimal gramps wheel (PoC, see pyodideWorker.ts): unlike everything
// above, this isn't an npm dependency -- it's built by
// scripts/build-gramps-wheel.py (a Python script, needs a working gramps
// install) into <repo root>/dist/gramps-wheel/*.whl, so most contributors
// won't have it. Best-effort only: silently skipped if that directory or
// a .whl in it doesn't exist, rather than failing `npm install` for
// everyone else. manifest.json records the exact filename (it's
// version-stamped, e.g. gramps_gen_lib-6.0.8-py3-none-any.whl) so
// pyodideWorker.ts doesn't need to hardcode a version that'll go stale.
const wheelSrcDir = path.join(repoRoot, "dist", "gramps-wheel");
try {
  const wheelFiles = (await readdir(wheelSrcDir)).filter((f) => f.endsWith(".whl")).sort();
  const wheelFile = wheelFiles.at(-1);
  if (wheelFile) {
    const wheelDest = path.join(destDir, "gramps-wheel");
    await mkdir(wheelDest, { recursive: true });
    await copyFile(path.join(wheelSrcDir, wheelFile), path.join(wheelDest, wheelFile));
    await writeFile(path.join(wheelDest, "manifest.json"), JSON.stringify({ wheel: wheelFile }));
    console.log(`copy-wasm: copied ${wheelFile} to public/gramps-wheel/`);
  }
} catch (err) {
  if (err.code !== "ENOENT") throw err;
  console.log("copy-wasm: no dist/gramps-wheel/*.whl found -- skipping (run scripts/build-gramps-wheel.py to enable real gramps objects in Gramplets)");
}
