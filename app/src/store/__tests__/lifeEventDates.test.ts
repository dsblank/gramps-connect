import { beforeEach, describe, expect, it, vi } from "vitest";
import { DateFormat, parseDate } from "@gramps-connect/gramps-date";

// event handle -> [date JSON, type JSON, place handle]
const events = new Map<string, [string | null, string | null, string | null]>();
let loadedCount = 1;
const ensureLoaded = vi.fn(async () => {});

vi.mock("../registry", () => ({
  getViewStore: () => ({
    getSnapshot: () => ({ loadedCount }),
    ensureLoaded,
    readRowByHandle: (handle: string) => events.get(handle) ?? null,
  }),
}));
vi.mock("../placeIndex", async () => {
  const { formatDate } = await import("@gramps-connect/gramps-date");
  return {
    formatDisplayDate: (date: any) => (date ? formatDate(date, { format: DateFormat.ISO }) : ""),
    displayPlaceTitle: (handle: string) => `place:${handle}`,
  };
});

const { lifeEventDate, lifeEventPlace } = await import("../lifeEventDates");

function addEvent(handle: string, date: string, type: number, place: string | null = null) {
  events.set(handle, [JSON.stringify(parseDate(date)), JSON.stringify({ string: "", value: type }), place]);
}
const ref = (handle: string, role = 1) => ({ ref: handle, role: { value: role } });
const profile = { birth: { date: "server birth", place: "server place" }, death: { date: "server death" } };

beforeEach(() => {
  events.clear();
  loadedCount = 1;
  ensureLoaded.mockClear();
});

describe("lifeEventDate", () => {
  it("formats the birth event locally", () => {
    addEvent("b", "1854-03-12", 12, "p1");
    const person = { event_ref_list: [ref("b")], birth_ref_index: 0, death_ref_index: -1, profile };
    expect(lifeEventDate(person, "birth")).toBe("1854-03-12");
    expect(lifeEventPlace(person, "birth")).toBe("place:p1");
    expect(lifeEventDate(person, "death")).toBe("");
  });

  it("falls back to a primary baptism, like get_birth_or_fallback", () => {
    addEvent("x", "1800", 13);
    addEvent("bap", "1854-04-01", 15);
    const person = { event_ref_list: [ref("x"), ref("bap")], birth_ref_index: -1, profile };
    expect(lifeEventDate(person, "birth")).toBe("1854-04-01");
    // Not the primary participant -> no fallback.
    const witness = { event_ref_list: [ref("bap", 2)], birth_ref_index: -1, profile };
    expect(lifeEventDate(witness, "birth")).toBe("");
  });

  it("uses the server's text when the events cache can't answer", () => {
    const person = { event_ref_list: [ref("missing")], birth_ref_index: 0, profile };
    expect(lifeEventDate(person, "birth")).toBe("server birth");
    loadedCount = 0;
    addEvent("b", "1854", 12);
    expect(lifeEventDate({ ...person, event_ref_list: [ref("b")] }, "birth")).toBe("server birth");
    expect(ensureLoaded).toHaveBeenCalled();
    // event_ref_list not fetched at all
    expect(lifeEventDate({ profile }, "death")).toBe("server death");
  });

  it("picks a family's marriage, else an engagement", () => {
    addEvent("eng", "1850", 6);
    addEvent("mar", "1851", 1);
    expect(lifeEventDate({ event_ref_list: [ref("eng", 8), ref("mar", 8)] }, "marriage")).toBe("1851");
    expect(lifeEventDate({ event_ref_list: [ref("eng", 8)] }, "marriage")).toBe("1850");
  });
});
