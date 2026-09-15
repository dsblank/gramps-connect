// Exports gqlFilterPresets.ts's own `gqlFilterPresets` array to plain JSON,
// so the Python test suite at ../../tests/gql_presets/ (which verifies
// every built-in preset's semantics against real gramps-core Rule classes
// -- see that directory's own README) has a single source of truth to read
// rather than a hand-duplicated copy that could silently drift from the
// TS file this app actually ships.
//
// Not part of the app build (see package.json's own "build"/"postinstall")
// -- this only ever matters to that Python test suite, which runs it itself
// (via tests/gql_presets/conftest.py) whenever the JSON is missing or
// older than the source file, so `pytest tests/` alone is still the only
// command anyone needs to run. Run by hand only when debugging the export
// itself:
//
//   node app/scripts/export-gql-presets.mjs
//
// `gqlFilterPresets.ts` has no imports of its own (confirmed: it's plain
// data -- type aliases/interfaces and one literal array), so a bundle-free
// esbuild transform plus a data: URL import is enough to load it in plain
// Node with no project build step, no vitest, no ts-node/tsx dependency.
import esbuild from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(appDir);
const srcPath = path.join(appDir, "src/data/gqlFilterPresets.ts");
const outDir = path.join(repoRoot, "tests/gql_presets");
const outPath = path.join(outDir, "gql_presets.generated.json");

const result = await esbuild.build({
  entryPoints: [srcPath],
  bundle: false,
  write: false,
  format: "esm",
  platform: "node",
});
const code = result.outputFiles[0].text;
const mod = await import(`data:text/javascript,${encodeURIComponent(code)}`);

if (!Array.isArray(mod.gqlFilterPresets) || mod.gqlFilterPresets.length === 0) {
  throw new Error("gqlFilterPresets.ts's own gqlFilterPresets export is missing or empty");
}

await mkdir(outDir, { recursive: true });
await writeFile(outPath, JSON.stringify(mod.gqlFilterPresets, null, 2) + "\n");
console.log(`export-gql-presets: wrote ${mod.gqlFilterPresets.length} entries to ${path.relative(repoRoot, outPath)}`);
