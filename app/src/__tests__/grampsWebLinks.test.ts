// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { captureGrampsWebLink, parseGrampsWebPath } from "../grampsWebLinks";
import { STORAGE_KEYS } from "../store/storageKeys";

describe("parseGrampsWebPath", () => {
  it("reads each Gramps Web record path", () => {
    expect(parseGrampsWebPath("/media/O0123")).toEqual({ base: "/", viewKey: "media", grampsId: "O0123" });
    expect(parseGrampsWebPath("/person/I0044/")).toEqual({ base: "/", viewKey: "person", grampsId: "I0044" });
    for (const type of ["family", "event", "place", "source", "citation", "repository", "note"]) {
      expect(parseGrampsWebPath(`/${type}/X1`)?.viewKey).toBe(type);
    }
  });

  it("keeps a sub-path the app is served under", () => {
    expect(parseGrampsWebPath("/gramps/media/O0123")).toEqual({ base: "/gramps/", viewKey: "media", grampsId: "O0123" });
  });

  it("decodes the ID", () => {
    expect(parseGrampsWebPath("/note/N%2001")?.grampsId).toBe("N 01");
  });

  it("ignores other paths", () => {
    for (const path of ["/", "/index.html", "/media", "/media/", "/people/I0044", "/media/O1/extra", "/assets/x.js"]) {
      expect(parseGrampsWebPath(path)).toBeNull();
    }
  });
});

describe("captureGrampsWebLink", () => {
  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("remembers the record and moves the address to the app root", () => {
    window.history.replaceState(null, "", "/media/O0123?x=1");
    captureGrampsWebLink();
    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("?x=1");
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEYS.pendingGrampsWebLink)!)).toEqual({
      base: "/",
      viewKey: "media",
      grampsId: "O0123",
    });
  });

  it("lets the app's own hash route win", () => {
    window.history.replaceState(null, "", "/media/O0123#/person/abc");
    captureGrampsWebLink();
    expect(window.location.pathname).toBe("/");
    expect(window.location.hash).toBe("#/person/abc");
    expect(sessionStorage.getItem(STORAGE_KEYS.pendingGrampsWebLink)).toBeNull();
  });

  it("leaves other paths alone", () => {
    window.history.replaceState(null, "", "/somewhere");
    captureGrampsWebLink();
    expect(window.location.pathname).toBe("/somewhere");
    expect(sessionStorage.getItem(STORAGE_KEYS.pendingGrampsWebLink)).toBeNull();
  });
});
