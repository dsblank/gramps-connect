// LIVE test of the Evidence Board's Save against the :5003 dev server's
// Royal Family TEST tree. Skipped unless BOARD_LIVE=1:
//
//   BOARD_LIVE=1 VITE_API_BASE=http://localhost:5003 npx vitest run src/store/__tests__/boardSave.live.test.ts
//
// Logs in as the `claude` test account and refuses to write unless the
// token is for the Royal Family test tree (by id). Every write is gated on
// the steps before it, and the Save is undone at the end (also in
// afterAll if a step fails), then the touched records are checked against
// their starting state.
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";

const LIVE = process.env.BOARD_LIVE === "1";
const BASE = process.env.VITE_API_BASE ?? "http://localhost:5003";
const TEST_TREE = "a673c3dc-3346-4d09-b40a-9f92be7d87cf"; // Royal Family (test). 75aadaa8... is REAL data: never.
const ACCOUNT = new URL("../../../../dev-fixtures/layer3-sync/api-fixture/claude-account.json", import.meta.url);

const session = vi.hoisted(() => ({ token: "" }));
vi.mock("../../auth/auth", () => ({ getToken: async () => session.token, hasPermissions: () => true, getTreeId: () => "live", getCurrentUsername: () => "claude" }));
const drafts = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (k: string) => drafts.get(k) ?? null, setItem: (k: string, v: string) => void drafts.set(k, v), removeItem: (k: string) => void drafts.delete(k) });
// The real assignGrampsIds reads the app's view caches (sql.js); here the
// next IDs come straight from the server, which is what that code checks against too.
vi.mock("../grampsIds", () => ({
  assignGrampsIds: async (_token: string, objects: Record<string, unknown>[]) => {
    const ns: Record<string, string> = { Person: "people", Family: "families", Event: "events", Source: "sources", Citation: "citations", Note: "notes" };
    const next = new Map<string, number>();
    const out = [];
    for (const o of objects) {
      const cls = String(o._class);
      if (!next.has(cls)) {
        const res = await fetch(`${BASE}/api/${ns[cls]}/?sort=-gramps_id&pagesize=1&page=1&keys=gramps_id`, { headers: { Authorization: `Bearer ${session.token}` } });
        const [top] = (await res.json()) as { gramps_id: string }[];
        next.set(cls, Number(/(\d+)$/.exec(top?.gramps_id ?? "0")![1]) + 1);
      }
      const n = next.get(cls)!;
      next.set(cls, n + 1);
      const prefix: Record<string, string> = { Person: "I", Family: "F", Event: "E", Source: "S", Citation: "C", Note: "N" };
      out.push({ ...o, gramps_id: `${prefix[cls]}${String(n).padStart(4, "0")}` });
    }
    return { objects: out, assigned: out.length };
  },
}));

import { ChangeBuilder, type Change, applyChanges } from "../board/changes";
import { addEventRef, attachNote, cite, linkParentChild, newCitation, newEvent, newNote, newPerson, newSource } from "../board/links";
import { blank, GRAMPS_CLASSES, grampsType, loadRecords, NAMESPACE, type GrampsRecord, type Records } from "../board/records";
import { validateRecord } from "../board/validate";
import { emptyCaseFile, readCaseFileNote } from "../board/caseFile";
import { clearDraft, writeDraft } from "../board/caseDraft";
import { draftOf, openCase } from "../board/caseLoad";
import { changedSince, saveBoard, undoSave, type SavedBoard } from "../board/save";
import { TransactionConflictError } from "../transactionsApi";

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}`, ...(init.headers ?? {}) } });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const newestHistory = async () => ((await api("/api/transactions/history/?page=1&pagesize=1&sort=-id")).body as { id: number; description: string; changes: unknown[] }[])[0];

let saved: SavedBoard | null = null;
let undone = false;
/** Saves made by the loading test, newest last; undone newest first in afterAll if a step fails. */
const loadSaves: SavedBoard[] = [];
let originals: GrampsRecord[] = [];

afterAll(async () => {
  if (LIVE && saved && !undone) await undoSave(saved); // a failed step must not strand the Save
  while (LIVE && loadSaves.length) await undoSave(loadSaves.pop()!);
});

/** Logs in as the test account; fails unless the token is for the test tree. */
async function login(): Promise<void> {
  if (session.token) return;
  const account = JSON.parse(readFileSync(ACCOUNT, "utf8")) as { username: string; password: string };
  const res = await fetch(`${BASE}/api/token/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: account.username, password: account.password }) });
  const token = ((await res.json()) as { access_token?: string }).access_token ?? "";
  expect(token, "login failed").not.toBe("");
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  expect(claims.tree, "REFUSING: not the Royal Family test tree").toBe(TEST_TREE);
  session.token = token;
}

