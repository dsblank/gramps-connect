import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "../activityLog";
import type { EditEntry } from "../activityEdits";
import { buildSessions, collapseRuns, formatDuration, SESSION_GAP_SECONDS } from "../activityTimeline";

const open = (handle: string, at: number, viewKey = "person"): ActivityEntry => ({ kind: "route", viewKey, handle, at });
const edit = (handle: string, at: number, txId = at): EditEntry => ({
  kind: "edit", at, txId, undo: false, changes: [{ type: "person", handle, op: "edited" }],
});

describe("buildSessions", () => {
  it("times each step until the next one, newest first", () => {
    const [session] = buildSessions([open("A", 0), open("B", 100), open("C", 400)], []);
    expect(session.items.map((it) => [(it.entry as { handle: string }).handle, it.duration])).toEqual([
      ["C", undefined],
      ["B", 300],
      ["A", 100],
    ]);
    expect(session.start).toBe(0);
    expect(session.end).toBe(400);
  });

  it("ends a step when the tab is hidden, and lists nothing for being away", () => {
    const [session] = buildSessions(
      [open("A", 0), { kind: "away", at: 60 }, open("B", 600)],
      [],
    );
    expect(session.items.map((it) => it.entry.kind)).toEqual(["route", "route"]);
    expect(session.items[1].duration).toBe(60);
  });

  it("splits sessions on a long pause and caps the step before it", () => {
    const later = SESSION_GAP_SECONDS + 1000;
    const sessions = buildSessions([open("A", 0), open("B", later)], []);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].items[0].entry.at).toBe(later);
    expect(sessions[1].items[0].duration).toBe(SESSION_GAP_SECONDS);
  });

  it("puts edits among the steps without cutting the step they were made in", () => {
    const [session] = buildSessions([open("A", 0), open("B", 500)], [edit("A", 200)]);
    expect(session.items.map((it) => it.entry.kind)).toEqual(["route", "edit", "route"]);
    expect(session.items[2].duration).toBe(500);
    expect(session.items[1].duration).toBeUndefined();
  });

  it("keeps a hidden page's time out of the list but still ends the step before it", () => {
    const [session] = buildSessions([open("A", 0), { kind: "route", viewKey: "visited", at: 30 }], []);
    expect(session.items).toHaveLength(1);
    expect(session.items[0].duration).toBe(30);
  });

  it("starts a session of edits alone (made on another device)", () => {
    const sessions = buildSessions([], [edit("A", 10), edit("A", 20)]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].items).toHaveLength(2);
  });
});

describe("collapseRuns", () => {
  const items = (...entries: (ActivityEntry | EditEntry)[]) => entries.map((entry) => ({ entry }));

  it("folds three or more records of one type opened in a row", () => {
    const rows = collapseRuns(items(open("A", 1), open("B", 2), open("C", 3), open("D", 4, "place")));
    expect(rows.map((r) => r.kind)).toEqual(["run", "item"]);
    expect(rows[0].kind === "run" && rows[0].items).toHaveLength(3);
  });

  it("leaves two in a row alone", () => {
    expect(collapseRuns(items(open("A", 1), open("B", 2))).map((r) => r.kind)).toEqual(["item", "item"]);
  });

  it("folds repeated edits of one record from two", () => {
    const rows = collapseRuns(items(edit("A", 1), edit("A", 2), edit("B", 3)));
    expect(rows.map((r) => r.kind)).toEqual(["run", "item"]);
  });

  it("never folds searches or lists", () => {
    const search: ActivityEntry = { kind: "searchAll", query: "x", type: null, at: 1 };
    const list: ActivityEntry = { kind: "route", viewKey: "person", at: 2 };
    expect(collapseRuns(items(search, search, search, list, list, list)).every((r) => r.kind === "item")).toBe(true);
  });
});

describe("formatDuration", () => {
  it("reads naturally", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(12 * 60)).toBe("12 min");
    expect(formatDuration(65 * 60)).toBe("1 h 5 min");
    expect(formatDuration(120 * 60)).toBe("2 h");
  });
});
