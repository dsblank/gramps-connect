// Citation templates, rendered from the server: formatting selected
// values and asking for them. The syntax (parsing, rendering, the built-in
// templates) is in citationTemplateSyntax.ts.
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { API_BASE } from "../config";
import { getToken } from "../auth/auth";
import { apiFetch } from "./apiFetch";
import { parseErrorMessage } from "./api";
import { formatDisplayDate } from "./placeIndex";
import { GRAMPS_TYPE_TABLES, type GrampsTypeTable } from "../data/grampsTypeTables";
import { parseTemplate, renderTemplateRuns, templateExpressions, type TemplateRun } from "./citationTemplateSyntax";
import { t } from "../i18n/i18n";

export * from "./citationTemplateSyntax";

// gramps.gen.utils.string.conf_strings, by Citation.CONF_*.
const CONFIDENCE_LABELS = ["Very Low", "Low", "Normal", "High", "Very High"];
const CONF_NORMAL = 2;

function typeLabel(raw: { _class?: string; string?: string; value?: number }): string {
  if (raw.string) return raw.string;
  const table = GRAMPS_TYPE_TABLES[raw._class as GrampsTypeTable];
  const name = table && Object.entries(table).find(([, v]) => v === raw.value)?.[0];
  return name && name !== "Custom" && name !== "Unknown" ? t(name) : "";
}

/** A selected value as template text, by its shape: dates in the tree's
 * date format, Gramps types by name, lists joined with ", ". A
 * `confidence` shows its label, and nothing for Normal (Gramps' own
 * reports leave Normal out). Anything else that isn't text or a number
 * (a whole record or ref) shows nothing. */
export function formatTemplateValue(expr: string, raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number") {
    if (/(^|\.)confidence$/.test(expr)) {
      return raw === CONF_NORMAL || !CONFIDENCE_LABELS[raw] ? "" : t(CONFIDENCE_LABELS[raw]);
    }
    return String(raw);
  }
  if (typeof raw === "boolean") return raw ? t("Yes") : "";
  if (Array.isArray(raw)) {
    return raw.map((item) => formatTemplateValue("", item)).filter(Boolean).join(", ");
  }
  if (typeof raw === "object") {
    const obj = raw as { _class?: string };
    if (obj._class === "Date") return formatDisplayDate(raw as GrampsDate);
    if (obj._class?.endsWith("Type")) return typeLabel(obj as { _class: string });
  }
  return "";
}

/** A rejected select's own per-entry messages, naming each expression as
 * the template wrote it (`titel`: unknown field 'titel' on Source -- known
 * fields: ...), or null when the reply isn't that shape. The server keys
 * them by select index, and index 0 is "handle". */
export async function selectErrorMessage(res: Response, exprs: string[]): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: { messages?: { json?: { select?: Record<string, string[]> } } } };
    const perEntry = body.error?.messages?.json?.select;
    if (!perEntry) return null;
    const lines = Object.entries(perEntry).map(([index, messages]) => {
      const expr = exprs[Number(index) - 1];
      const message = (messages ?? []).join(" ").replace(/^invalid select entry .*? as v\d+['"]: /, "");
      return expr ? `\`${expr}\`: ${message}` : message;
    });
    return lines.length ? lines.join("\n") : null;
  } catch {
    return null;
  }
}

/** Raw selected values per handle: one request for all of `handles`. */
export async function selectForHandles(
  endpoint: string,
  handles: string[],
  exprs: string[],
  signal?: AbortSignal,
): Promise<Map<string, Map<string, unknown>>> {
  const result = new Map<string, Map<string, unknown>>();
  if (handles.length === 0 || exprs.length === 0) {
    for (const h of handles) result.set(h, new Map());
    return result;
  }
  // Handles are server-made alphanumerics (see fetchByHandle in api.ts).
  const where = handles.length === 1
    ? `handle == "${handles[0]}"`
    : `handle in [${handles.map((h) => `"${h}"`).join(", ")}]`;
  const token = await getToken();
  const res = await apiFetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      select: ["handle", ...exprs.map((e, i) => `${e} as v${i}`)],
      where_expr: where,
      limit: handles.length,
    }),
    signal,
  });
  if (!res.ok) throw new Error((await selectErrorMessage(res.clone(), exprs)) ?? (await parseErrorMessage(res)));
  const body = (await res.json()) as { items?: Record<string, unknown>[] };
  for (const item of body.items ?? []) {
    result.set(item.handle as string, new Map(exprs.map((e, i) => [e, item[`v${i}`]])));
  }
  return result;
}

/** One line (as styled runs) per handle of the template `source`
 * (written against the records `endpoint` lists). A handle the server
 * didn't return (private, deleted) gets an empty line. */
export async function renderTemplateFor(
  endpoint: string,
  source: string,
  handles: string[],
  signal?: AbortSignal,
): Promise<Map<string, TemplateRun[]>> {
  const nodes = parseTemplate(source);
  const exprs = templateExpressions(nodes);
  const raw = await selectForHandles(endpoint, handles, exprs, signal);
  return new Map(
    handles.map((h) => {
      const values = raw.get(h);
      if (!values) return [h, []];
      return [h, renderTemplateRuns(nodes, new Map(exprs.map((e) => [e, formatTemplateValue(e, values.get(e))])))];
    }),
  );
}
