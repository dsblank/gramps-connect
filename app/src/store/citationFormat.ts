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
import { t } from "../i18n/i18n";

export function citationFormatterLabel(formatter: CitationFormatter): string {
  return formatter === "enhanced" ? t("Enhanced") : t("Legacy");
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
