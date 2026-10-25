import { describe, expect, it } from "vitest";
import { diffObjects, formatDiffValue, summarizeDiffPaths } from "../historyDiff";

describe("diffObjects", () => {
  it("returns [] for identical objects", () => {
    expect(diffObjects({ a: 1, b: "x" }, { a: 1, b: "x" })).toEqual([]);
  });

  it("reports a changed top-level field", () => {
    expect(diffObjects({ gramps_id: "I001", first_name: "Jon" }, { gramps_id: "I001", first_name: "John" })).toEqual([
      { path: "first_name", before: "Jon", after: "John" },
    ]);
  });

  it("reports a changed nested field by dotted path", () => {
    expect(
      diffObjects(
        { primary_name: { first_name: "Jon", surname_list: [{ surname: "Doe" }] } },
        { primary_name: { first_name: "John", surname_list: [{ surname: "Doe" }] } }
      )
    ).toEqual([{ path: "primary_name.first_name", before: "Jon", after: "John" }]);
  });

  it("reports a changed array element with a bracketed index, GOQL-style", () => {
    expect(
      diffObjects({ event_ref_list: [{ ref: "E001" }, { ref: "E002" }] }, { event_ref_list: [{ ref: "E001" }, { ref: "E003" }] })
    ).toEqual([{ path: "event_ref_list[1].ref", before: "E002", after: "E003" }]);
  });

  it("treats a null before as a create -- every leaf shows as added", () => {
    expect(diffObjects(null, { gramps_id: "I001", first_name: "Jon" })).toEqual(
      expect.arrayContaining([
        { path: "gramps_id", before: undefined, after: "I001" },
        { path: "first_name", before: undefined, after: "Jon" },
      ])
    );
  });

  it("treats a null after as a delete -- every leaf shows as removed", () => {
    expect(diffObjects({ gramps_id: "I001", first_name: "Jon" }, null)).toEqual(
      expect.arrayContaining([
        { path: "gramps_id", before: "I001", after: undefined },
        { path: "first_name", before: "Jon", after: undefined },
      ])
    );
  });

  it("ignores bookkeeping fields (change/handle/_class)", () => {
    expect(
      diffObjects(
        { _class: "Person", handle: "H1", change: 100, first_name: "Jon" },
        { _class: "Person", handle: "H1", change: 200, first_name: "John" }
      )
    ).toEqual([{ path: "first_name", before: "Jon", after: "John" }]);
  });
});

describe("summarizeDiffPaths", () => {
  function row(path: string): { path: string; before: unknown; after: unknown } {
    return { path, before: "a", after: "b" };
  }

  it("returns '' for no changes", () => {
    expect(summarizeDiffPaths([])).toBe("");
  });

  it("returns the bare path for a single change", () => {
    expect(summarizeDiffPaths([row("primary_name.surname_list[0].surname")])).toBe(
      "primary_name.surname_list[0].surname"
    );
  });

  it("joins up to maxPaths paths with no '+N more' suffix when there's nothing left over", () => {
    expect(summarizeDiffPaths([row("a"), row("b")])).toBe("a, b");
  });

  it("appends a '+N more' count once there are more than maxPaths changes", () => {
    expect(summarizeDiffPaths([row("a"), row("b"), row("c")])).toBe("a, b +1 more");
  });

  it("honors a custom maxPaths", () => {
    expect(summarizeDiffPaths([row("a"), row("b"), row("c")], 1)).toBe("a +2 more");
  });
});

describe("formatDiffValue", () => {
  const opts = {
    formatDate: (date: Record<string, unknown>) => (date.sortval ? `date ${date.sortval}` : ""),
    translate: (label: string) => `[${label}]`,
  };

  it("shows an added web link by its fields, not as JSON", () => {
    // As stored: a type typed into the form is kept as its string, one
    // left empty is saved as Unknown (-1), which says nothing.
    const url = {
      path: "https://en.wikipedia.org/wiki/George_VI",
      desc: "Wikipedia",
      private: false,
      type: { _class: "UrlType", value: -1, string: "" },
      _class: "Url",
    };
    expect(formatDiffValue(url, opts)).toBe("path: https://en.wikipedia.org/wiki/George_VI, desc: Wikipedia");
    expect(formatDiffValue({ ...url, type: { _class: "UrlType", value: 2, string: "" } }, opts)).toBe(
      "path: https://en.wikipedia.org/wiki/George_VI, desc: Wikipedia, type: [Web Home]"
    );
  });

  it("names types, skips empty fields and marks private items", () => {
    const eventRef = {
      attribute_list: [],
      citation_list: [],
      note_list: [],
      private: true,
      ref: "E1",
      role: { _class: "EventRoleType", value: 1, string: "" },
      _class: "EventRef",
    };
    expect(formatDiffValue(eventRef, opts)).toBe("ref: E1, role: [Primary], [Private]");
    const attribute = { type: { _class: "AttributeType", value: 0, string: "RIN" }, value: "MH:I3042", _class: "Attribute" };
    expect(formatDiffValue(attribute, opts)).toBe("type: RIN, value: MH:I3042");
    expect(formatDiffValue({ _class: "FooType", value: 7, string: "" }, opts)).toBe("7");
  });

  it("shows dates and styled text as text, nested lists joined", () => {
    const address = {
      date: { _class: "Date", sortval: 2434531, text: "" },
      street: "",
      city: "London",
      _class: "Address",
    };
    expect(formatDiffValue(address, opts)).toBe("date: date 2434531, city: London");
    expect(formatDiffValue({ _class: "StyledText", string: "Hello", tags: [] }, opts)).toBe("Hello");
    expect(formatDiffValue([{ city: "A" }, { city: "B" }], opts)).toBe("city: A; city: B");
  });

  it("keeps plain values, and marks missing and empty ones", () => {
    expect(formatDiffValue("John", opts)).toBe("John");
    expect(formatDiffValue(3, opts)).toBe("3");
    expect(formatDiffValue(false, opts)).toBe("false");
    expect(formatDiffValue(undefined, opts)).toBe("—");
    expect(formatDiffValue(null, opts)).toBe("[(none)]");
    expect(formatDiffValue({ _class: "Date", sortval: 0, text: "" }, opts)).toBe("[(none)]");
  });
});
