// Postinstall: sql.js ships its WASM binaries under its own package's
// dist/; initSqlJs's locateFile needs them served as static assets rather
// than bundled, so they're copied into public/ (gitignored -- generated,
// not source, same treatment layer2-local-cache/client/public/ already
// got). Resolved via require.resolve rather than a fixed
// node_modules/sql.js path, since npm workspaces hoist sql.js to the repo
// root's node_modules, not app/node_modules.
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const srcDir = path.dirname(require.resolve("sql.js"));
const destDir = path.join(appDir, "public");

const files = ["sql-wasm.wasm", "sql-wasm-browser.wasm"];

await mkdir(destDir, { recursive: true });
for (const file of files) {
  await copyFile(path.join(srcDir, file), path.join(destDir, file));
}
console.log(`copy-wasm: copied ${files.join(", ")} to ${path.relative(appDir, destDir)}/`);
