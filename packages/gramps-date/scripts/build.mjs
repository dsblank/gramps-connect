// Builds what npm users get, into dist/:
//
//   index.js        the package, ES module, with each language other than
//                   English in its own chunk (chunks/), loaded on demand
//                   by loadLocale()
//   types/          TypeScript declarations
//
// Gramps Connect doesn't use dist/: it compiles src/ directly (the
// "source" export condition).
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");

rmSync(dist, { recursive: true, force: true });

await build({
  absWorkingDir: root,
  entryPoints: { index: "src/index.ts" },
  outdir: dist,
  bundle: true,
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  format: "esm",
  target: "es2020",
  // No source maps: the TypeScript source ships alongside (src/), and maps
  // of 43 languages' tables would double the package.
  logLevel: "warning",
});

// Through TypeScript's own `tsc` bin entry: its package.json doesn't export
// the script's path as a module.
const tsPackage = createRequire(import.meta.url).resolve("typescript/package.json");
const tscBin = JSON.parse(readFileSync(tsPackage, "utf8")).bin.tsc;
execFileSync(process.execPath, [join(dirname(tsPackage), tscBin), "-p", join(root, "tsconfig.build.json")], { stdio: "inherit" });

console.log("built dist/");
