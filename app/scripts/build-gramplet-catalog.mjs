// Aggregates gramplet-store/<slug>/{manifest.json,code.py,icon.*} (one
// folder per published Gramplet -- see that directory's own README) into a
// single gramplet-store/catalog.json: a plain JSON array of CatalogEntry
// objects (app/src/pyodidePoc/types.ts), each manifest's fields plus its
// code inlined and, if present, an iconUrl pointing at gramplet-store/
// icons/<id>.<ext>.
//
// NOT part of `npm install`/the app build (see package.json's own
// "postinstall", which is copy-wasm.mjs, not this) -- gramplet-store/ ships
// independently of the app itself, published as static files (GitHub
// Pages) and fetched by the running app over plain fetch() at runtime, so
// there's nothing here for Vite to bundle. Run by hand (or a small CI step
// on push to gramplet-store/**) after adding/editing an entry:
//
//   node app/scripts/build-gramplet-catalog.mjs
//
// Fails loudly (throws, non-zero exit) on a malformed entry rather than
// skipping it -- unlike grampletMedia.ts's fetchGramplets(), which skips a
// bad *tree* manifest so one bad row doesn't sink a live user's whole
// panel, this only ever runs at author/publish time, where surfacing a
// mistake immediately is more useful than silently publishing a broken
// catalog entry.
import esbuild from "esbuild";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(appDir);
const storeDir = path.join(repoRoot, "gramplet-store");
const iconsDir = path.join(storeDir, "icons");

// The app's own validator for the window-Gramplet fields (kind/
// category), so a Store entry and a tree manifest are held to the same
// rules. grampletManifest.ts has no runtime imports, so a bundle-free
// esbuild transform plus a data: URL import loads it in plain Node -- the
// same trick export-gql-presets.mjs uses.
const { validateGrampletKindFields } = await (async () => {
  const result = await esbuild.build({
    entryPoints: [path.join(appDir, "src/pyodidePoc/grampletManifest.ts")],
    bundle: false,
    write: false,
    format: "esm",
    platform: "node",
  });
  return import(`data:text/javascript,${encodeURIComponent(result.outputFiles[0].text)}`);
})();

const REQUIRED_MANIFEST_FIELDS = ["id", "name", "description", "version", "author", "category"];
const ICON_EXTENSIONS = ["png", "jpg", "jpeg", "svg", "webp"];

async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function loadEntry(slug) {
  const entryDir = path.join(storeDir, slug);
  const manifestPath = path.join(entryDir, "manifest.json");
  const codePath = path.join(entryDir, "code.py");

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (err) {
    throw new Error(`gramplet-store/${slug}/manifest.json: ${err.message}`);
  }

  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (typeof manifest[field] !== "string" || manifest[field].trim() === "") {
      throw new Error(`gramplet-store/${slug}/manifest.json: missing or empty required field "${field}"`);
    }
  }
  if (manifest.id !== slug) {
    throw new Error(`gramplet-store/${slug}/manifest.json: id "${manifest.id}" must match its folder name "${slug}"`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error(`gramplet-store/${slug}/manifest.json: version "${manifest.version}" isn't a plain semver string (e.g. "1.0.0")`);
  }
  if (manifest.views !== undefined && (!Array.isArray(manifest.views) || !manifest.views.every((v) => typeof v === "string"))) {
    throw new Error(`gramplet-store/${slug}/manifest.json: "views", if present, must be an array of strings`);
  }
  const kindFieldsError = validateGrampletKindFields(manifest);
  if (kindFieldsError) {
    throw new Error(`gramplet-store/${slug}/manifest.json: ${kindFieldsError}`);
  }

  let code;
  try {
    code = await readFile(codePath, "utf8");
  } catch (err) {
    throw new Error(`gramplet-store/${slug}/code.py: ${err.message}`);
  }
  if (code.trim() === "") {
    throw new Error(`gramplet-store/${slug}/code.py: empty`);
  }

  let iconUrl;
  for (const ext of ICON_EXTENSIONS) {
    const iconPath = path.join(entryDir, `icon.${ext}`);
    if (await fileExists(iconPath)) {
      await mkdir(iconsDir, { recursive: true });
      const destName = `${slug}.${ext}`;
      await copyFile(iconPath, path.join(iconsDir, destName));
      iconUrl = `icons/${destName}`;
      break;
    }
  }

  const { id, name, description, version, author, category, views, listensToSelection, listensToFilter, kind } = manifest;
  return { id, name, description, version, author, category, views, listensToSelection, listensToFilter, kind, iconUrl, code };
}

const slugs = (await readdir(storeDir, { withFileTypes: true }))
  .filter((d) => d.isDirectory() && d.name !== "icons")
  .map((d) => d.name)
  .sort();

if (slugs.length === 0) {
  throw new Error(`gramplet-store/ has no entries (looked in ${storeDir})`);
}

const entries = [];
const seenIds = new Set();
for (const slug of slugs) {
  const entry = await loadEntry(slug);
  if (seenIds.has(entry.id)) {
    throw new Error(`duplicate Gramplet id "${entry.id}"`);
  }
  seenIds.add(entry.id);
  entries.push(entry);
}

// Alphabetical by name -- the order a browsing UI would show by default;
// re-sorted client-side for any other ordering (category, author, ...).
entries.sort((a, b) => a.name.localeCompare(b.name));

const catalogPath = path.join(storeDir, "catalog.json");
await writeFile(catalogPath, JSON.stringify(entries, null, 2) + "\n");
console.log(`build-gramplet-catalog: wrote ${entries.length} entries to ${path.relative(repoRoot, catalogPath)}`);
