#!/usr/bin/env node
// One-time codemod: wrap plain-text JSX children and a safe allowlist of JSX
// string attributes in t(...), across app/src/**/*.tsx. See ../src/i18n/i18n.ts
// for what that buys for free -- any wrapped string that happens to match the
// bootstrapped static corpus (or the small `desktopStrings` list) becomes
// translated with no further work.
//
// Uses ts-morph (a temporary devDependency) rather than the host repo's own
// `typescript` package: TypeScript 7's main entry point dropped the classic
// createSourceFile()/forEachChild() Compiler API in favor of an async,
// native-Go-backed AST surface under typescript/unstable/* -- not a good fit
// for a quick script. ts-morph bundles its own pinned TypeScript internally.
//
// Deliberately conservative -- only touches:
//  - a JSX element whose *entire* children array is one JsxText node (skips
//    mixed text+expression children, e.g. `{cond ? "a" : "b"} suffix`, where
//    wrapping just one piece is ambiguous)
//  - JSX attributes named label/title/placeholder whose value is a plain
//    string literal (not a template, not already an expression)
// Both only ever match literal `"..."` source text, never `{expression}`
// content, so real data (Gramps IDs, names, dynamic values) is never
// touched. Idempotent: re-running only picks up newly-added plain text.
//
// Left for a follow-up pass, deliberately not attempted here: object-literal
// `{label: "..."}` properties (e.g. Select/SegmentedControl option arrays --
// some of those, like language endonyms, must NOT be translated, so this
// needs per-case judgment), view column configs (store/views.ts),
// notifications.show({title, message}) calls, and searchHelp.ts's
// description fields.
//
// Read-only AST pass: every edit is computed as {start, end, text} against
// the UNMUTATED tree, then applied as plain string splicing at the end.
// (An earlier version called node.replaceWithText() while iterating a node
// array collected before any edits -- ts-morph reparses on each mutation,
// so later node positions in the same file went stale mid-loop and
// corrupted trailing whitespace. Collecting first, mutating never, sidesteps
// that entirely.)
//
// Usage: node scripts/wrap-translations.mjs [--dry-run]

import { Project, SyntaxKind } from "ts-morph";
import { writeFileSync } from "node:fs";
import { relative, dirname, sep, posix } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));
const I18N_MODULE = fileURLToPath(new URL("../src/i18n/i18n", import.meta.url));
const ATTR_ALLOWLIST = new Set(["label", "title", "placeholder"]);
// Elements whose text content is literal syntax a user would type or read
// verbatim (query-language keywords, code, keyboard shortcuts) -- never
// translate these regardless of the single-text-child rule below matching.
const CODE_TAGS = new Set(["Code", "Kbd"]);
const DRY_RUN = process.argv.includes("--dry-run");

function hasLetter(s) {
  return /\p{L}/u.test(s);
}

function importSpecifierFor(filePath) {
  const rel = relative(dirname(filePath), I18N_MODULE).split(sep).join(posix.sep);
  return rel.startsWith(".") ? rel : `./${rel}`;
}

const project = new Project({ skipAddingFilesFromTsConfig: true });
project.addSourceFilesAtPaths(`${SRC_DIR}/**/*.tsx`.replace(/\\/g, "/"));

let totalFiles = 0;
let totalWraps = 0;

for (const sf of project.getSourceFiles()) {
  const filePath = sf.getFilePath();
  if (filePath.includes("/__tests__/")) continue;

  const edits = []; // {start, end, text}
  let wraps = 0;

  for (const el of sf.getDescendantsOfKind(SyntaxKind.JsxElement)) {
    if (CODE_TAGS.has(el.getOpeningElement().getTagNameNode().getText())) continue;
    const children = el.getJsxChildren();
    if (children.length !== 1 || children[0].getKind() !== SyntaxKind.JsxText) continue;
    const textNode = children[0];
    // getStart() excludes leading trivia even for JsxText (unlike getEnd(),
    // which includes trailing) -- use getFullStart()/getFullText() so the
    // captured leading whitespace and the edit range agree, or the restored
    // "leading" piece silently duplicates/misplaces surrounding formatting.
    const raw = textNode.getFullText();
    const normalized = raw.split(/\s+/).filter(Boolean).join(" ");
    if (!normalized || !hasLetter(normalized)) continue;
    const leading = raw.match(/^\s*/)[0];
    const trailing = raw.match(/\s*$/)[0];
    edits.push({
      start: textNode.getFullStart(),
      end: textNode.getEnd(),
      text: `${leading}{t(${JSON.stringify(normalized)})}${trailing}`,
    });
    wraps++;
  }

  for (const attr of sf.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    if (!ATTR_ALLOWLIST.has(attr.getNameNode().getText())) continue;
    const init = attr.getInitializer();
    if (!init || init.getKind() !== SyntaxKind.StringLiteral) continue;
    const value = init.getLiteralText();
    if (!value.trim() || !hasLetter(value)) continue;
    edits.push({ start: init.getStart(), end: init.getEnd(), text: `{t(${JSON.stringify(value)})}` });
    wraps++;
  }

  if (wraps === 0) continue;

  const importPath = importSpecifierFor(filePath);
  const sameModuleImport = sf.getImportDeclaration((d) => d.getModuleSpecifierValue() === importPath);
  if (!sameModuleImport) {
    const lastImport = sf.getImportDeclarations().at(-1);
    const importLine = `import { t } from "${importPath}";`;
    edits.push(
      lastImport
        ? { start: lastImport.getEnd(), end: lastImport.getEnd(), text: `\n${importLine}` }
        : { start: 0, end: 0, text: `${importLine}\n` },
    );
  } else if (!sameModuleImport.getNamedImports().some((ni) => ni.getName() === "t")) {
    const lastNamed = sameModuleImport.getNamedImports().at(-1);
    edits.push(
      lastNamed
        ? { start: lastNamed.getEnd(), end: lastNamed.getEnd(), text: `, t` }
        : { start: sameModuleImport.getStart(), end: sameModuleImport.getEnd(), text: `import { t } from "${importPath}";` },
    );
  }

  edits.sort((a, b) => b.start - a.start);
  let out = sf.getFullText();
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);

  if (!DRY_RUN) writeFileSync(filePath, out, "utf8");
  totalFiles++;
  totalWraps += wraps;
  console.log(`  ${relative(SRC_DIR, filePath)}: ${wraps} string(s) wrapped`);
}

console.log(`${DRY_RUN ? "[dry run] " : ""}${totalWraps} string(s) wrapped across ${totalFiles} file(s)`);
