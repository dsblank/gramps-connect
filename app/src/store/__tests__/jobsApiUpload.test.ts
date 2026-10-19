import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apiFetch", () => ({ apiFetch: vi.fn(), setTokenRenewer: vi.fn() }));
vi.mock("../objectsApi", () => ({
  fetchPlainObject: vi.fn().mockResolvedValue({}),
  updateObject: vi.fn().mockResolvedValue(undefined),
}));

import { apiFetch } from "../apiFetch";
import { uploadMediaFile } from "../jobsApi";

const added = () => new Response(JSON.stringify([{ type: "add", handle: "m1" }]), { status: 201 });
const uploadTypes = () => vi.mocked(apiFetch).mock.calls
  .filter(([, init]) => init?.method === "POST")
  .map(([, init]) => (init?.headers as Record<string, string>)["Content-Type"]);

describe("uploadMediaFile", () => {
  beforeEach(() => vi.mocked(apiFetch).mockReset());

  it("uploads a map file under its extension's type when the browser gives none", async () => {
    vi.mocked(apiFetch).mockResolvedValue(added());
    await uploadMediaFile("tok", new File(["<gpx/>"], "walk.gpx", { type: "" }));
    expect(uploadTypes()).toEqual(["application/gpx+xml"]);
  });

  it("retries as a plain file when an older server rejects the map type", async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(new Response("Internal Server Error", { status: 500 }))
      .mockResolvedValue(added());
    expect(await uploadMediaFile("tok", new File(["<gpx/>"], "walk.gpx", { type: "" }))).toBe("m1");
    expect(uploadTypes()).toEqual(["application/gpx+xml", "application/octet-stream"]);
  });

  it("still falls back when the browser itself reports the map type (Linux)", async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(new Response("Internal Server Error", { status: 500 }))
      .mockResolvedValue(added());
    expect(await uploadMediaFile("tok", new File(["<gpx/>"], "walk.gpx", { type: "application/gpx+xml" }))).toBe("m1");
    expect(uploadTypes()).toEqual(["application/gpx+xml", "application/octet-stream"]);
  });

  it("leaves other files on the browser's type", async () => {
    vi.mocked(apiFetch).mockResolvedValue(added());
    await uploadMediaFile("tok", new File(["x"], "photo.jpg", { type: "image/jpeg" }));
    expect(uploadTypes()).toEqual(["image/jpeg"]);
  });
});
