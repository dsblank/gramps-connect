// "Color by filter" in the charts: which saved Person filters there are,
// compiled the same way the Filters dialog compiles them, and which of a
// chart's people match one.
import { gqlFilterPresets } from "../data/gqlFilterPresets";
import { fetchPage } from "./api";
import { loadBookmarks } from "./bookmarks";
import { buildContextPresets, handleListExpr, SAVED_FILTER_PRESET_PREFIX } from "./contextPresets";
import { customRuleAsPreset, refreshCustomRules } from "./customRuleMedia";
import { expandColumnRefs } from "./goqlColumnRefs";
import { fetchSavedFilters } from "./savedFilterMedia";
import { PERSON_VIEW } from "./views";

export interface ChartFilter {
  id: string;
  name: string;
  /** The compiled GOQL, or null when it can't be compiled right now. */
  whereExpr: string | null;
  /** Why it can't be compiled (a missing rule, a filter that uses itself). */
  error: string | null;
}

/** The tree's saved Person filters. Each is compiled through the same
 * preset catalog the Filters dialog uses -- built-in rules, Custom Rules,
 * bookmarks, the home person and other saved filters -- so a filter
 * colors exactly the people it lists in People. */
export async function loadChartFilters(token: string): Promise<ChartFilter[]> {
  const [rules, saved] = await Promise.all([refreshCustomRules(), fetchSavedFilters()]);
  // Only needed by filters using "Bookmarked"; without them those report
  // an error instead of failing the whole list.
  await loadBookmarks(token).catch(() => undefined);
  const base = [...gqlFilterPresets, ...rules.map(customRuleAsPreset)];
  const compiled = new Map(buildContextPresets(base, saved).map((p) => [p.id, p]));
  return saved
    .filter((f) => f.namespace === "Person")
    .map((f) => {
      const preset = compiled.get(SAVED_FILTER_PRESET_PREFIX + f.id);
      const error = preset ? (preset.unavailableReason ?? null) : "couldn't be compiled";
      return { id: f.id, name: f.name, whereExpr: error ? null : preset!.expr, error };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Handles per request: keeps each `handle in [...]` well inside what the
 * server accepts in one body. */
const CHUNK = 500;

/** Which of `handles` match `whereExpr` -- one query per CHUNK handles,
 * asking only for handles back. Throws the server's message for a GOQL
 * error, so a typed query can say what's wrong with it. */
export async function fetchMatchingHandles(
  token: string,
  whereExpr: string,
  handles: readonly string[],
): Promise<Set<string>> {
  const matched = new Set<string>();
  // A typed query can name People columns (`Grandchildren`).
  const expanded = expandColumnRefs(whereExpr, PERSON_VIEW.key);
  for (let i = 0; i < handles.length; i += CHUNK) {
    const expr = `(${expanded}) and ${handleListExpr(handles.slice(i, i + CHUNK))}`;
    let after: string | null = null;
    do {
      const { page } = await fetchPage(PERSON_VIEW, token, after, false, expr, PERSON_VIEW.orderBy, CHUNK, []);
      for (const item of page.items) matched.add(item.handle);
      after = page.next_after;
    } while (after);
  }
  return matched;
}
