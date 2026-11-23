import { describe, expect, it } from "vitest";
import { orderTagHandles, planTagOrder, sortTags, TAG_MOVED_KEY, withoutMoveMarker } from "../store/tagOrder";

const tags = [
  { handle: "a", name: "ToDo", priority: 0 },
  { handle: "b", name: "Brick wall", priority: 0 },
  { handle: "c", name: "Complete", priority: 5 },
  { handle: "d", name: "Verified", priority: 2 },
];

const names = (plan: ReturnType<typeof planTagOrder>) => plan.rows.map((r) => r.name);

describe("sortTags", () => {
  it("orders by number, then name for ties", () => {
    expect(sortTags(tags).map((t) => t.handle)).toEqual(["b", "a", "d", "c"]);
  });
});

describe("planTagOrder", () => {
  it("leaves an existing tag and the others alone until it's moved", () => {
    const plan = planTagOrder(tags, { ...tags[3], name: "Checked" }, tags[3]);
    expect(names(plan)).toEqual(["Brick wall", "ToDo", "Checked", "Complete"]);
    expect(plan.selfIndex).toBe(2);
    expect(plan.rows.map((r) => r.newPriority)).toEqual([0, 0, 2, 5]);
    expect(plan.renumbersOthers).toBe(false);
  });

  it("puts a new tag last, one past the highest number", () => {
    const plan = planTagOrder(tags, { handle: "n", name: "New" });
    expect(names(plan)).toEqual(["Brick wall", "ToDo", "Verified", "Complete", "New"]);
    expect(plan.rows[4]).toEqual({ handle: "n", name: "New", oldPriority: undefined, newPriority: 6 });
    expect(plan.renumbersOthers).toBe(false);
  });

  it("numbers a new tag 0 in a tree with no tags", () => {
    expect(planTagOrder([], { handle: "n", name: "First" }).rows[0].newPriority).toBe(0);
  });

  it("renumbers every tag 0..n-1 once moved, collapsing ties and gaps", () => {
    const plan = planTagOrder(tags, { ...tags[2], priority: 1, [TAG_MOVED_KEY]: true }, tags[2]);
    expect(names(plan)).toEqual(["Brick wall", "Complete", "ToDo", "Verified"]);
    expect(plan.selfIndex).toBe(1);
    expect(plan.rows.map((r) => [r.oldPriority, r.newPriority])).toEqual([[0, 0], [5, 1], [0, 2], [2, 3]]);
    expect(plan.renumbersOthers).toBe(true);
  });

  it("renumbers only when another tag's number actually changes", () => {
    const tidy = [
      { handle: "a", name: "A", priority: 0 },
      { handle: "b", name: "B", priority: 1 },
      { handle: "c", name: "C", priority: 2 },
    ];
    const plan = planTagOrder(tidy, { ...tidy[0], priority: 2, [TAG_MOVED_KEY]: true }, tidy[0]);
    expect(names(plan)).toEqual(["B", "C", "A"]);
    expect(plan.rows.map((r) => r.newPriority)).toEqual([0, 1, 2]);
    expect(plan.renumbersOthers).toBe(true);
    const bottom = planTagOrder(tidy, { handle: "n", name: "N", priority: 3, [TAG_MOVED_KEY]: true });
    expect(bottom.renumbersOthers).toBe(false);
  });

  it("clamps a position past the end", () => {
    const plan = planTagOrder(tags, { handle: "n", name: "N", priority: 99, [TAG_MOVED_KEY]: true });
    expect(plan.selfIndex).toBe(4);
  });
});

describe("withoutMoveMarker", () => {
  it("strips only the dialog's marker", () => {
    expect(withoutMoveMarker({ name: "X", priority: 1, [TAG_MOVED_KEY]: true })).toEqual({ name: "X", priority: 1 });
  });
});

describe("orderTagHandles", () => {
  it("lists a record's tags by priority then name, unknown (unsaved) ones last", () => {
    const byHandle = new Map(tags.map((t) => [t.handle, t]));
    expect(orderTagHandles(["c", "new1", "a", "d", "b"], byHandle)).toEqual(["b", "a", "d", "c", "new1"]);
  });
});
