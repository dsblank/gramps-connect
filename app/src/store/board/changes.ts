// Staged changes ("loose ends") for the Evidence Board, ported from the
// prototype (EVIDENCE_BOARD_PLAN.md, Phase 1). Nothing here talks to the
// server: a board keeps the records it loaded (`base`) plus a list of
// Changes, and the records it shows are `applyChanges(base, changes)`.
// save.ts turns the enabled changes into one transaction.
//
// One user action is one Change. A Change is a list of small steps
// (create a record, set a field, add to a list, remove from a list), so
// it can be stored, shown in plain words (`label`), taken back, or
// unticked on Save. Unticking a Change also unticks every Change that
// uses a record it created (withDependents()).
//
// Board code never writes steps by hand: it calls the helpers in links.ts,
// which keep both sides of every link in step.
import { createHandle } from "../objectsApi";
import { blank, type GrampsClass, type GrampsRecord, type Records } from "./records";

export type Step =
  | { k: "create"; record: GrampsRecord }
  | { k: "set"; h: string; f: string; v: unknown }
  | { k: "push"; h: string; f: string; v: unknown }
  /** Removes list items equal to `v`; with `byRef`, items whose `ref`
   * equals `v` (references such as ChildRef or EventRef, whose other
   * fields the board doesn't know or care about). */
  | { k: "pull"; h: string; f: string; v: unknown; byRef?: boolean };

export interface Change {
  id: string;
  /** What it did, in plain words, for Case notes and the Save list. */
  label: string;
  steps: Step[];
  /** Handles of the records this Change created. */
  creates: string[];
  /** Every handle the Change refers to, for working out dependencies. */
  touches: string[];
  /** Unticked in the Save list. */
  off: boolean;
}

/** Deep equality for JSON values. Key order doesn't matter. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => sameValue(x, bb[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao);
  return keys.length === Object.keys(bo).length && keys.every((k) => k in bo && sameValue(ao[k], bo[k]));
}

function refOf(item: unknown): unknown {
  return item && typeof item === "object" ? (item as { ref?: unknown }).ref : undefined;
}

/** Applies one step to a records map, copying a record before its first
 * change (`owned` remembers which copies are already private). */
function applyStep(records: Records, owned: Set<string>, step: Step): void {
  if (step.k === "create") {
    records[step.record.handle] = structuredClone(step.record);
    owned.add(step.record.handle);
    return;
  }
  if (!records[step.h]) return; // the record is gone (or its creator is unticked)
  if (!owned.has(step.h)) {
    records[step.h] = structuredClone(records[step.h]);
    owned.add(step.h);
  }
  const record = records[step.h];
  if (step.k === "set") {
    record[step.f] = structuredClone(step.v);
  } else if (step.k === "push") {
    const list = Array.isArray(record[step.f]) ? (record[step.f] as unknown[]) : (record[step.f] = []);
    const present = list.some((x) => sameValue(x, step.v) || (refOf(step.v) !== undefined && refOf(x) === refOf(step.v)));
    if (!present) (record[step.f] as unknown[]).push(structuredClone(step.v));
  } else {
    const list = Array.isArray(record[step.f]) ? (record[step.f] as unknown[]) : [];
    record[step.f] = list.filter((x) => !(step.byRef ? refOf(x) === step.v : sameValue(x, step.v)));
  }
}

/** The records the board shows: `base` with every enabled change applied
 * in order. `base` itself is never modified. */
export function applyChanges(base: Records, changes: Change[]): Records {
  const records: Records = { ...base };
  const owned = new Set<string>();
  for (const change of changes) {
    if (change.off) continue;
    for (const step of change.steps) applyStep(records, owned, step);
  }
  return records;
}

/** Builds one Change against the current records. Its get() sees the
 * Change's own steps so far, so a helper can read back what an earlier
 * helper in the same action did (links.ts relies on that to keep a
 * person's birth and death in step with their events). */
export class ChangeBuilder {
  private readonly steps: Step[] = [];
  private readonly created: string[] = [];
  private readonly local: Records;
  private readonly owned = new Set<string>();

  constructor(private readonly records: Records) {
    this.local = { ...records };
  }

  get(handle: string): GrampsRecord | undefined {
    return this.local[handle];
  }

  /** Every record, as this Change so far would leave it. */
  all(): GrampsRecord[] {
    return Object.values(this.local);
  }

  /** A new record of class `cls`. Its Gramps ID is left empty: Save
   * assigns IDs just before saving (save.ts). */
  create(cls: GrampsClass, fields: Record<string, unknown> = {}): string {
    const handle = createHandle();
    const record = blank<GrampsRecord>(cls, { ...fields, handle, gramps_id: "" });
    this.add({ k: "create", record });
    this.created.push(handle);
    return handle;
  }

  set(h: string, f: string, v: unknown): void {
    this.add({ k: "set", h, f, v });
  }

  push(h: string, f: string, v: unknown): void {
    this.add({ k: "push", h, f, v });
  }

  pull(h: string, f: string, v: unknown, byRef = false): void {
    this.add(byRef ? { k: "pull", h, f, v, byRef } : { k: "pull", h, f, v });
  }

  private add(step: Step): void {
    this.steps.push(step);
    applyStep(this.local, this.owned, step);
  }

  /** The finished Change, labelled `label`. Empty if nothing changed. */
  change(label: string): Change {
    const touches = new Set<string>();
    const mention = (value: unknown): void => {
      if (typeof value === "string" && this.local[value]) touches.add(value);
      else if (value && typeof value === "object") {
        const ref = refOf(value);
        if (typeof ref === "string") touches.add(ref);
      }
    };
    for (const step of this.steps) {
      if (step.k === "create") {
        touches.add(step.record.handle);
        for (const f of ["father_handle", "mother_handle", "source_handle", "place"]) mention(step.record[f]);
        continue;
      }
      touches.add(step.h);
      mention(step.v);
    }
    return { id: createHandle(), label, steps: this.steps, creates: this.created, touches: [...touches], off: false };
  }
}

/** The ids of `ids` plus every change that (directly or through others)
 * touches a record one of them created: unticking or taking back a change
 * must take these with it, or they'd point at a record that won't exist. */
export function withDependents(changes: Change[], ids: string[]): Set<string> {
  const drop = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    const created = new Set(changes.filter((c) => drop.has(c.id)).flatMap((c) => c.creates));
    for (const c of changes) {
      if (!drop.has(c.id) && c.touches.some((h) => created.has(h))) {
        drop.add(c.id);
        grew = true;
      }
    }
  }
  return drop;
}

/** Ticks or unticks change `id` in the Save list. Unticking takes its
 * dependents with it; ticking brings back the changes it depends on. */
export function toggleChange(changes: Change[], id: string): Change[] {
  const target = changes.find((c) => c.id === id);
  if (!target) return changes;
  if (!target.off) {
    const drop = withDependents(changes, [id]);
    return changes.map((c) => (drop.has(c.id) ? { ...c, off: true } : c));
  }
  const need = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of changes) {
      if (!need.has(c.id)) continue;
      for (const p of changes) {
        if (!need.has(p.id) && p.creates.some((h) => c.touches.includes(h))) {
          need.add(p.id);
          grew = true;
        }
      }
    }
  }
  return changes.map((c) => (need.has(c.id) ? { ...c, off: false } : c));
}

/** Takes back change `id` and everything that depends on it. */
export function takeBack(changes: Change[], id: string): { changes: Change[]; removed: Change[] } {
  const drop = withDependents(changes, [id]);
  return { changes: changes.filter((c) => !drop.has(c.id)), removed: changes.filter((c) => drop.has(c.id)) };
}
