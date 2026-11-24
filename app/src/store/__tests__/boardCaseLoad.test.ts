import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getToken: vi.fn(async () => "tok"),
  hasPermissions: vi.fn((..._perms: string[]) => true),
  getTreeId: () => "tree1",
  getCurrentUsername: () => "doug",
}));
vi.mock("../../auth/auth", () => auth);

/** A fake tree: handle -> record, served through /query/ like the server. */
const tree = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const apiFetch = vi.hoisted(() =>
  vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { where_expr: string };
    const handles = JSON.parse(body.where_expr.replace(/^handle in /, "")) as string[];
    const items = handles.filter((h) => tree.has(h)).map((h) => {
      const { _class: _c, ...rest } = tree.get(h)!;
      return rest;
    });
    return new Response(JSON.stringify({ items }), { status: 200 });
  }),
);
vi.mock("../apiFetch", () => ({ apiFetch }));

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

import { applyChanges, ChangeBuilder } from "../board/changes";
import { emptyCaseFile, newCaseFileNote, serializeCaseFile, type CaseFile } from "../board/caseFile";
import { readDraft, writeDraft } from "../board/caseDraft";
import { AFTER_OWN_SAVE, CaseNotAvailableError, draftOf, openCase, openUnsavedCase } from "../board/caseLoad";
import { linkParentChild, newPerson } from "../board/links";
import { blank, GENDER, type GrampsRecord } from "../board/records";

const NOTE_CHANGE = 5000;
const person = (handle: string, change: number, extra: Record<string, unknown> = {}) =>
  blank<GrampsRecord>("Person", { handle, gramps_id: handle.toUpperCase(), gender: GENDER.MALE, change, ...extra });
const card = (handle: string, seenChange: number | null, x = 0) => ({ handle, class: "Person" as const, gramps_id: handle.toUpperCase(), label: `${handle} label`, seenChange, x, y: 0, size: "compact" as const });

function putNote(file: CaseFile, change = NOTE_CHANGE): GrampsRecord {
  const note = { ...newCaseFileNote(), handle: "case1", gramps_id: "N0001", change, text: { _class: "StyledText", string: serializeCaseFile(file), tags: [] } } as GrampsRecord;
  tree.set(note.handle, note);
  return note;
}
const put = (...records: GrampsRecord[]) => records.forEach((r) => tree.set(r.handle, r));

beforeEach(() => {
  tree.clear();
  store.clear();
  apiFetch.mockClear();
  auth.hasPermissions.mockImplementation(() => true);
});

describe("opening a case file", () => {
  it("marks records changed since the case was last saved, and not the ones this case's own save changed", async () => {
      put(
        person("same", 1000),
        person("edited", 1500), // seen at 1000
        person("ours", NOTE_CHANGE + 1), // changed by the case's own save (null): within the slack
        person("oursthenedited", NOTE_CHANGE + 60), // changed by the save, then by someone else later
      );
      putNote({ ...emptyCaseFile("Case", "doug"), cards: [card("same", 1000), card("edited", 1000), card("ours", null), card("oursthenedited", null)] });
      const opened = await openCase("case1");
      expect(opened.updated.map((c) => c.handle)).toEqual(["edited", "oursthenedited"]);
      expect(Object.keys(opened.base).sort()).toEqual(["edited", "ours", "oursthenedited", "same"]);
      expect(opened.gone).toEqual([]);
      expect(opened.hidden).toBe(0);
  });

  it("lists a deleted record by its stored name for members, but only counts it for guests", async () => {
    put(person("here", 1000));
    putNote({ ...emptyCaseFile("Case", "doug"), cards: [card("here", 1000), card("deleted", 1000)] });
    expect((await openCase("case1")).gone.map((c) => c.label)).toEqual(["deleted label"]);
    auth.hasPermissions.mockImplementation((...perms: string[]) => !perms.includes("ViewPrivate"));
    const asGuest = await openCase("case1");
    expect(asGuest.gone).toEqual([]);
    expect(asGuest.hidden).toBe(1);
  });

  it("a case file that's gone or can't be seen says so", async () => {
    await expect(openCase("nope")).rejects.toBeInstanceOf(CaseNotAvailableError);
  });
});

