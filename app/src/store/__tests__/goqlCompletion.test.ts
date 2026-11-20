import { describe, expect, it } from "vitest";
import { commonPrefix, completeGoql, goqlNamespaceForEndpoint } from "../goqlCompletion";
import { VIEWS } from "../views";
import cases from "./goqlCompletionCases.json";

interface Case {
  namespace: string;
  source: string;
  cursor?: number;
  env?: string[];
  expect?: string[];
  contains?: string[];
  excludes?: string[];
  kind?: Record<string, string>;
  start?: number;
}

// GOQL's own completion_cases.json (copied by
// scripts/export-goql-vocabulary.py): the Python completer passes these
// same cases, so a failure here means the port has drifted from it.
describe("GOQL shared completion cases", () => {
  for (const c of cases.cases as Case[]) {
    it(`${c.namespace}: ${JSON.stringify(c.source)}`, () => {
      const results = completeGoql(c.namespace, c.source, c.cursor ?? c.source.length, c.env ?? []);
      const names = results.map((r) => r.name);
      if (c.expect) expect(names).toEqual(c.expect);
      for (const name of c.contains ?? []) expect(names).toContain(name);
      for (const name of c.excludes ?? []) expect(names).not.toContain(name);
      const kinds = Object.fromEntries(results.map((r) => [r.name, r.kind]));
      for (const [name, kind] of Object.entries(c.kind ?? {})) expect(kinds[name]).toBe(kind);
      if (c.start !== undefined) for (const r of results) expect(r.start).toBe(c.start);
    });
  }
});

describe("goqlCompletion helpers", () => {
  it("maps every searchable view's endpoint to a GOQL type", () => {
    for (const view of VIEWS) {
      expect(goqlNamespaceForEndpoint(view.endpoint), view.key).toBeDefined();
    }
  });

  it("common prefix", () => {
    expect(commonPrefix(["birth", "birth_ref_index"])).toBe("birth");
    expect(commonPrefix(["MOD_ABOUT", "MOD_AFTER"])).toBe("MOD_A");
    expect(commonPrefix([])).toBe("");
  });

  it("unknown type completes nothing", () => {
    expect(completeGoql("Nosuch", "bi", 2)).toEqual([]);
  });
});
