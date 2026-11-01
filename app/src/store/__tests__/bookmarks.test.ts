import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("../apiFetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../apiFetch")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));
const auth = { tree: "tree-1" as string | null, perms: ["EditObject"] };
vi.mock("../../auth/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../auth/auth")>()),
  getTreeId: () => auth.tree,
  hasPermissions: (p: string) => auth.perms.includes(p),
}));

type Bookmarks = typeof import("../bookmarks");

const SERVER = {
  people: ["P1", "P2"], families: ["F1"], events: [], places: [], sources: [], citations: [],
  repositories: [], media: [], notes: ["N1"],
};

function ok(body: unknown = "") {
  return { ok: true, status: 200, json: async () => body, text: async () => "" } as unknown as Response;
}
function fail(status: number) {
  return { ok: false, status, statusText: "x", text: async () => "nope", headers: new Headers() } as unknown as Response;
}

describe("bookmarks", () => {
  let b: Bookmarks;

  beforeEach(async () => {
    apiFetch.mockReset();
    auth.tree = "tree-1";
    auth.perms = ["EditObject"];
    vi.resetModules();
    b = await import("../bookmarks");
  });

  it("maps the server's namespaces onto view keys, keeping their order", async () => {
    apiFetch.mockResolvedValueOnce(ok(SERVER));
    await b.loadBookmarks("tok");
    expect(apiFetch.mock.calls[0][0]).toMatch(/\/api\/bookmarks\/$/);
    expect(b.getBookmarks("person")).toEqual(["P1", "P2"]);
    expect(b.getBookmarks("family")).toEqual(["F1"]);
    expect(b.isBookmarked("note", "N1")).toBe(true);
    expect(b.isBookmarked("person", "P9")).toBe(false);
  });

  it("has no bookmarks for Tags or the app's own pages", () => {
    expect(b.isBookmarkable("tag")).toBe(false);
    expect(b.isBookmarkable("story")).toBe(false);
    expect(b.isBookmarkable("person")).toBe(true);
  });

  it("loads once unless forced", async () => {
    apiFetch.mockResolvedValue(ok(SERVER));
    await b.loadBookmarks("tok");
    await b.loadBookmarks("tok");
    expect(apiFetch).toHaveBeenCalledTimes(1);
    await b.loadBookmarks("tok", true);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("forgets another tree's bookmarks", async () => {
    apiFetch.mockResolvedValueOnce(ok(SERVER));
    await b.loadBookmarks("tok");
    auth.tree = "tree-2";
    expect(b.bookmarksLoaded()).toBe(false);
    expect(b.isBookmarked("person", "P1")).toBe(false);
  });

  it("adds and removes with PUT and DELETE, showing the change at once", async () => {
    apiFetch.mockResolvedValueOnce(ok(SERVER));
    await b.loadBookmarks("tok");
    apiFetch.mockResolvedValue(ok());
    await b.setBookmarked("tok", "person", "P3", true);
    expect(apiFetch.mock.calls[1][0]).toMatch(/\/api\/bookmarks\/people\/P3$/);
    expect(apiFetch.mock.calls[1][1].method).toBe("PUT");
    expect(b.getBookmarks("person")).toEqual(["P1", "P2", "P3"]);
    await b.setBookmarked("tok", "person", "P1", false);
    expect(apiFetch.mock.calls[2][1].method).toBe("DELETE");
    expect(b.getBookmarks("person")).toEqual(["P2", "P3"]);
  });

  it("puts the list back when the server refuses", async () => {
    apiFetch.mockResolvedValueOnce(ok(SERVER));
    await b.loadBookmarks("tok");
    apiFetch.mockResolvedValueOnce(fail(403));
    await expect(b.setBookmarked("tok", "person", "P3", true)).rejects.toThrow();
    expect(b.getBookmarks("person")).toEqual(["P1", "P2"]);
  });

  it("treats removing an already-removed bookmark as done", async () => {
    apiFetch.mockResolvedValueOnce(ok(SERVER));
    await b.loadBookmarks("tok");
    apiFetch.mockResolvedValueOnce(fail(404));
    await b.setBookmarked("tok", "person", "P1", false);
    expect(b.getBookmarks("person")).toEqual(["P2"]);
  });

  it("lets only editors change bookmarks", () => {
    expect(b.canEditBookmarks()).toBe(true);
    auth.perms = [];
    expect(b.canEditBookmarks()).toBe(false);
  });
});
