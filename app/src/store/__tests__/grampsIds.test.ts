import { beforeEach, describe, expect, it, vi } from "vitest";

const cachedIds: Record<string, string[]> = {};
const onServer = new Set<string>();
let templates: Record<string, string> = {};

vi.mock("../registry", () => ({
  getViewStore: (type: string) => ({
    view: { key: type, orderBy: [] },
    ensureLoaded: async () => {},
    readColumns: () => (cachedIds[type] ?? []).map((id) => [id]),
  }),
}));
vi.mock("../api", () => ({
  fetchPage: vi.fn(async (_view: unknown, _token: string, _after: unknown, _count: boolean, where: string) => {
    const id = JSON.parse(where.replace(/^gramps_id == /, ""));
    return { page: { items: [] }, totalCount: onServer.has(id) ? 1 : 0 };
  }),
}));
vi.mock("../displaySettings", () => ({ getDisplaySettings: () => ({ ids: templates }) }));

const { assignGrampsIds, formatGrampsId, highestNumber, parseGrampsIdNumber } = await import("../grampsIds");

beforeEach(() => {
  for (const key of Object.keys(cachedIds)) delete cachedIds[key];
  onServer.clear();
  templates = {};
});

describe("template formatting", () => {
  it("formats like Python %", () => {
    expect(formatGrampsId("I%04d", 42)).toBe("I0042");
    expect(formatGrampsId("I%04d", 12345)).toBe("I12345");
    expect(formatGrampsId("P%d", 7)).toBe("P7");
    expect(formatGrampsId("ID-%03d-x", 5)).toBe("ID-005-x");
  });

  it("reads numbers back, only for matching IDs", () => {
    expect(parseGrampsIdNumber("I%04d", "I0042")).toBe(42);
    expect(parseGrampsIdNumber("I%04d", "I12345")).toBe(12345);
    expect(parseGrampsIdNumber("I%04d", "F0042")).toBeNull();
    expect(parseGrampsIdNumber("ID-%03d-x", "ID-005-x")).toBe(5);
    expect(parseGrampsIdNumber("I.%d", "Ix5")).toBeNull();
    expect(highestNumber("I%04d", ["I0001", "I0100", "X9999", null, "I0099"])).toBe(100);
  });
});

describe("assignGrampsIds", () => {
  it("numbers after the highest cached ID, within a batch too", async () => {
    templates = { person: "I%04d", event: "E%04d" };
    cachedIds.person = ["I0001", "I0007"];
    const { objects, assigned } = await assignGrampsIds("t", [
      { _class: "Person", handle: "a" },
      { _class: "Person", handle: "b", gramps_id: "" },
      { _class: "Event", handle: "c" },
      { _class: "Person", handle: "d", gramps_id: "MINE" },
      { _class: "Family", handle: "e" },
    ]);
    expect(objects.map((o) => o.gramps_id)).toEqual(["I0008", "I0009", "E0000", "MINE", undefined]);
    expect(assigned).toBe(3);
  });

  it("skips IDs the server already has (partial cache)", async () => {
    templates = { note: "N%04d" };
    cachedIds.note = ["N0003"];
    onServer.add("N0004").add("N0005");
    const { objects } = await assignGrampsIds("t", [{ _class: "Note", handle: "a" }]);
    expect(objects[0].gramps_id).toBe("N0006");
  });

  it("leaves everything alone with no templates", async () => {
    const input = [{ _class: "Person", handle: "a" }];
    const { objects, assigned } = await assignGrampsIds("t", input);
    expect(objects).toEqual(input);
    expect(assigned).toBe(0);
  });
});
