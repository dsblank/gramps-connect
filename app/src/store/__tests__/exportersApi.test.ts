import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIVING,
  exportQueryParams,
  initialToggleValues,
  togglesFor,
  type ExportOptionState,
} from "../exportersApi";

function state(overrides: Partial<ExportOptionState> = {}): ExportOptionState {
  return {
    toggles: initialToggleValues(),
    living: DEFAULT_LIVING,
    yearsAfterDeath: 0,
    ...overrides,
  };
}

describe("togglesFor", () => {
  it("offers only the universal options to a format with no extras", () => {
    // GEDCOM, vCard, GeneWeb, ... -- nothing format-specific applies.
    expect(togglesFor("ged").map((toggle) => toggle.key)).toEqual(["private", "reference"]);
  });

  it("adds compression for Gramps XML and the include_* set for CSV", () => {
    expect(togglesFor("gramps").map((toggle) => toggle.key)).toContain("compress");
    expect(togglesFor("csv").map((toggle) => toggle.key)).toEqual([
      "private",
      "reference",
      "include_individuals",
      "include_marriages",
      "include_children",
      "include_places",
      "translate_headers",
    ]);
  });
});

describe("exportQueryParams", () => {
  it("sends every applicable arg as a webargs-parseable boolean", () => {
    const params = exportQueryParams("gramps", state());
    expect(params).toEqual({
      living: "IncludeAll",
      private: "false",
      reference: "false",
      compress: "true",
    });
  });

  it("omits args the chosen format doesn't read", () => {
    const params = exportQueryParams("ged", state());
    expect(params.compress).toBeUndefined();
    expect(params.include_children).toBeUndefined();
    expect(params.translate_headers).toBeUndefined();
  });

  it("keeps a format's own extras out of another format's request", () => {
    // The dialog holds one flat map of every toggle across all formats,
    // so a value set while CSV was selected is still in state when the
    // user switches to GEDCOM -- it just must not be sent.
    const toggles = { ...initialToggleValues(), include_children: false };
    expect(exportQueryParams("ged", state({ toggles })).include_children).toBeUndefined();
    expect(exportQueryParams("csv", state({ toggles })).include_children).toBe("false");
  });

  it("sends years_after_death only when living people are restricted", () => {
    expect(exportQueryParams("ged", state({ yearsAfterDeath: 30 })).years_after_death).toBeUndefined();
    const restricted = exportQueryParams(
      "ged",
      state({ living: "ExcludeAll", yearsAfterDeath: 30 })
    );
    expect(restricted).toMatchObject({ living: "ExcludeAll", years_after_death: "30" });
  });

  it("falls back to a toggle's own initial value when state has no entry", () => {
    // e.g. a format whose extras were added after this dialog's state was
    // seeded -- the arg still goes out, at its documented default.
    const params = exportQueryParams("csv", state({ toggles: {} }));
    expect(params.include_individuals).toBe("true");
    expect(params.private).toBe("false");
  });
});
