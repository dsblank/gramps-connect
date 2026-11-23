import { describe, expect, it } from "vitest";
import type { ObjectDetail } from "../../../store/objectDetail";
import { collectCitations } from "../citationSources";

const name = (first: string, surname: string, citations: string[] = []) => ({
  first_name: first,
  surname_list: [{ surname, primary: true }],
  citation_list: citations,
});

describe("collectCitations", () => {
  it("gathers a person's own citations and those on names, events, links, associations", () => {
    const detail = {
      handle: "P1",
      citation_list: ["C1"],
      primary_name: name("Ann", "Smith", ["C2"]),
      alternate_names: [],
      attribute_list: [{ type: "Nickname", value: "Nan", citation_list: ["C3"] }],
      event_ref_list: [{ ref: "E1", role: "Primary", citation_list: ["C4"] }],
      person_ref_list: [{ ref: "P2", rel: "Godfather", citation_list: ["C5"] }],
      address_list: [{ city: "Boston", citation_list: ["C6"] }],
      lds_ord_list: [{ type: 0, status: 0, citation_list: ["C7"] }],
      media_list: [{ ref: "M1", citation_list: ["C8"] }],
      extended: {
        events: [{ handle: "E1", type: "Birth", citation_list: ["C9", "C1"] }],
        people: [{ handle: "P2", primary_name: name("Bob", "Jones") }],
        media: [{ handle: "M1", desc: "Portrait" }],
      },
    } as unknown as ObjectDetail;

    const result = collectCitations(detail);
    const byHandle = Object.fromEntries(result.map((r) => [r.handle, r]));

    expect(result.map((r) => r.handle).sort()).toEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9"]);
    // C1 is both on the person and on the birth: one entry, both noted.
    expect(byHandle.C1.direct).toBe(true);
    expect(byHandle.C1.via).toEqual([expect.objectContaining({ type: "event", handle: "E1" })]);
    expect(byHandle.C9.direct).toBe(false);
    expect(byHandle.C9.via[0]).toMatchObject({ type: "event", handle: "E1" });
    expect(byHandle.C4.via[0]).toMatchObject({ type: "event", handle: "E1" });
    expect(byHandle.C2.via[0].label).toMatch(/^Name: /);
    expect(byHandle.C3.via[0].label).toBe("Attribute: Nickname");
    expect(byHandle.C5.via[0]).toMatchObject({ type: "person", handle: "P2" });
    expect(byHandle.C5.via[0].label).toContain("(Godfather)");
    expect(byHandle.C6.via[0].label).toBe("Address: Boston");
    expect(byHandle.C7.via[0].label).toBe("LDS: Baptism");
    expect(byHandle.C8.via[0]).toMatchObject({ type: "media", handle: "M1", label: "Media: Portrait" });
  });

  it("includes a family's child links", () => {
    const detail = {
      handle: "F1",
      citation_list: [],
      child_ref_list: [{ ref: "P3", frel: "Birth", mrel: "Birth", citation_list: ["C1"] }],
      extended: { children: [{ handle: "P3", primary_name: name("Cy", "Smith") }] },
    } as unknown as ObjectDetail;
    const [entry] = collectCitations(detail);
    expect(entry).toMatchObject({ handle: "C1", direct: false });
    expect(entry.via[0]).toMatchObject({ type: "person", handle: "P3" });
    expect(entry.via[0].label).toMatch(/^Child: /);
  });

  it("copes with unresolved (null) extended targets and no lists", () => {
    const detail = {
      handle: "P1",
      event_ref_list: [{ ref: "E1", citation_list: ["C1"] }],
      extended: { events: [null] },
    } as unknown as ObjectDetail;
    expect(collectCitations(detail)).toEqual([
      { handle: "C1", direct: false, via: [{ label: "Event", type: "event", handle: "E1" }] },
    ]);
    expect(collectCitations({ handle: "X" } as unknown as ObjectDetail)).toEqual([]);
  });
});