describe("unsaved work from this browser", () => {
  function setup() {
    put(person("john", 1000, { family_list: ["F1"] }), blank<GrampsRecord>("Family", { handle: "F1", gramps_id: "F0001", father_handle: "john", change: 1000 }));
    const file = { ...emptyCaseFile("Case", "doug"), cards: [card("john", 1000)] };
    const note = putNote(file);
    return { file, note };
  }

  it("re-applies loose ends and the unsaved layout when nothing moved on", async () => {
    const { file, note } = setup();
    const opened = await openCase("case1");
    const b = new ChangeBuilder({ ...opened.base, F1: tree.get("F1") as GrampsRecord });
    linkParentChild(b, "john", newPerson(b, { first: "Martha" }));
    const change = b.change("Martha");
    const moved = { ...file, cards: [{ ...file.cards[0], x: 500 }] };
    writeDraft("case1", draftOf({ note, base: { ...opened.base, F1: tree.get("F1") as GrampsRecord } }, moved, [change]));
    // Linking into John's existing family changes the family (and new Martha), not John.
    expect(readDraft("case1")!.seen).toEqual({ F1: { class: "Family", change: 1000 } });

    const again = await openCase("case1");
    expect(again.file.cards[0].x).toBe(500);
    expect(again.changes.map((c) => c.off)).toEqual([false]);
    expect(again.needsReview).toEqual([]);
    expect(Object.keys(again.base).sort()).toEqual(["F1", "john"]); // the family the loose end touches is loaded too
    expect(Object.values(applyChanges(again.base, again.changes)).some((r) => (r.primary_name as { first_name: string } | undefined)?.first_name === "Martha")).toBe(true);
    expect(applyChanges(again.base, again.changes).F1.child_ref_list).toHaveLength(1);
  });

  it("unticks a loose end (and what depends on it) whose record someone changed since, for review", async () => {
    const { file, note } = setup();
    const base = { john: tree.get("john") as GrampsRecord, F1: tree.get("F1") as GrampsRecord };
    const b1 = new ChangeBuilder(base);
    const martha = newPerson(b1, { first: "Martha" });
    linkParentChild(b1, "john", martha);
    const c1 = b1.change("Martha is John's child");
    const b2 = new ChangeBuilder(applyChanges(base, [c1]));
    b2.set(martha, "private", true);
    const c2 = b2.change("Martha is private");
    writeDraft("case1", draftOf({ note, base }, file, [c1, c2]));
    put({ ...(tree.get("F1") as GrampsRecord), change: 2000, private: true }); // someone edited the family

    const opened = await openCase("case1");
    expect(opened.needsReview.sort()).toEqual([c1.id, c2.id].sort());
    expect(opened.changes.every((c) => c.off)).toBe(true);
  });

  it("shows the saved layout when the case was saved elsewhere since the draft", async () => {
    const { file, note } = setup();
    writeDraft("case1", draftOf({ note, base: {} }, { ...file, cards: [{ ...file.cards[0], x: 777 }] }, []));
    putNote({ ...file, cards: [{ ...file.cards[0], x: 111 }] }, NOTE_CHANGE + 100);
    const opened = await openCase("case1");
    expect(opened.file.cards[0].x).toBe(111);
    expect(opened.layoutReplaced).toBe(true);
  });

  it("a card for a record made by an unsaved loose end isn't reported gone", async () => {
    put(person("john", 1000));
    const base = { john: tree.get("john") as GrampsRecord };
    const b = new ChangeBuilder(base);
    const martha = newPerson(b, { first: "Martha" });
    linkParentChild(b, "john", martha);
    const file = { ...emptyCaseFile("Scratch", "doug"), cards: [card("john", 1000), card(martha, null)] };
    writeDraft("new:abc", draftOf({ note: null, base }, file, [b.change("Martha")]));
    const opened = await openUnsavedCase("new:abc", "Scratch", "doug");
    expect(opened.gone).toEqual([]);
    expect(applyChanges(opened.base, opened.changes)[martha]).toBeTruthy();
  });

  it("loose ends left unticked at this browser's own Save are kept with their cards", async () => {
    const { file, note } = setup();
    const base = { john: tree.get("john") as GrampsRecord };
    const b = new ChangeBuilder(base);
    const martha = newPerson(b, { first: "Martha" });
    writeDraft("case1", { ...draftOf({ note, base }, { ...file, cards: [...file.cards, card(martha, null, 300)] }, [b.change("Martha")]), noteChange: AFTER_OWN_SAVE });
    putNote(file, NOTE_CHANGE + 100); // the save's own new time, unknown when the draft was written
    const opened = await openCase("case1");
    expect(opened.layoutReplaced).toBe(false);
    expect(opened.file.cards.map((c) => c.handle)).toEqual(["john", martha]);
    expect(opened.gone).toEqual([]);
    expect(opened.changes).toHaveLength(1);
  });

  it("a case never saved opens from its draft, or empty", async () => {
    put(person("john", 1000));
    const empty = await openUnsavedCase("new:abc", "Scratch", "doug");
    expect(empty.file).toMatchObject({ name: "Scratch", startedBy: "doug", cards: [] });
    writeDraft("new:abc", draftOf({ note: null, base: {} }, { ...empty.file, cards: [card("john", 1000)] }, []));
    const again = await openUnsavedCase("new:abc", "Scratch", "doug");
    expect(again.note).toBeNull();
    expect(Object.keys(again.base)).toEqual(["john"]);
  });
});
