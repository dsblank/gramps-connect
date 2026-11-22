// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../testUtils/renderWithProviders";
import { GrampletResultView } from "../GrampletResultView";
import { DEFAULT_DISPLAY_SETTINGS, type DisplaySettings } from "../../store/displaySettings";

// Records the fake server selects from: a select entry is a field name
// here (or "repositories[0].name"), read straight off the record.
const RECORDS: Record<string, Record<string, Record<string, unknown>>> = {
  citations: {
    C1: { page: "p. 1", confidence: 2, attribute_list: [], source_handle: "S1" },
    C2: { page: "p. 2", confidence: 4, attribute_list: [], source_handle: "S1" },
    C3: {
      page: "",
      confidence: 2,
      attribute_list: [{ type: { string: "Citation text", value: 0 }, value: "Manual cite, as written" }],
      source_handle: "S2",
    },
    C4: { page: "p. 9", confidence: 2, attribute_list: [], source_handle: "S3" },
  },
  sources: {
    S1: { title: "Parish Register", author: "", pubinfo: "", abbrev: "", attribute_list: [], reporef_list: [] },
    S2: { title: "Elsewhere", author: "", pubinfo: "", abbrev: "", attribute_list: [], reporef_list: [] },
    S3: {
      title: "Census",
      author: "",
      pubinfo: "",
      abbrev: "",
      attribute_list: [{ type: { string: "Citation template", value: 0 }, value: "mine" }],
      reporef_list: [],
    },
  },
};

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("../../store/apiFetch", () => ({ apiFetch }));
vi.mock("../../auth/auth", () => ({ getToken: async () => "token", hasPermissions: () => false }));
apiFetch.mockImplementation(async (url: string, init: { body: string }) => {
  const table = url.includes("/sources/") ? "sources" : "citations";
  const body = JSON.parse(init.body) as { select: string[]; where_expr: string };
  const handles = [...body.where_expr.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const items = handles
    .filter((h) => RECORDS[table][h])
    .map((h) =>
      Object.fromEntries(
        body.select.map((entry) => {
          if (entry === "handle") return ["handle", h];
          const [expr, alias] = entry.split(" as ");
          return [alias, RECORDS[table][h][expr] ?? null];
        }),
      ),
    );
  return new Response(JSON.stringify({ items }), { status: 200 });
});

const SETTINGS: DisplaySettings = {
  ...DEFAULT_DISPLAY_SETTINGS,
  citation: {
    formatter: "legacy",
    templates: [{ id: "tpl-mine", name: "Mine", source: "*`title`*", citation: "`page`" }],
  },
};
vi.mock("../../store/displaySettings", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../store/displaySettings")>();
  return { ...real, useDisplaySettings: () => SETTINGS };
});

describe("bibliography block", () => {
  it("numbers sources, letters their citations, and writes each in its own format", async () => {
    renderWithProviders(
      <GrampletResultView
        status="done"
        response={{
          type: "blocks",
          runId: "b",
          blocks: [{ type: "bibliography", handles: ["C1", "C3", "C2", "C4", "gone"], title: "Sources" }],
        }}
      />,
    );
    // Legacy, the tree's format: the source once, its two citations under it.
    expect(await screen.findByText('"Parish Register"')).toBeTruthy();
    expect(screen.getByText("p. 1")).toBeTruthy();
    expect(screen.getByText("p. 2 [Very High]")).toBeTruthy();
    // Manual text is an entry of its own, as written.
    expect(screen.getByText("Manual cite, as written")).toBeTruthy();
    // S3 names the tree's "Mine" template (any capitals): italic title.
    const census = screen.getByText("Census");
    expect(census.style.fontStyle).toBe("italic");
    expect(screen.getByText("p. 9")).toBeTruthy();
    // Numbered in first-seen order; the unknown handle is skipped.
    expect(screen.getByText("1.")).toBeTruthy();
    expect(screen.getByText("2.")).toBeTruthy();
    expect(screen.getByText("3.")).toBeTruthy();
    expect(screen.queryByText("4.")).toBeNull();
    expect(screen.getByText("Sources")).toBeTruthy();
  });

  it("says so when nothing is left to list", async () => {
    renderWithProviders(
      <GrampletResultView status="done" response={{ type: "blocks", runId: "e", blocks: [{ type: "bibliography", handles: ["gone"], title: null }] }} />,
    );
    expect(await screen.findByText("No citations to list.")).toBeTruthy();
  });
});
