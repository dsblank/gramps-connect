/**
 * Combines selected GOQL filter presets (see ../data/gqlFilterPresets.ts)
 * into a single `where_expr` string, ready for gramps-web-api's `/query/`
 * endpoint -- one SQL round-trip for the whole combination, not one query
 * per preset. See project_goql_filter_system_design memory: we deliberately
 * don't use gramps-core's Rule/Optimizer handle-set approach (it solves a
 * different problem -- mixing GOQL with ordinary Python Rules inside a
 * desktop GenericFilter) and we never combine presets from two different
 * namespaces in one tree.
 */

import type { GqlFilterNamespace, GqlFilterPreset, GqlPresetParam } from "../data/gqlFilterPresets";
import { GRAMPS_TYPE_TABLES } from "../data/grampsTypeTables";

export interface FilterPresetNode {
  kind: "preset";
  preset: GqlFilterPreset;
  /** Required iff preset.params is non-empty, keyed by each param's `name`. */
  values?: Record<string, string>;
}

export interface FilterAndNode {
  kind: "and";
  children: FilterNode[];
}

export interface FilterOrNode {
  kind: "or";
  children: FilterNode[];
}

export interface FilterNotNode {
  kind: "not";
  child: FilterNode;
}

export type FilterNode = FilterPresetNode | FilterAndNode | FilterOrNode | FilterNotNode;

export class FilterCombineError extends Error {}

/** A bare (optionally negative) whole number -- the only shape allowed
 * into a `type: "integer"` param's substitution below, spliced in raw
 * (unquoted). Rejecting anything else closes off expression injection via
 * a stray operator/paren in a supplied value (this is plain string
 * interpolation into `where_expr` text, not a parameterized query, so the
 * value itself must be shown to be inert before it's spliced in). */
const INTEGER_RE = /^-?\d+$/;

/** Strips quotes/backslashes from a `type: "string"` param's raw value
 * before it's spliced into a `'...'` string literal -- same convention
 * simpleSearch.ts's buildSimpleSearchExpr()/personSearch.ts's
 * buildPersonSearchExpr() already use for user-typed search text, applied
 * here for the same reason: this is plain string interpolation, not a
 * parameterized query, so a raw `'` or `\` in the value could otherwise
 * break out of the literal and inject arbitrary GOQL. Stripping (not
 * escaping) matches those two call sites exactly, rather than introducing
 * a second convention for the same problem. */
function sanitizeTextParam(raw: string): string {
  return raw.replace(/['\\]/g, "");
}

/** A "regex" param's value inside a `'...'` literal: quotes stripped (as
 * for text), backslashes doubled so the pattern's own escapes (`\d`)
 * survive the literal. A doubled backslash can't end the literal, and no
 * quote is left that could. */
function escapeRegexParam(raw: string): string {
  return raw.replace(/'/g, "").replace(/\\/g, "\\\\");
}

const DATETIME_RE = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2})(?:\s+(\d{1,2})(?::(\d{2})(?::(\d{2}))?)?)?)?)?$/;

/** gramps-core's ChangedSinceBase.time_str_to_sec(): a date, optionally
 * with a time, missing parts filled with the earliest value, in local
 * time; Unix seconds, or null if it isn't that shape. */
export function datetimeParamToSeconds(raw: string): number | null {
  const m = DATETIME_RE.exec(raw.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, sec] = m.slice(1).map((v, i) => (v === undefined ? (i === 1 || i === 2 ? 1 : 0) : Number(v)));
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) return null;
  const date = new Date(y, mo - 1, d, h, mi, sec);
  if (date.getMonth() !== mo - 1) return null; // e.g. 2020-02-31
  return Math.floor(date.getTime() / 1000);
}

/** A "gramps-type" param's whole condition: the standard type's value, or
 * the table's Custom value (0 everywhere but FamilyRelType, where it's 4)
 * plus the custom name -- GrampsType's own equality. */
function grampsTypeCondition(param: Extract<GqlPresetParam, { type: "gramps-type" }>, raw: string): string {
  const name = raw.trim();
  const table = GRAMPS_TYPE_TABLES[param.table];
  const value = table[name];
  if (value !== undefined && name !== "Custom") return `(${param.field}.value == ${value})`;
  return `(${param.field}.value == ${table.Custom} and ${param.field}.string == '${sanitizeTextParam(name)}')`;
}

