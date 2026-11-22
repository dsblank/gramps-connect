// Citation text the way Gramps' citation formatters (the `cite` plugin
// category, Preferences > Citation formatter on desktop) write it. Ports of
// the two that exist: gramps/plugins/cite/legacy.py, which ships with
// Gramps, and addons-source's CiteEnhanced/citeenhanced.py, which also
// names the repository and call number. Both write a source part and a
// citation part separately; Gramps' reports print them as two lines of an
// endnote, and so does the Citation panel.
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { formatDisplayDate } from "./placeIndex";
import type { CitationFormatter } from "./displaySettings";
import { API_BASE } from "../config";
import { getToken } from "../auth/auth";
import { apiFetch } from "./apiFetch";
import { t } from "../i18n/i18n";

export function citationFormatterLabel(formatter: CitationFormatter): string {
  return formatter === "enhanced" ? t("Enhanced") : t("Legacy");
}

/** The name of the formatter `citation` settings choose: a built-in's
 * label, or the tree template's own name. */
export function citationFormatterName(citation: { formatter: string; templates: { id: string; name: string }[] }): string {
  const { formatter, templates } = citation;
  if (formatter === "legacy" || formatter === "enhanced") return citationFormatterLabel(formatter);
  return templates.find((tpl) => tpl.id === formatter)?.name ?? citationFormatterLabel("legacy");
}

export interface SourceFields {
  author?: string;
  title?: string;
  pubinfo?: string;
  abbrev?: string;
}

export interface CitationFields {
  page?: string;
  date?: GrampsDate | null;
  confidence?: number;
}

/** The first repository a source is held at, for Enhanced. */
export interface RepositoryFields {
  name?: string;
  callNumber?: string;
}

const CONF_NORMAL = 2;
// gramps.gen.utils.string.conf_strings, indexed by Citation.CONF_*.
const CONFIDENCE_LABELS = ["Very Low", "Low", "Normal", "High", "Very High"];

export function formatSourceText(
  formatter: CitationFormatter,
  source: SourceFields | null | undefined,
  repository?: RepositoryFields | null,
): string {
  if (!source) return "";
  const parts: string[] = [];
  if (formatter === "enhanced" && repository?.name != null) {
    parts.push(repository.callNumber ? `${repository.name} [${repository.callNumber}]` : repository.name);
  }
  if (source.author) parts.push(source.author);
  if (source.title) parts.push(t('"%s"').replace("%s", source.title));
  if (source.pubinfo) parts.push(source.pubinfo);
  if (source.abbrev) parts.push(`(${source.abbrev})`);
  // Gramps only adds ", " after text that's already there -- an empty
  // repository name still counts as "there" for Enhanced, as in Python
  // (src_txt is "" then, so no separator), hence filtering empties first.
  return parts.filter((p) => p !== "").join(t(", "));
}

export function formatCitationText(citation: CitationFields | null | undefined): string {
  if (!citation) return "";
  const date = formatDisplayDate(citation.date);
  const page = citation.page ?? "";
  let text = date ? (page ? `${page} - ${date}` : date) : page;
  const conf = citation.confidence;
  if (conf != null && conf !== CONF_NORMAL && CONFIDENCE_LABELS[conf]) {
    text += ` [${t(CONFIDENCE_LABELS[conf])}]`;
  }
  return text;
}

/** The SrcAttribute type a Citation's own pasted text is kept under --
 * the formatted citation a website hands out (FamilySearch's "Cite this
 * record", Ancestry, WikiTree Sourcer...). When a Citation has one, it is
 * shown as-is instead of the formatter's text, the override Nick Hall
 * suggested for Gramps' formatters (discourse "Citation formatter"). A
 * plain custom attribute, so desktop Gramps keeps and shows it. */
export const CITATION_TEXT_ATTRIBUTE = "Citation text";

/** The SrcAttribute type naming which format a Source's citations use
 * (or, on a Citation, which this one citation uses): a tree template's
 * name, or "Legacy"/"Enhanced". See chooseCitationFormat in
 * displaySettings.ts. A plain custom attribute, so desktop keeps it. */
export const CITATION_TEMPLATE_ATTRIBUTE = "Citation template";

interface RawAttribute {
  type?: unknown;
  value?: unknown;
}

/** An attribute's type name: a plain string from the REST API, or the
 * stored `{"string": ...}` shape a GOQL select returns. */
function attributeTypeName(type: unknown): unknown {
  return type && typeof type === "object" ? (type as { string?: unknown }).string : type;
}

/** The trimmed value of the first attribute of `type`, or "". Takes the
 * REST API's attribute_list or a GOQL select's (stored) one. */
export function attributeText(attributeList: unknown, type: string): string {
  if (!Array.isArray(attributeList)) return "";
  const attr = (attributeList as RawAttribute[]).find((a) => attributeTypeName(a?.type) === type);
  return typeof attr?.value === "string" ? attr.value.trim() : "";
}

/** `attributeList` with the attribute of `type` set to `text`: replaced
 * in place if there is one, appended if not, removed when `text` is
 * empty. Other attributes are left alone. */
export function withAttributeText(attributeList: unknown, type: string, text: string): unknown[] {
  const list = Array.isArray(attributeList) ? [...attributeList] : [];
  const index = list.findIndex((a) => (a as RawAttribute)?.type === type);
  const value = text.trim();
  if (!value) return index < 0 ? list : list.filter((_, i) => i !== index);
  if (index >= 0) list[index] = { ...(list[index] as object), value };
  else list.push({ _class: "SrcAttribute", type, value, private: false });
  return list;
}

/** The Citation's pasted text, or "" when it has none. */
export function pastedCitationText(attributeList: unknown): string {
  return attributeText(attributeList, CITATION_TEXT_ATTRIBUTE);
}

/** `attributeList` with the pasted text set to `text` (removed when empty). */
export function withPastedCitationText(attributeList: unknown, text: string): unknown[] {
  return withAttributeText(attributeList, CITATION_TEXT_ATTRIBUTE, text);
}

/** What the Citation panel shows: the source line, then page/date/
 * confidence -- the two lines of a Gramps report endnote -- with empty
 * lines left out. */
export function formattedCitationLines(
  formatter: CitationFormatter,
  citation: CitationFields | null,
  source: SourceFields | null | undefined,
  repository?: RepositoryFields | null,
): string[] {
  const lines = [formatSourceText(formatter, source, repository)];
  if (citation) lines.push(formatCitationText(citation));
  return lines.filter((line) => line !== "");
}

/** A repository's name, for Enhanced when only its handle is at hand. */
export async function fetchRepositoryName(handle: string, signal?: AbortSignal): Promise<string | undefined> {
  const token = await getToken();
  const res = await apiFetch(`${API_BASE}/api/repositories/${encodeURIComponent(handle)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!res.ok) return undefined;
  const repo = (await res.json()) as { name?: string };
  return repo.name ?? "";
}
