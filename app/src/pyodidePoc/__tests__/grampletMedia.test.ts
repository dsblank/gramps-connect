import { beforeEach, describe, expect, it, vi } from "vitest";

// vite.config.ts's test environment is "node", not jsdom -- stand in with
// a plain Map-backed localStorage, same as store/__tests__/columnWidths.test.ts.
class FakeLocalStorage {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  clear() {
    this.store.clear();
  }
}
vi.stubGlobal("localStorage", new FakeLocalStorage());

vi.mock("../../auth/auth", () => ({
  getToken: vi.fn(),
  hasPermissions: vi.fn(),
}));

vi.mock("../../store/api", async () => {
  const actual = await vi.importActual<typeof import("../../store/api")>("../../store/api");
  return { ...actual, fetchPage: vi.fn() };
});

import { getToken, hasPermissions } from "../../auth/auth";
import { fetchPage } from "../../store/api";
import {
  canAuthorGramplets, effectiveAddedViews, fetchGramplets, GRAMPLET_AUTHOR_PERMISSION, writeLocalAddedViews,
} from "../grampletMedia";
import type { Gramplet } from "../types";

function gramplet(overrides: Partial<Gramplet> = {}): Gramplet {
  return { id: "g1", label: "Test", code: "", ...overrides };
}

describe("effectiveAddedViews", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("falls back to the manifest's own addedViews when this browser has no local preference", () => {
    expect(effectiveAddedViews(gramplet({ addedViews: ["person", "family"] }))).toEqual(["person", "family"]);
  });

  it("defaults to added-nowhere when neither a local preference nor a manifest value exists", () => {
    expect(effectiveAddedViews(gramplet())).toEqual([]);
  });

  // F9 (discussion #4): a Gramplet's "which views show it" used to be part
  // of the shared manifest -- one viewer's (+)/(-) toggle affected every
  // other viewer's tab layout. It's local-only now.
  it("prefers this browser's own local preference over the manifest's value", () => {
    writeLocalAddedViews("g1", ["event"]);
    expect(effectiveAddedViews(gramplet({ addedViews: ["person", "family"] }))).toEqual(["event"]);
  });

  it("an explicitly emptied local preference wins over a non-empty manifest value", () => {
    writeLocalAddedViews("g1", []);
    expect(effectiveAddedViews(gramplet({ addedViews: ["person"] }))).toEqual([]);
  });

  it("keeps different Gramplets' local preferences independent", () => {
    writeLocalAddedViews("g1", ["person"]);
    writeLocalAddedViews("g2", ["event"]);
    expect(effectiveAddedViews(gramplet({ id: "g1" }))).toEqual(["person"]);
    expect(effectiveAddedViews(gramplet({ id: "g2" }))).toEqual(["event"]);
  });
});

describe("canAuthorGramplets", () => {
  it("checks the higher-tier GRAMPLET_AUTHOR_PERMISSION, not plain EditObject", () => {
    vi.mocked(hasPermissions).mockReturnValue(true);
    expect(canAuthorGramplets()).toBe(true);
    expect(hasPermissions).toHaveBeenCalledWith(GRAMPLET_AUTHOR_PERMISSION);
  });

  it("is false when the viewer lacks it", () => {
    vi.mocked(hasPermissions).mockReturnValue(false);
    expect(canAuthorGramplets()).toBe(false);
  });
});

