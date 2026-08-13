import { describe, expect, it } from "vitest";
import { formatHash, isSubjectKey, isVisualKey, parseHash } from "../hash";
import { VIEWS } from "../store/views";

describe("parseHash", () => {
  it("reads a plain view route", () => {
    expect(parseHash("#/place")).toEqual({ viewKey: "place", handle: null, subject: null });
  });

  it("reads a view route's selected handle", () => {
    expect(parseHash("#/place/abc123")).toEqual({ viewKey: "place", handle: "abc123", subject: null });
  });

  it("falls back to the first view for a missing or unknown key", () => {
    for (const hash of ["", "#", "#/", "#/nonsense"]) {
      expect(parseHash(hash).viewKey).toBe(VIEWS[0].key);
    }
  });

  it("reads an unscoped visual route", () => {
    expect(parseHash("#/map")).toEqual({ viewKey: "map", handle: null, subject: null });
  });

  it("reads a visual's subject", () => {
    expect(parseHash("#/map/person:abc123")).toEqual({
      viewKey: "map",
      handle: null,
      subject: { type: "person", handle: "abc123" },
    });
  });

  it("degrades an unusable subject to the whole-tree visual rather than to no page", () => {
    // A type that can't be scoped, a bare handle with no type, an empty
    // handle -- all of them stale/hand-edited URLs that should still land on
    // a working map.
    for (const hash of ["#/map/note:abc123", "#/map/abc123", "#/map/person:", "#/map/:abc123"]) {
      expect(parseHash(hash)).toEqual({ viewKey: "map", handle: null, subject: null });
    }
  });

  it("never puts a selection handle on a visual route", () => {
    // A visual has no table and no selection to restore -- the second
    // segment is only ever a subject there.
    expect(parseHash("#/timeline/abc123").handle).toBeNull();
  });
});

describe("formatHash", () => {
  it("round-trips every route shape through parseHash", () => {
    for (const route of [
      { viewKey: "place", handle: null, subject: null },
      { viewKey: "place", handle: "abc123", subject: null },
      { viewKey: "map", handle: null, subject: null },
      { viewKey: "timeline", handle: null, subject: { type: "person", handle: "abc123" } },
    ]) {
      expect(parseHash(formatHash(route))).toEqual(route);
    }
  });

  it("ignores a subject on a non-visual route", () => {
    // Guards useHistorySync's outward sync, which passes the current subject
    // whenever the active route is a visual and null otherwise -- a leaked
    // subject must not be able to invent a route nothing can parse back.
    expect(formatHash({ viewKey: "place", handle: "abc123", subject: { type: "person", handle: "x" } }))
      .toBe("#/place/abc123");
  });

  it("drops the subject segment when there is no subject", () => {
    expect(formatHash({ viewKey: "map", handle: null, subject: null })).toBe("#/map");
  });
});

describe("key predicates", () => {
  it("recognizes the two visual keys and nothing else", () => {
    expect(isVisualKey("map")).toBe(true);
    expect(isVisualKey("timeline")).toBe(true);
    expect(isVisualKey("place")).toBe(false);
  });

  it("recognizes exactly the four scopable types", () => {
    for (const key of ["person", "family", "event", "place"]) expect(isSubjectKey(key)).toBe(true);
    for (const key of ["note", "media", "tag", "map"]) expect(isSubjectKey(key)).toBe(false);
  });
});
