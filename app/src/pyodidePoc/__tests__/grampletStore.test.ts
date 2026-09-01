import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth/auth", () => ({
  getToken: vi.fn(),
}));
vi.mock("../../store/jobsApi", () => ({
  deleteMedia: vi.fn(),
}));
vi.mock("../grampletMedia", () => ({
  uploadGramplet: vi.fn(),
  saveGrampletManifest: vi.fn(),
}));

import { getToken } from "../../auth/auth";
import { deleteMedia } from "../../store/jobsApi";
import { saveGrampletManifest, uploadGramplet } from "../grampletMedia";
import {
  buildGrampletFromCatalogEntry,
  fetchCatalog,
  findInstalledEntry,
  hasCatalogUpdate,
  hashCode,
  installFromCatalog,
  removeGramplet,
  resolveCatalogAssetUrl,
  updateFromCatalog,
  wasEditedSinceInstall,
} from "../grampletStore";
import type { CatalogEntry, Gramplet } from "../types";

function entry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: "hello-table",
    name: "Hello Table",
    description: "Run a query and show a table.",
    version: "1.0.0",
    author: "Gramps Connect",
    category: "example",
    code: "people()",
    ...overrides,
  };
}

function gramplet(overrides: Partial<Gramplet> = {}): Gramplet {
  return { id: "g1", label: "Test", code: "", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("hashCode", () => {
  it("is deterministic for the same input", () => {
    expect(hashCode("people()")).toBe(hashCode("people()"));
  });

  it("differs for different input", () => {
    expect(hashCode("people()")).not.toBe(hashCode("families()"));
  });
});

describe("fetchCatalog", () => {
  it("returns the parsed array on success", async () => {
    const entries = [entry()];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(entries) })
    );
    await expect(fetchCatalog("https://example.test/catalog.json")).resolves.toEqual(entries);
  });

  it("throws a readable error on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" }));
    await expect(fetchCatalog("https://example.test/catalog.json")).rejects.toThrow(/404/);
  });

  it("throws a readable error when fetch itself fails (offline)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(fetchCatalog("https://example.test/catalog.json")).rejects.toThrow(/Couldn't reach the Gramplet Store/);
  });

  it("throws when the response isn't a JSON array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ not: "an array" }) }));
    await expect(fetchCatalog("https://example.test/catalog.json")).rejects.toThrow(/list of entries/);
  });
});

describe("resolveCatalogAssetUrl", () => {
  it("resolves a relative icon path against the catalog's own URL", () => {
    expect(resolveCatalogAssetUrl("https://example.test/gramplet-store/catalog.json", "icons/hello-table.png")).toBe(
      "https://example.test/gramplet-store/icons/hello-table.png"
    );
  });
});

describe("findInstalledEntry", () => {
  it("finds the Gramplet whose sourceId matches", () => {
    const installed = [gramplet({ id: "g1", sourceId: "hello-table" }), gramplet({ id: "g2", sourceId: "gallery" })];
    expect(findInstalledEntry(installed, "gallery")?.id).toBe("g2");
  });

  it("returns undefined when nothing matches", () => {
    expect(findInstalledEntry([gramplet({ sourceId: "gallery" })], "hello-table")).toBeUndefined();
  });
});

describe("hasCatalogUpdate", () => {
  it("is true when the installed sourceVersion differs from the catalog's current version", () => {
    expect(hasCatalogUpdate(gramplet({ sourceId: "hello-table", sourceVersion: "1.0.0" }), entry({ version: "1.1.0" }))).toBe(
      true
    );
  });

  it("is false when versions match", () => {
    expect(hasCatalogUpdate(gramplet({ sourceId: "hello-table", sourceVersion: "1.0.0" }), entry({ version: "1.0.0" }))).toBe(
      false
    );
  });

  it("is false for a Gramplet installed from a different catalog entry", () => {
    expect(hasCatalogUpdate(gramplet({ sourceId: "gallery", sourceVersion: "1.0.0" }), entry({ id: "hello-table", version: "2.0.0" }))).toBe(
      false
    );
  });
});