describe("fetchGramplets", () => {
  // Media handle -> [checksum, file body]; a test edits this between calls
  // to simulate a Gramplet being edited/added/removed on the server.
  let server: Map<string, [string, string]>;
  let fetchMock: ReturnType<typeof vi.fn>;

  function manifest(id: string, code = "") {
    return JSON.stringify({ id, label: id, code });
  }

  function fileGets(): string[] {
    return fetchMock.mock.calls.map(([url]) => String(url).match(/media\/([^/]+)\/file/)![1]);
  }

  beforeEach(async () => {
    vi.mocked(getToken).mockResolvedValue("tok");
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchPage).mockImplementation(async () => ({
      page: {
        items: [...server.entries()].map(([handle, [checksum]]) => ({ handle, checksum })),
        next_after: null,
      },
      totalCount: null,
    }));
    fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const handle = String(url).match(/media\/([^/]+)\/file/)![1];
      const entry = server.get(handle);
      if (!entry) return { ok: false, status: 404, json: async () => ({}), text: async () => "" } as unknown as Response;
      return { ok: true, status: 200, text: async () => entry[1] } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // The manifest cache is module-level, and prunes handles the latest
    // query no longer returns -- an empty load resets it between tests.
    server = new Map();
    await fetchGramplets({ fresh: true });
    fetchMock.mockClear();
  });

  it("selects only the checksum column on the tag query", async () => {
    server.set("M1", ["c1", manifest("a")]);

    await fetchGramplets({ fresh: true });

    const calls = vi.mocked(fetchPage).mock.calls;
    const columns = calls[calls.length - 1][7]!;
    expect(columns.map((c) => c.select)).toEqual(["checksum"]);
  });

  it("downloads each manifest once, then only new or re-checksummed ones", async () => {
    server.set("M1", ["c1", manifest("a")]);
    server.set("M2", ["c2", manifest("b")]);
    expect((await fetchGramplets({ fresh: true })).map((g) => g.id)).toEqual(["a", "b"]);
    expect(fileGets()).toEqual(["M1", "M2"]);

    fetchMock.mockClear();
    expect((await fetchGramplets({ fresh: true })).map((g) => g.id)).toEqual(["a", "b"]);
    expect(fileGets()).toEqual([]);

    server.set("M2", ["c2-edited", manifest("b", "print(1)")]);
    server.set("M3", ["c3", manifest("c")]);
    fetchMock.mockClear();
    const after = await fetchGramplets({ fresh: true });
    expect(fileGets().sort()).toEqual(["M2", "M3"]);
    expect(after.find((g) => g.id === "b")!.code).toBe("print(1)");
  });

  it("drops a Gramplet the tag query no longer returns", async () => {
    server.set("M1", ["c1", manifest("a")]);
    server.set("M2", ["c2", manifest("b")]);
    await fetchGramplets({ fresh: true });

    server.delete("M2");
    expect((await fetchGramplets({ fresh: true })).map((g) => g.id)).toEqual(["a"]);
  });

  it("remembers an invalid manifest by checksum, but retries a failed download", async () => {
    server.set("BAD", ["cb", "not json"]);
    expect(await fetchGramplets({ fresh: true })).toEqual([]);
    fetchMock.mockClear();
    await fetchGramplets({ fresh: true });
    expect(fileGets()).toEqual([]);

    // Listed by the query, but its /file 404s -- not cached, so it's
    // retried (and picked up) once the file is actually there.
    vi.mocked(fetchPage).mockImplementationOnce(async () => ({
      page: { items: [{ handle: "BAD", checksum: "cb" }, { handle: "LATE", checksum: "cl" }], next_after: null },
      totalCount: null,
    }));
    fetchMock.mockClear();
    expect(await fetchGramplets({ fresh: true })).toEqual([]);
    expect(fileGets()).toEqual(["LATE"]);

    server.set("LATE", ["cl", manifest("late")]);
    fetchMock.mockClear();
    expect((await fetchGramplets({ fresh: true })).map((g) => g.id)).toContain("late");
    expect(fileGets()).toEqual(["LATE"]);
  });

  it("shares one in-flight load between concurrent callers, unless a caller asks for a fresh one", async () => {
    server.set("M1", ["c1", manifest("a")]);

    const [first, second] = await Promise.all([fetchGramplets(), fetchGramplets()]);
    expect(first).toBe(second);
    expect(vi.mocked(fetchPage)).toHaveBeenCalledTimes(2); // beforeEach's reset load + this one

    const shared = fetchGramplets();
    const fresh = fetchGramplets({ fresh: true });
    await Promise.all([shared, fresh]);
    expect(vi.mocked(fetchPage)).toHaveBeenCalledTimes(4);
  });
});
