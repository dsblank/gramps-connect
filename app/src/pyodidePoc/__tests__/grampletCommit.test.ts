import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getToken: vi.fn(async () => "tok"), hasPermissions: vi.fn(() => true) }));
vi.mock("../../auth/auth", () => auth);

import { commitChangeGroup, undoCommittedGroups } from "../grampletCommit";
import type { TransactionItem } from "../types";

const ITEM: TransactionItem = { type: "update", _class: "Person", handle: "H", old: { a: 1 }, new: { a: 2 } };

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("grampletCommit", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    auth.hasPermissions.mockReturnValue(true);
  });

  it("saves a group as one transaction with its message, returning what the server recorded", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, [ITEM]));
    const group = await commitChangeGroup("Fix names", [ITEM]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/transactions\/\?message=Fix%20names$/);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual([ITEM]);
    expect(group).toEqual({ message: "Fix names", transaction: [ITEM] });
  });

  it("explains the server's conflict refusal", async () => {
    fetchMock.mockResolvedValueOnce(respond(400, { error: { code: 400, message: "Object has changed" } }));
    await expect(commitChangeGroup("Fix", [ITEM])).rejects.toThrow(/changed by someone else/);
  });

  it("won't try without Editor rights", async () => {
    auth.hasPermissions.mockReturnValue(false);
    await expect(commitChangeGroup("Fix", [ITEM])).rejects.toThrow(/Editor/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("undoes groups last first, and says how far it got when one is refused", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, [])).mockResolvedValueOnce(
      respond(400, { error: { code: 400, message: "Object has changed" } })
    );
    const groups = [
      { message: "First", transaction: [ITEM] },
      { message: "Second", transaction: [ITEM] },
    ];
    await expect(undoCommittedGroups(groups)).rejects.toThrow(/^Undid 1 of 2 groups, then: .*changed by someone else/);
    // API_BASE may prefix these (a .env's VITE_API_BASE).
    expect(fetchMock.mock.calls.map(([url]) => String(url).replace(/^.*\/api\//, "/api/"))).toEqual([
      "/api/transactions/?undo=true&message=Undo%3A%20Second",
      "/api/transactions/?undo=true&message=Undo%3A%20First",
    ]);
  });
});
