import type { GrampsDate } from "@gramps-connect/gramps-date";
import { getBacklinks, type ObjectDetail } from "../../../store/objectDetail";
import { isEmptyDate } from "../../../store/placeDisplay";
import { displayDate, summaryText, withGrampsId } from "../summary";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";
import { t } from "../../../i18n/i18n";

const TYPE_LABELS: Record<string, string> = {
  person: "People", family: "Families", event: "Events", place: "Places",
  repository: "Repositories", source: "Sources", citation: "Citations",
  media: "Media", note: "Notes", tag: "Tags",
};

/** A citation backlink's row text, with its date: the usual source title
 * and page, then the date (what tells apart several citations of one
 * source). The source title is left out when it's the record being
 * viewed -- a Source's own citations would otherwise all repeat it. The
 * date is read from the raw backlink (the profile twin getBacklinks swaps
 * in carries it pre-formatted by the server, not per the tree's display
 * settings). */
function citationLabel(detail: ObjectDetail, obj: any): string {
  const raw = (detail.extended?.backlinks as Record<string, any[]> | undefined)?.citation
    ?.find((c) => c?.handle === obj.handle);
  const date = raw?.date as GrampsDate | undefined;
  const dateText = date && !isEmptyDate(date) ? displayDate(date) : "";
  const ownSource = raw?.source_handle === detail.handle;
  const text = ownSource ? (obj.page ?? "") : summaryText("citation", obj).replace(/^\(citation\)$/, "");
  return withGrampsId(obj.gramps_id, [text, dateText].filter(Boolean).join(", ") || "(citation)");
}

/** What points *at* this object, grouped by referencing type -- the one
 * section every object type gets (see RELATED_CONFIG), since 8 of the 10
 * types have thin-to-nonexistent forward references of their own and this
 * is the only place their relationship content comes from. Generic
 * backlinks carry no per-item ref metadata (there's no way to recover
 * which ref-list field or role matched -- see get_backlinks in
 * gramps-web-api's util.py), so these RefRows never show a refMeta badge. */
export function BacklinksSection({ detail, onNavigate }: SectionProps) {
  const backlinks = getBacklinks(detail);
  const types = Object.keys(backlinks).filter((t) => backlinks[t].length > 0);
  if (types.length === 0) return null;
  const total = types.reduce((sum, t) => sum + backlinks[t].length, 0);
  return (
    <SectionShell label={t("Referenced by")}>
      {types.map((type) => (
        <div key={type}>
          <div style={{ fontWeight: 500, fontSize: "var(--mantine-font-size-sm)", opacity: 0.7 }}>
            {TYPE_LABELS[type] ?? type}
          </div>
          {(backlinks[type] as { handle: string }[]).map((obj) => (
            <RefRow
              key={obj.handle} type={type} handle={obj.handle} obj={obj} onNavigate={onNavigate}
              label={type === "citation" ? citationLabel(detail, obj) : undefined}
            />
          ))}
        </div>
      ))}
    </SectionShell>
  );
}
