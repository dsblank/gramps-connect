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

import type { GqlFilterNamespace, GqlFilterPreset } from "../data/gqlFilterPresets";

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

function fillParams(preset: GqlFilterPreset, values: Record<string, string> | undefined): string {
  const params = preset.params ?? [];
  if (params.length === 0) {
    return preset.expr;
  }
  let expr = preset.expr;
  for (const param of params) {
    const raw = values?.[param.name];
    if (raw === undefined || raw === "") {
      throw new FilterCombineError(
        `"${preset.label}" needs a value for "${param.label}"`,
      );
    }
    if (param.type === "integer" && !INTEGER_RE.test(raw)) {
      throw new FilterCombineError(
        `"${preset.label}"'s "${param.label}" must be a whole number (e.g. 1968), got "${raw}"`,
      );
    }
    const safeValue = param.type === "string" ? sanitizeTextParam(raw) : raw;
    if (safeValue === "") {
      throw new FilterCombineError(
        `"${preset.label}"'s "${param.label}" can't be made up of only quotes/backslashes`,
      );
    }
    expr = expr.split(`{${param.name}}`).join(safeValue);
  }
  return expr;
}

function renderPreset(node: FilterPresetNode): string {
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