describe("wasEditedSinceInstall", () => {
  it("is false right after install (hash still matches)", () => {
    const installed = buildGrampletFromCatalogEntry(entry());
    expect(wasEditedSinceInstall(installed)).toBe(false);
  });

  it("is true once the code diverges from the installed hash", () => {
    const installed = buildGrampletFromCatalogEntry(entry());
    expect(wasEditedSinceInstall({ ...installed, code: "people(); print('customized')" })).toBe(true);
  });

  it("is false for a Gramplet that was never installed from the catalog", () => {
    expect(wasEditedSinceInstall(gramplet({ code: "people()" }))).toBe(false);
  });
});

describe("buildGrampletFromCatalogEntry", () => {
  it("carries the entry's content and stamps provenance fields", () => {
    const built = buildGrampletFromCatalogEntry(entry({ views: ["person"], listensToSelection: true }));
    expect(built.label).toBe("Hello Table");
    expect(built.description).toBe("Run a query and show a table.");
    expect(built.code).toBe("people()");
    expect(built.views).toEqual(["person"]);
    expect(built.listensToSelection).toBe(true);
    expect(built.sourceId).toBe("hello-table");
    expect(built.sourceVersion).toBe("1.0.0");
    expect(built.sourceCodeHash).toBe(hashCode("people()"));
    expect(built.addedViews).toEqual([]);
  });

  it("scopes views/addedViews to defaultViewKey when given", () => {
    const built = buildGrampletFromCatalogEntry(entry({ views: undefined }), "family");
    expect(built.views).toEqual(["family"]);
    expect(built.addedViews).toEqual(["family"]);
  });

  it("gives every install its own id, even for the same entry", () => {
    const a = buildGrampletFromCatalogEntry(entry());
    const b = buildGrampletFromCatalogEntry(entry());
    expect(a.id).not.toBe(b.id);
  });
});

describe("installFromCatalog", () => {
  it("uploads the built Gramplet and returns it with its new handle attached", async () => {
    vi.mocked(uploadGramplet).mockResolvedValue("new-handle");
    const result = await installFromCatalog(entry());
    expect(uploadGramplet).toHaveBeenCalledTimes(1);
    const uploaded = vi.mocked(uploadGramplet).mock.calls[0][0];
    expect(uploaded.sourceId).toBe("hello-table");
    expect(result.handle).toBe("new-handle");
    expect(result.sourceId).toBe("hello-table");
  });
});

describe("updateFromCatalog", () => {
  it("overwrites content and provenance but keeps label/id/handle/addedViews", async () => {
    const installed = gramplet({
      id: "g1",
      handle: "h1",
      label: "My Renamed Copy",
      code: "old code",
      sourceId: "hello-table",
      sourceVersion: "1.0.0",
      sourceCodeHash: hashCode("old code"),
      addedViews: ["person"],
    });
    const newEntry = entry({ version: "1.1.0", code: "new code", description: "Now with more detail." });

    const result = await updateFromCatalog(installed, newEntry);

    expect(saveGrampletManifest).toHaveBeenCalledWith("h1", expect.objectContaining({ code: "new code" }));
    expect(result.label).toBe("My Renamed Copy");
    expect(result.id).toBe("g1");
    expect(result.handle).toBe("h1");
    expect(result.addedViews).toEqual(["person"]);
    expect(result.code).toBe("new code");
    expect(result.description).toBe("Now with more detail.");
    expect(result.sourceVersion).toBe("1.1.0");
    expect(result.sourceCodeHash).toBe(hashCode("new code"));
  });

  it("refuses to update a Gramplet with no handle yet", async () => {
    await expect(updateFromCatalog(gramplet({ handle: undefined }), entry())).rejects.toThrow(/hasn't been uploaded/);
    expect(saveGrampletManifest).not.toHaveBeenCalled();
  });
});

describe("removeGramplet", () => {
  it("deletes the underlying Media object", async () => {
    vi.mocked(getToken).mockResolvedValue("tok");
    await removeGramplet("h1");
    expect(deleteMedia).toHaveBeenCalledWith("tok", "h1");
  });
});