function fillParam(preset: GqlFilterPreset, param: GqlPresetParam, raw: string): string {
  const bad = (why: string) => new FilterCombineError(`"${preset.label}"'s "${param.label}" ${why}`);
  switch (param.type) {
    case "integer":
      if (!INTEGER_RE.test(raw)) throw bad(`must be a whole number (e.g. 1968), got "${raw}"`);
      return raw;
    case "string": {
      const safe = sanitizeTextParam(raw);
      if (safe === "") throw bad("can't be made up of only quotes/backslashes");
      return safe;
    }
    case "regex": {
      try {
        new RegExp(raw);
      } catch {
        throw bad(`isn't a valid regular expression: "${raw}"`);
      }
      const safe = escapeRegexParam(raw);
      if (safe === "") throw bad("can't be made up of only quotes");
      return safe;
    }
    case "datetime": {
      const seconds = datetimeParamToSeconds(raw);
      if (seconds === null) throw bad(`must be a date like 2024-05-01, optionally with a time like 2024-05-01 14:30, got "${raw}"`);
      return String(seconds);
    }
    case "choice":
      if (!param.options.some((o) => o.value === raw)) throw bad(`must be one of the listed choices, got "${raw}"`);
      return raw;
    case "gramps-type":
      if (sanitizeTextParam(raw).trim() === "") throw bad("needs a type");
      return grampsTypeCondition(param, raw);
  }
}

function fillParams(preset: GqlFilterPreset, values: Record<string, string> | undefined): string {
  const params = preset.params ?? [];
  let expr = preset.expr;
  for (const param of params) {
    const raw = values?.[param.name];
    if (raw === undefined || raw === "") {
      throw new FilterCombineError(
        `"${preset.label}" needs a value for "${param.label}"`,
      );
    }
    expr = expr.split(`{${param.name}}`).join(fillParam(preset, param, raw));
  }
  return expr;
}

function renderPreset(node: FilterPresetNode): string {
  if (node.preset.unavailableReason) {
    throw new FilterCombineError(`"${node.preset.label}" can't be used: ${node.preset.unavailableReason}`);
  }
  if (!node.preset.supported) {
    throw new FilterCombineError(
      `"${node.preset.label}" has no GOQL translation yet${
        node.preset.notes ? ` (${node.preset.notes})` : ""
      }`,
    );
  }
  return `(${fillParams(node.preset, node.values)})`;
}

/** Every preset leaf reachable from `node`, for the namespace check below. */
function collectPresets(node: FilterNode, out: FilterPresetNode[] = []): FilterPresetNode[] {
  switch (node.kind) {
    case "preset":
      out.push(node);
      return out;
    case "not":
      return collectPresets(node.child, out);
    case "and":
    case "or":
      for (const child of node.children) {
        collectPresets(child, out);
      }
      return out;
  }
}

function render(node: FilterNode): string {
  switch (node.kind) {
    case "preset":
      return renderPreset(node);
    case "not":
      return `not (${render(node.child)})`;
    case "and":
    case "or": {
      if (node.children.length === 0) {
        throw new FilterCombineError(`an "${node.kind}" group needs at least one condition`);
      }
      if (node.children.length === 1) {
        return render(node.children[0]);
      }
      const joiner = node.kind === "and" ? " and " : " or ";
      return `(${node.children.map(render).join(joiner)})`;
    }
  }
}

export interface CombinedFilter {
  namespace: GqlFilterNamespace;
  whereExpr: string;
}

/**
 * Combines a filter tree into one `where_expr` string. Throws
 * `FilterCombineError` if: the tree is empty, any leaf preset is
 * unsupported (see gqlFilterPresets.ts's `supported: false` entries), a
 * parameterized leaf is missing/has an invalid value, or leaves don't all
 * share one namespace -- combining across namespaces (e.g. a Person preset
 * with a Family preset) is out of scope by design, not just unimplemented.
 */
export function combineFilters(node: FilterNode): CombinedFilter {
  const presets = collectPresets(node);
  if (presets.length === 0) {
    throw new FilterCombineError("no filter presets selected");
  }
  const namespace = presets[0].preset.namespace;
  const mismatched = presets.find((p) => p.preset.namespace !== namespace);
  if (mismatched) {
    throw new FilterCombineError(
      `can't combine a ${namespace} preset ("${presets[0].preset.label}") with a ` +
        `${mismatched.preset.namespace} preset ("${mismatched.preset.label}") in one filter`,
    );
  }
  return { namespace, whereExpr: render(node) };
}
