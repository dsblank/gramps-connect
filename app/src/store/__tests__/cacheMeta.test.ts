import { beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { TAG_VIEW, type ViewConfig } from "../views";

vi.mock("../../auth/auth", () => ({
  getToken: vi.fn().mockResolvedValue("test-token"),
  getTreeId: vi.fn().mockReturnValue(null),
  getCurrentUsername: vi.fn().mockReturnValue("alice"),
}));

import { getCurrentUsername } from "../../auth/auth";
import { fetchServerState, isCacheStale, resetServerState, schemaSignature, writeCacheMeta } from "../cacheMeta";

let sqlPromise: Promise<SqlJsStatic> | null = null;
function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) sqlPromise = initSqlJs();
  return sqlPromise;
}

interface FakeServer {
  dbName?: string;
  dbId?: string;
  counts?: Record<string, number>;
  /** null => the history endpoint 403s, as it does for a user without
   * PERM_VIEW_PRIVATE. */
  cursor?: number | null;
  metadataFails?: boolean;
}

/** Stands in for the two endpoints fetchServerState() reads. */
function mockServer({ dbName = "Fixture Tree", dbId = "sqlite", counts = { tags: 2 }, cursor = 7, metadataFails = false }: FakeServer = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/api/metadata/")) {
        if (metadataFails) return { ok: false, status: 500 } as unknown as Response;
        return {
          ok: true,
          json: async () => ({ database: { name: dbName, id: dbId }, object_counts: counts }),
        } as unknown as Response;
      }
      if (url.includes("/api/transactions/history/")) {
        if (cursor === null) return { ok: false, status: 403 } as unknown as Response;
        return { ok: true, json: async () => (cursor === 0 ? [] : [{ id: cursor }]) } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    })
  );
}

/** A cache database stamped with the server state currently mocked --
 * i.e. exactly what runQuery()'s persist path writes. */
async function cachedDb(view: ViewConfig = TAG_VIEW, rowCount = 2): Promise<Database> {
  const SQL = await getSql();
  const db = new SQL.Database();
  db.run(`CREATE TABLE ${view.key} (handle TEXT PRIMARY KEY);`);
  writeCacheMeta(db, view, await fetchServerState(), rowCount);
  return db;
}

describe("isCacheStale", () => {
  beforeEach(() => {
    resetServerState();
    vi.mocked(getCurrentUsername).mockReturnValue("alice");
  });

  it("accepts a cache written against the server's current state", async () => {
    mockServer();
    const db = await cachedDb();

    resetServerState(); // next page load refetches, same answers
    expect(await isCacheStale(db, TAG_VIEW)).toBe(false);
  });

  it("rejects a cache with no meta table at all (written before this existed)", async () => {
    mockServer();
    const SQL = await getSql();
    const db = new SQL.Database();
    db.run(`CREATE TABLE ${TAG_VIEW.key} (handle TEXT PRIMARY KEY);`);

    expect(await isCacheStale(db, TAG_VIEW)).toBe(true);
  });

  it("rejects a cache from a different database on the same URL", async () => {
    mockServer({ dbName: "Fixture Tree" });
    const db = await cachedDb();

    // The dev case: same backend restarted on another fixture.
    resetServerState();
    mockServer({ dbName: "Other Tree" });
    expect(await isCacheStale(db, TAG_VIEW)).toBe(true);
  });

  it("rejects a cache built for a different user's permissions", async () => {
    mockServer();
    const db = await cachedDb();

    vi.mocked(getCurrentUsername).mockReturnValue("bob");
    expect(await isCacheStale(db, TAG_VIEW)).toBe(true);
  });

  it("rejects a cache whose view config has since changed", async () => {
    mockServer();
    const db = await cachedDb();

    const edited: ViewConfig = {
      ...TAG_VIEW,
      columns: TAG_VIEW.columns.map((c) => (c.key === "name" ? { ...c, select: "renamed" } : c)),
    };
    resetServerState();
    expect(await isCacheStale(db, edited)).toBe(true);
  });

  it("rejects a cache once another transaction has been committed", async () => {
    mockServer({ cursor: 7 });
    const db = await cachedDb();

    resetServerState();
    mockServer({ cursor: 8 });
    expect(await isCacheStale(db, TAG_VIEW)).toBe(true);
  });

  it("falls back to row counts when the history endpoint is forbidden", async () => {
    mockServer({ cursor: null, counts: { tags: 2 } });
    const db = await cachedDb(TAG_VIEW, 2);

    resetServerState();
    mockServer({ cursor: null, counts: { tags: 2 } });
    expect(await isCacheStale(db, TAG_VIEW)).toBe(false);

    resetServerState();
    mockServer({ cursor: null, counts: { tags: 3 } });
    expect(await isCacheStale(db, TAG_VIEW)).toBe(true);
  });

  it("refetches server state after an in-session login as another user", async () => {
    mockServer({ dbName: "Alice Tree" });
    await fetchServerState();

    vi.mocked(getCurrentUsername).mockReturnValue("bob");
    mockServer({ dbName: "Bob Tree" });
    // Memoized per identity, so this doesn't keep describing Alice's tree
    // even though nothing called resetServerState().
    expect((await fetchServerState()).dbName).toBe("Bob Tree");
  });

  it("keeps the cache when the server can't be reached at all", async () => {
    mockServer();
    const db = await cachedDb();

    // Offline reload: showing the last known rows beats wiping them and
    // then failing to refetch.
    resetServerState();
    mockServer({ metadataFails: true });
    expect(await isCacheStale(db, TAG_VIEW)).toBe(false);
  });
});

describe("schemaSignature", () => {
  it("changes when a column's stored value would change", () => {
    const before = schemaSignature(TAG_VIEW);
    const withNewToSql: ViewConfig = {
      ...TAG_VIEW,
      columns: TAG_VIEW.columns.map((c) => (c.key === "name" ? { ...c, toSql: (v: unknown) => String(v).trim() } : c)),
    };

    expect(schemaSignature(withNewToSql)).not.toBe(before);
  });

  it("ignores render-only changes, which need no refetch", () => {
    const before = schemaSignature(TAG_VIEW);
    const withNewLabel: ViewConfig = {
      ...TAG_VIEW,
      columns: TAG_VIEW.columns.map((c) => (c.key === "name" ? { ...c, label: "Renamed", toDisplay: (v: unknown) => `${v}!` } : c)),
    };

    expect(schemaSignature(withNewLabel)).toBe(before);
  });
});
