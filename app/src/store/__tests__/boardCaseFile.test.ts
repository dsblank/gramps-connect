import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getToken: vi.fn(async () => "tok"), hasPermissions: vi.fn(() => true) }));
vi.mock("../../auth/auth", () => auth);
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("../apiFetch", () => ({ apiFetch }));
vi.mock("../grampsIds", () => ({
  assignGrampsIds: vi.fn(async (_t: string, objects: Record<string, unknown>[]) => ({
    objects: objects.map((o, i) => ({ ...o, gramps_id: `${o._class === "Note" ? "N" : "I"}90${i}` })),
    assigned: objects.length,
  })),
}));

import {
  CaseFileFormatError,
  emptyCaseFile,
  isCaseFileNote,
  newCaseFileNote,
  parseCaseFile,
  readCaseFileNote,
  serializeCaseFile,
  type CaseFile,
} from "../board/caseFile";
import { ChangeBuilder } from "../board/changes";
import { linkParentChild, newPerson } from "../board/links";
import { blank, GENDER, type GrampsRecord, type Records } from "../board/records";
import { saveBoard } from "../board/save";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const sent = () => JSON.parse((apiFetch.mock.calls[0][1] as RequestInit).body as string) as { type: string; _class: string; old: unknown; new: GrampsRecord }[];

function base(): Records {
  const john = blank<GrampsRecord>("Person", { handle: "john", gramps_id: "I0001", gender: GENDER.MALE, family_list: ["F1"] });
  const f1 = blank<GrampsRecord>("Family", { handle: "F1", gramps_id: "F0001", father_handle: "john" });
  const david = blank<GrampsRecord>("Person", { handle: "david", gramps_id: "I0002", gender: GENDER.MALE });
  return { john, F1: f1, david };
}

function caseWith(cards: [string, string, number][]): CaseFile {
  return {
    ...emptyCaseFile("Miller case", "Doug"),
    question: "Who were John's parents?",
    cards: cards.map(([handle, cls, seen], i) => ({ handle, class: cls as "Person", gramps_id: "", label: handle, seenChange: seen, x: i * 260, y: 40, size: "compact" as const })),
    stickies: [{ id: "s1", text: "Ask Aunt Martha", x: 0, y: 300 }],
  };
}

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (_url: string, init: RequestInit) => json(JSON.parse(init.body as string)));
  auth.hasPermissions.mockReturnValue(true);
});

describe("the case-file format", () => {
  it("round-trips, and the Note is typed so the list view can find it", () => {
    const file = caseWith([["john", "Person", 1000]]);
    expect(parseCaseFile(serializeCaseFile(file))).toEqual(file);
    const note = newCaseFileNote();
    expect(isCaseFileNote(note)).toBe(true);
    expect(isCaseFileNote(blank<GrampsRecord>("Note", { handle: "n", gramps_id: "N1" }))).toBe(false);
  });

  it("opens leniently: unknown fields ignored, defaults filled in, nonsense cards dropped", () => {
    const file = parseCaseFile(
      JSON.stringify({ version: 1, name: "Old case", futureField: 1, cards: [{ handle: "john", class: "Person", size: "huge" }, { class: "Person" }, { handle: "x", class: "Spaceship" }] }),
    );
    expect(file.cards).toHaveLength(1);
    expect(file.cards[0]).toMatchObject({ handle: "john", size: "compact", seenChange: 0, x: 0 });
    expect(file).toMatchObject({ question: "", stickies: [], startedBy: "" });
  });

  it("keeps which cards a sticky note is about, dropping junk and repeats", () => {
    const file = parseCaseFile(
      JSON.stringify({ version: 1, stickies: [{ id: "s1", text: "Signatures?", about: ["m1", "m2", "m1", 7, ""] }, { id: "s2", text: "Loose" }] }),
    );
    expect(file.stickies[0].about).toEqual(["m1", "m2"]);
    expect(file.stickies[1].about).toBeUndefined();
    const linked = { ...caseWith([["john", "Person", 1000]]), stickies: [{ id: "s1", text: "Him?", x: 0, y: 0, about: ["john"] }] };
    expect(parseCaseFile(serializeCaseFile(linked))).toEqual(linked);
  });

  it("refuses text that isn't a case file", () => {
    expect(() => parseCaseFile("not json")).toThrow(CaseFileFormatError);
    expect(() => parseCaseFile("[1,2]")).toThrow(CaseFileFormatError);
    expect(() => parseCaseFile('{"name":"no version"}')).toThrow(/format version/);
    expect(() => readCaseFileNote(blank<GrampsRecord>("Note", { handle: "n", gramps_id: "N1" }))).toThrow(/isn't a case file/);
  });
});

describe("saving a case file with the board", () => {
  it("a new case file is added in the same transaction, with its cards' new IDs and 'as of this save' marks", async () => {
    const records = base();
    const b = new ChangeBuilder(records);
    const martha = newPerson(b, { first: "Martha", gender: "F" });
    linkParentChild(b, "john", martha);
    const file = caseWith([["john", "Person", 1000], ["F1", "Family", 1000], ["david", "Person", 1000], [martha, "Person", 0]]);
    const saved = await saveBoard(records, [b.change("Martha")], "Evidence Board: Miller case", { caseFile: { note: null, content: file, private: true } });

    expect(apiFetch).toHaveBeenCalledTimes(1); // one transaction for everything
    const items = sent();
    expect(items.map((i) => `${i.type} ${i._class}`)).toEqual(["add Person", "update Family", "add Note"]);
    const note = items[2].new;
    expect(note.gramps_id).toBe("N901");
    expect(note.private).toBe(true);
    expect(isCaseFileNote(note)).toBe(true);
    const content = readCaseFileNote(note);
    const card = (h: string) => content.cards.find((c) => c.handle === h)!;
    expect(card(martha)).toMatchObject({ gramps_id: "I900", seenChange: null }); // created by this save
    expect(card("F1").seenChange).toBeNull(); // changed by this save
    expect(card("david").seenChange).toBe(1000); // untouched: keeps what was seen
    expect(content.question).toBe("Who were John's parents?");
    expect(saved!.caseNote!.handle).toBe(note.handle);
  });

  it("an existing case file is updated, with the note as loaded as `old`", async () => {
    const records = base();
    const loaded: GrampsRecord = { ...newCaseFileNote(), gramps_id: "N0005" };
    const before = { ...loaded, text: { ...(loaded.text as object), string: serializeCaseFile(caseWith([["john", "Person", 1000]])) } };
    const moved = caseWith([["john", "Person", 1000]]);
    moved.cards[0].x = 999;
    await saveBoard(records, [], "Evidence Board: Miller case", { caseFile: { note: before, content: moved } });
    const items = sent();
    expect(items.map((i) => `${i.type} ${i._class}`)).toEqual(["update Note"]); // moving a card saves only the case file
    expect(items[0].old).toEqual(before);
    expect(readCaseFileNote(items[0].new).cards[0].x).toBe(999);
  });

  it("nothing changed on the board or in the tree: nothing is sent", async () => {
    const file = caseWith([["john", "Person", 1000]]);
    const note = { ...newCaseFileNote(), gramps_id: "N0005", text: { _class: "StyledText", string: serializeCaseFile(file), tags: [] } };
    expect(await saveBoard(base(), [], "x", { caseFile: { note, content: file } })).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
