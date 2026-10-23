// What `npm publish` would ship, checked the way a user meets it: packs
// the tarball, checks its file list, installs it into an empty project,
// parses and converts dates under plain Node (loading a second language on
// demand), and typechecks a consumer against the shipped declarations --
// which is what proves the "exports" map and the types resolve.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

const work = mkdtempSync(join(tmpdir(), "gramps-date-pack-"));
try {
  // Build as `prepack` would, then pack without scripts so the build's own
  // output doesn't land in pack's JSON.
  run(process.execPath, [join(root, "scripts/build.mjs")], root);
  // npm 10 prints an array of packages; npm 12 an object keyed by name.
  const output = JSON.parse(run(npm, ["pack", "--json", "--ignore-scripts", "--pack-destination", work], root));
  const [packed] = Array.isArray(output) ? output : Object.values(output);
  const files = packed.files.map((f) => f.path).sort();
  for (const required of ["LICENSE", "README.md", "package.json", "dist/index.js", "dist/types/index.d.ts", "src/index.ts"]) {
    assert.ok(files.includes(required), `${required} is missing from the package`);
  }
  assert.ok(files.some((f) => /^dist\/chunks\/de\.generated-.*\.js$/.test(f)), "the German chunk is missing");
  for (const file of files) {
    assert.ok(!/^(src\/__tests__|scripts|node_modules)\//.test(file), `${file} shouldn't be in the package`);
  }
  console.log(`package: ${files.length} files, ${(packed.size / 1024).toFixed(0)} KiB packed`);

  const project = join(work, "consumer");
  mkdirSync(project);
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
  run(npm, ["install", "--no-audit", "--no-fund", join(work, packed.filename)], project);

  writeFileSync(join(project, "dates.mjs"), `
    import { formatDate, loadLocale, parseDate, toEdtf } from "@gramps-connect/gramps-date";
    const check = (got, want) => { if (got !== want) throw new Error(\`got \${got}, wanted \${want}\`); };
    check(toEdtf(parseDate("about 3 May 1850")), "1850-05-03~");
    check(formatDate(parseDate("bef 1900")), "before 1900");
    await loadLocale("de");
    check(toEdtf(parseDate("um 1850", { locale: "de" })), "1850~");
    console.log("works under Node, German loaded on demand");
  `);
  console.log(run(process.execPath, ["dates.mjs"], project).trim());

  writeFileSync(join(project, "app.ts"), `
    import { parseDate, toEdtf, type GrampsDate } from "@gramps-connect/gramps-date";
    const date: GrampsDate = parseDate("1850");
    export const edtf: string | undefined = toEdtf(date);
  `);
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2020", module: "ESNext", moduleResolution: "bundler", strict: true,
      noEmit: true, skipLibCheck: false, lib: ["ES2020"], types: [],
    },
    files: ["app.ts"],
  }));
  const tsPackage = createRequire(import.meta.url).resolve("typescript/package.json");
  const tsc = join(dirname(tsPackage), JSON.parse(readFileSync(tsPackage, "utf8")).bin.tsc);
  run(process.execPath, [tsc, "-p", project], project);
  console.log("types resolve");
  console.log("package tests passed");
} finally {
  rmSync(work, { recursive: true, force: true });
}
