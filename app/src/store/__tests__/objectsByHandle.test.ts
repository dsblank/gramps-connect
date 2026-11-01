import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("../apiFetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../apiFetch")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));
vi.mock("../../i18n/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../i18n/i18n")>()),
  getI18nSnapshot: () => ({ lang: "de" }),
}));

const { fetchObjectsByHandle } = await import("../objectsByHandle");

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}

describe("fetchObjectsByHandle", () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it("asks the type's list endpoint for the handles, with profiles in the UI language", async () => {
    apiFetch.mockResolvedValueOnce(jsonResponse([{ handle: "A", gramps_id: "I1" }]));
    const found = await fetchObjectsByHandle("tok", "person", ["A", "GONE"]);
    const url = new URL(apiFetch.mock.calls[0][0], "http://x");
    expect(url.pathname).toBe("/api/people/");
    expect(url.searchParams.get("handles")).toBe("A,GONE");
    expect(url.searchParams.get("profile")).toBe("all");
    expect(url.searchParams.get("locale")).toBe("de");
    // The user's name format, which /api/search/ can't take but these can.
    expect(url.searchParams.get("name_format")).toBeTruthy();
    expect([...found.keys()]).toEqual(["A"]);
  });

  it("splits a long list into several requests", async () => {
    const handles = Array.from({ length: 120 }, (_, i) => `H${i}`);
    apiFetch.mockImplementation(async (url: string) => {
      const asked = new URL(url, "http://x").searchParams.get("handles")!.split(",");
      return jsonResponse(asked.map((handle) => ({ handle })));
    });
    const found = await fetchObjectsByHandle("tok", "note", handles);
    expect(apiFetch).toHaveBeenCalledTimes(3);
    expect(new URL(apiFetch.mock.calls[0][0], "http://x").pathname).toBe("/api/notes/");
    expect(found.size).toBe(120);
  });

  it("throws on a failed request", async () => {
    apiFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: "x", text: async () => "boom", headers: new Headers() } as Response);
    await expect(fetchObjectsByHandle("tok", "place", ["A"])).rejects.toThrow();
  });
});