describe.skipIf(!LIVE)("Evidence Board Save, live on the Royal Family test tree", () => {
  it("real records pass validation (read-only), so saving them back isn't blocked", async () => {
    await login();
    let checked = 0;
    for (const cls of GRAMPS_CLASSES) {
      const res = await api(`/api/${NAMESPACE[cls]}/query/`, { method: "POST", body: JSON.stringify({ select: ["handle"], limit: 300 }) });
      const handles = (res.body as { items: { handle: string }[] }).items.map((i) => i.handle);
      const records = Object.values(await loadRecords(cls, handles));
      for (const record of records) {
        expect(() => validateRecord(record), `${cls} ${record.gramps_id}`).not.toThrow();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
  }, 120_000);

  it("runs a whole board Save as one transaction, refuses a stale one, and undoes cleanly", async () => {
    await login(); // refuses anything but the test tree

    // --- load a family with a father, as the board would ---
    const q = await api("/api/families/query/", { method: "POST", body: JSON.stringify({ select: ["handle", "father_handle"], where_expr: "father_handle != None and gramps_id == 'F0070'", limit: 1 }) });
    const famRow = (q.body as { items: { handle: string; father_handle: string }[] }).items[0];
    expect(famRow, "test family F0070 not found").toBeTruthy();
    const base: Records = { ...(await loadRecords("Family", [famRow.handle])), ...(await loadRecords("Person", [famRow.father_handle])) };
    originals = Object.values(base).map((r) => structuredClone(r));
    const dad = famRow.father_handle;

    // --- one board action per Change, as the board would stage them ---
    const changes: Change[] = [];
    const stage = (label: string, action: (b: ChangeBuilder) => void) => {
      const b = new ChangeBuilder(applyChanges(base, changes));
      action(b);
      changes.push(b.change(label));
    };
    let martha = "";
    let caseNote = "";
    stage("New person Martha, a child of the father", (b) => {
      martha = newPerson(b, { first: "Martha", surname: "Boardtest", gender: "F" });
      linkParentChild(b, dad, martha);
    });
    stage("Martha's birth, cited from a new source", (b) => {
      const e = newEvent(b, "BIRTH");
      addEventRef(b, martha, e);
      const s = newSource(b, "Live test: evidence board source");
      cite(b, e, newCitation(b, s, "p. 1"));
    });
    stage("Case file note, attached to the father", (b) => {
      caseNote = newNote(b, JSON.stringify({ version: 1, name: "Live test case", cards: [] }), "Case File");
      attachNote(b, dad, caseNote);
    });

    const before = await newestHistory();
    const file = {
      ...emptyCaseFile("Live test case", "claude"),
      question: "Who was Martha?",
      cards: [
        { handle: dad, class: "Person" as const, gramps_id: base[dad].gramps_id, label: "father", seenChange: base[dad].change as number, x: 0, y: 0, size: "compact" as const },
        { handle: martha, class: "Person" as const, gramps_id: "", label: "Martha", seenChange: 0, x: 260, y: 0, size: "compact" as const },
      ],
    };
    saved = await saveBoard(base, changes, "Evidence Board live test: board save", { caseFile: { note: null, content: file } });
    expect(saved).not.toBeNull();

    // --- one History entry, ours ---
    const entry = await newestHistory();
    expect(entry.id).toBe(before.id + 1);
    expect(entry.description).toBe("Evidence Board live test: board save");

    // --- consistent records, read back ---
    const people = await loadRecords("Person", [martha, dad]);
    const fam = Object.values(await loadRecords("Family", people[martha].parent_family_list as string[]))[0];
    expect((fam.child_ref_list as { ref: string }[]).some((c) => c.ref === martha)).toBe(true);
    expect(people[dad].family_list as string[]).toContain(fam.handle);
    expect(people[martha].birth_ref_index).toBe(0);
    expect(people[dad].note_list as string[]).toContain(caseNote);
    const note = (await loadRecords("Note", [caseNote]))[caseNote];
    expect(note.type).toMatchObject({ string: "Case File" });
    expect(saved!.newIds[martha]).toMatch(/^I\d{4}$/);

    // --- the case file was saved in the same transaction ---
    const caseHandle = saved!.caseNote!.handle;
    const caseNoteNow = (await loadRecords("Note", [caseHandle]))[caseHandle];
    const content = readCaseFileNote(caseNoteNow);
    expect(content.question).toBe("Who was Martha?");
    expect(content.cards.find((c) => c.handle === martha)).toMatchObject({ gramps_id: saved!.newIds[martha], seenChange: null });
    expect(content.cards.find((c) => c.handle === dad)!.seenChange).toBeNull(); // the Save changed the father (note attached)
    // Which GOQL filter finds case files (for the list view's baseFilter)?
    for (const where of ['type.string == "Case File"', 'type == "Case File"']) {
      const r = await api("/api/notes/query/", { method: "POST", body: JSON.stringify({ select: ["handle"], where_expr: where, limit: 50 }) });
      const found = r.status === 200 && (r.body as { items: { handle: string }[] }).items.some((i) => i.handle === caseHandle);
      console.log(`GOQL ${where} -> HTTP ${r.status}, finds the case file: ${found}`);
    }

    // --- a stale Save is refused and writes nothing ---
    const stale = new ChangeBuilder(base);
    stale.set(dad, "private", !base[dad].private);
    await expect(saveBoard(base, [stale.change("stale edit")], "Evidence Board live test: stale")).rejects.toBeInstanceOf(TransactionConflictError);
    expect((await newestHistory()).id).toBe(entry.id);

    // --- Undo the whole Save, and check every record is back ---
    await undoSave(saved!);
    undone = true;
    const after = await changedSince(originals);
    expect(after.changed.map((r) => r.gramps_id)).toEqual([]);
    expect(after.gone).toEqual([]);
    expect(Object.keys(await loadRecords("Person", [martha]))).toEqual([]);
    expect(Object.keys(await loadRecords("Note", [caseNote]))).toEqual([]);
    expect(Object.keys(await loadRecords("Note", [saved!.caseNote!.handle]))).toEqual([]);
  }, 60_000);

  it("reopens a saved case: its own Save isn't 'updated', someone else's later edit is, and a stale loose end waits for review", async () => {
    await login(); // refuses anything but the test tree
    const q = await api("/api/families/query/", { method: "POST", body: JSON.stringify({ select: ["handle", "father_handle"], where_expr: "gramps_id == 'F0070'", limit: 1 }) });
    const famRow = (q.body as { items: { handle: string; father_handle: string }[] }).items[0];
    const dad = famRow.father_handle;
    const base: Records = { ...(await loadRecords("Family", [famRow.handle])), ...(await loadRecords("Person", [dad])) };
    const originals = Object.values(base).map((r) => structuredClone(r));

    // 1. Save a new case: Martha, a child of the father, pinned with him.
    const b = new ChangeBuilder(base);
    const martha = newPerson(b, { first: "Martha", surname: "Loadtest", gender: "F" });
    linkParentChild(b, dad, martha);
    const file = {
      ...emptyCaseFile("Live loading case", "claude"),
      cards: [
        { handle: dad, class: "Person" as const, gramps_id: base[dad].gramps_id, label: "father", seenChange: base[dad].change as number, x: 0, y: 0, size: "compact" as const },
        { handle: martha, class: "Person" as const, gramps_id: "", label: "Martha", seenChange: 0, x: 260, y: 0, size: "compact" as const },
      ],
    };
    const first = await saveBoard(base, [b.change("Martha")], "Evidence Board live test: loading case", { caseFile: { note: null, content: file } });
    loadSaves.push(first!);
    const caseHandle = first!.caseNote!.handle;

    // 2. Reopen: nothing is "updated", because only this case's own Save changed things.
    const opened = await openCase(caseHandle);
    expect(opened.updated).toEqual([]);
    expect(opened.gone).toEqual([]);
    expect(Object.keys(opened.base).sort()).toEqual([dad, martha].sort());

    // 3. An unsaved loose end touching the father, kept in this browser.
    const lb = new ChangeBuilder(opened.base);
    lb.push(dad, "attribute_list", blank("Attribute", { type: grampsType("AttributeType", "CUSTOM", "Loadtest"), value: "draft" }));
    const loose = lb.change("Unsaved attribute on the father");
    writeDraft(caseHandle, draftOf(opened, opened.file, [loose]));

    // 4. Someone else edits the father, a few seconds later.
    await new Promise((r) => setTimeout(r, 3000));
    const fresh = await loadRecords("Person", [dad]);
    const other = new ChangeBuilder(fresh);
    other.set(dad, "private", !fresh[dad].private);
    loadSaves.push((await saveBoard(fresh, [other.change("someone else")], "Evidence Board live test: someone else"))!);

    // 5. Reopen: the father is "updated"; the stale loose end is unticked for review.
    const again = await openCase(caseHandle);
    expect(again.updated.map((c) => c.handle)).toEqual([dad]);
    expect(again.needsReview).toEqual([loose.id]);
    expect(again.changes[0].off).toBe(true);
    expect(again.layoutReplaced).toBe(false);

    // 6. Undo both Saves, newest first; everything is back.
    while (loadSaves.length) await undoSave(loadSaves.pop()!);
    clearDraft(caseHandle);
    const after = await changedSince(originals);
    expect(after.changed.map((r) => r.gramps_id)).toEqual([]);
    expect(after.gone).toEqual([]);
    expect(Object.keys(await loadRecords("Note", [caseHandle]))).toEqual([]);
  }, 60_000);
});
