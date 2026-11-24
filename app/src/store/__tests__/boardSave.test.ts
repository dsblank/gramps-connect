import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getToken: vi.fn(async () => "tok"), hasPermissions: vi.fn(() => true) }));
vi.mock("../../auth/auth", () => auth);
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("../apiFetch", () => ({ apiFetch }));
const assignGrampsIds = vi.hoisted(() =>
  vi.fn(async (_token: string, objects: Record<string, unknown>[], _options?: { builtInFallback?: boolean }) => ({
    objects: objects.map((o, i) => ({ ...o, gramps_id: `X${i}` })),
    assigned: objects.length,
  })),
);
vi.mock("../grampsIds", () => ({ assignGrampsIds }));

import { applyChanges, ChangeBuilder, toggleChange, type Change } from "../board/changes";
import { linkParentChild, newPerson } from "../board/links";
import { blank, GENDER, loadRecords, recordFields, type GrampsRecord, type Records } from "../board/records";
import { changedSince, planSave, saveBoard, undoSave } from "../board/save";
import { TransactionConflictError } from "../transactionsApi";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function base(): Records {
  const john = blank<GrampsRecord>("Person", { handle: "john", gramps_id: "I0001", gender: GENDER.MALE, family_list: ["F1"] });
  const f1 = blank<GrampsRecord>("Family", { handle: "F1", gramps_id: "F0001", father_handle: "john" });
  return { john, F1: f1 };
}

/** "New person Martha, John's child": one change creating Martha and linking her. */
function marthaChange(records: Records): Change {
  const b = new ChangeBuilder(records);
  const m = newPerson(b, { first: "Martha", gender: "F" });
  linkParentChild(b, "john", m);
  return b.change("New person Martha: John's child");
}

beforeEach(() => {
  apiFetch.mockReset();
  assignGrampsIds.mockClear();
  auth.hasPermissions.mockReturnValue(true);
});

describe("planSave", () => {
  it("sends new records as adds and only the existing records that changed as updates, with `old` as loaded", () => {
    const records: Records = { ...base(), david: blank<GrampsRecord>("Person", { handle: "david", gramps_id: "I0002" }) };
    const plan = planSave(records, [marthaChange(records)]);
    expect(plan.adds.map((r) => r._class)).toEqual(["Person"]);
    expect(plan.updates.map((u) => u.old.handle)).toEqual(["F1"]);
    expect(plan.updates[0].old).toBe(records.F1);
    expect((plan.updates[0].new.child_ref_list as unknown[]).length).toBe(1);
  });

  it("leaves unticked changes out", () => {
    const records = base();
    const change = marthaChange(records);
    expect(planSave(records, toggleChange([change], change.id))).toEqual({ adds: [], updates: [] });
  });

  it("refuses a change to a record the board never loaded", () => {
    const records = base();
    const b = new ChangeBuilder({ ...records, ghost: blank<GrampsRecord>("Person", { handle: "ghost", gramps_id: "I9" }) });
    b.set("ghost", "private", true);
    expect(() => planSave(records, [b.change("edit ghost")])).toThrow(/hasn't loaded/);
  });
});

describe("saveBoard", () => {
  it("sends one transaction: adds with fresh Gramps IDs, then updates; returns what Undo needs", async () => {
    const records = base();
    apiFetch.mockImplementation(async (_url: string, init: RequestInit) => json(JSON.parse(init.body as string)));
    const saved = await saveBoard(records, [marthaChange(records)], "Evidence Board: Miller case");
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [url, init] = apiFetch.mock.calls[0];
    expect(url).toMatch(/\/api\/transactions\/\?message=Evidence%20Board%3A%20Miller%20case$/);
    const items = JSON.parse((init as RequestInit).body as string);
    expect(items.map((i: { type: string; _class: string }) => `${i.type} ${i._class}`)).toEqual(["add Person", "update Family"]);
    expect(items[0].old).toBeNull();
    expect(items[0].new.gramps_id).toBe("X0");
    expect(items[1].old).toEqual(records.F1);
    expect(assignGrampsIds.mock.calls[0][2]).toEqual({ builtInFallback: true });
    expect(Object.values(saved!.newIds)).toEqual(["X0"]);
    expect(saved!.transaction).toEqual(items);
  });

  it("does nothing when nothing changed", async () => {
    expect(await saveBoard(base(), [], "nothing")).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("turns the server's refusal into a conflict error", async () => {
    apiFetch.mockResolvedValue(json({ error: { code: 400, message: "Object has changed" } }, 400));
    const records = base();
    await expect(saveBoard(records, [marthaChange(records)], "x")).rejects.toBeInstanceOf(TransactionConflictError);
  });

  it("needs Editor rights", async () => {
    auth.hasPermissions.mockReturnValue(false);
    const records = base();
    await expect(saveBoard(records, [marthaChange(records)], "x")).rejects.toThrow(/Editor/);
  });

  it("Undo sends the recorded transaction back with undo=true", async () => {
    apiFetch.mockResolvedValue(json([]));
    await undoSave({ message: "Evidence Board: Miller case", transaction: [], newIds: {}, caseNote: null });
    expect(apiFetch.mock.calls[0][0]).toMatch(/\?undo=true&message=Undo%3A%20Evidence%20Board%3A%20Miller%20case$/);
  });
});

describe("loading and conflicts", () => {
  it("loads records through /query/ selecting every field, in Gramps' internal form", async () => {
    apiFetch.mockResolvedValue(json({ items: [{ handle: "john", gramps_id: "I0001" }] }));
    const loaded = await loadRecords("Person", ["john", "john"]);
    const [url, init] = apiFetch.mock.calls[0];
    expect(url).toMatch(/\/api\/people\/query\/$/);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.select).toEqual(recordFields("Person"));
    expect(body.where_expr).toBe('handle in ["john"]');
    expect(loaded.john._class).toBe("Person");
  });

  it("says which records someone else changed or removed, ignoring the change time", async () => {
    const records: Records = { ...base(), F2: blank<GrampsRecord>("Family", { handle: "F2", gramps_id: "F0002" }) };
    apiFetch.mockImplementation(async (url: string) =>
      url.includes("/people/")
        ? json({ items: [{ ...records.john, change: 999 }] })
        : json({ items: [{ ...records.F1, private: true }] }),
    );
    const { changed, gone } = await changedSince([records.john, records.F1, records.F2]);
    expect(changed.map((r) => r.handle)).toEqual(["F1"]);
    expect(gone.map((r) => r.handle)).toEqual(["F2"]);
  });
});

describe("applyChanges", () => {
  it("leaves the loaded records untouched", () => {
    const records = base();
    const snapshot = structuredClone(records);
    applyChanges(records, [marthaChange(records)]);
    expect(records).toEqual(snapshot);
  });
});
