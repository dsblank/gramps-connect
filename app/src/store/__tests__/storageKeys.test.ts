import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allKeyDefs, isSettingKey, STORAGE_KEYS } from "../storageKeys";

const SRC = fileURLToPath(new URL("../..", import.meta.url));

// Files allowed to spell out key names: the registry itself, the one-time
// migration (old names), and windowHandoff.ts's postMessage types (not
// storage keys).
const ALLOWED = new Set(["store/storageKeys.ts", "store/storageMigration.ts", "auth/windowHandoff.ts"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("storage keys", () => {
  it("are only spelled out in storageKeys.ts", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles(SRC)) {
      const rel = relative(SRC, path).split("\\").join("/");
      if (ALLOWED.has(rel)) continue;
      const text = readFileSync(path, "utf8");
      if (/["'`]gramps-connect[:._][A-Za-z]/.test(text) || text.includes("mantine-color-scheme-value")) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("all follow gramps-connect:<camelCase>", () => {
    for (const def of allKeyDefs()) {
      expect(def.key).toMatch(def.prefix ? /^gramps-connect:[a-z][A-Za-z]*:$/ : /^gramps-connect:[a-z][A-Za-z]*$/);
    }
  });

  it("tags settings and exclusions", () => {
    expect(isSettingKey(STORAGE_KEYS.columnWidths)).toBe(true);
    expect(isSettingKey("gramps-connect:blogDraft:tree:alice")).toBe(true);
    expect(isSettingKey("gramps-connect:blogDraft:")).toBe(false);
    expect(isSettingKey(STORAGE_KEYS.visited)).toBe(false);
    expect(isSettingKey(STORAGE_KEYS.token)).toBe(false);
    expect(isSettingKey("other-site")).toBe(false);
  });
});
