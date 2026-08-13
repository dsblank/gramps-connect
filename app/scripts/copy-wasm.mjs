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
// Each source resolved via require.resolve rather than a fixed
// node_modules/<pkg> path, since npm workspaces hoist both to the repo
// root's node_modules, not app/node_modules.
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
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
];

await mkdir(destDir, { recursive: true });
for (const { src, files } of copies) {
  for (const file of files) {
    await copyFile(path.join(src, file), path.join(destDir, file));
  }
  console.log(`copy-wasm: copied ${files.join(", ")} to ${path.relative(appDir, destDir)}/`);
}
