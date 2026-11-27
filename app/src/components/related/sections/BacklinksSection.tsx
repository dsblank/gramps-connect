import { useEffect, useMemo, useState } from "react";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { getToken } from "../../../auth/auth";
import { fetchEventPrincipals, getCachedEventPrincipals } from "../../../store/eventPrincipals";
import { getBacklinks, type ObjectDetail } from "../../../store/objectDetail";
import { isEmptyDate } from "../../../store/placeDisplay";
import { displayDate, summaryLine, summaryText, withGrampsId } from "../summary";
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

/** An event row with whom the event is of: "Birth: 1926 · John Smith".
 * `names` arrives after the row first renders (one follow-up request for
 * all event rows); until then, or when it has none, the usual summary. */
function eventLabel(obj: any, names: string[] | undefined): string | undefined {
  if (!names || names.length === 0) return undefined;
  // "; " between people: the name format may itself contain a comma
  // ("Smith, John").
  return `${summaryLine("event", obj)} · ${names.join("; ")}`;
}

/** A person who refers to this person through an association: their name
 * with the association's own description, "Jane Doe (Godmother)". A
 * person row on any other record (or a blank description) keeps the
 * usual summary. */
function associationLabel(detail: ObjectDetail, obj: any): string | undefined {
  const refs = (obj.person_ref_list as { ref?: string; rel?: string }[] | undefined) ?? [];
  const rels = refs.filter((r) => r.ref === detail.handle && r.rel?.trim()).map((r) => r.rel!.trim());
  if (rels.length === 0) return undefined;
  return `${summaryLine("person", obj)} (${[...new Set(rels)].join("; ")})`;
}

/** Principal names for the event rows, keyed by event handle -- see
 * store/eventPrincipals.ts. Empty while loading or if the lookup fails:
 * the rows just keep their plain summary. */
function useEventPrincipals(eventHandles: string[]): Record<string, string[]> {
  const key = eventHandles.join(",");
  const handles = useMemo(() => eventHandles, [key]);
  const [loaded, setLoaded] = useState<{ key: string; names: Record<string, string[]> } | null>(null);
  useEffect(() => {
    if (handles.length === 0 || getCachedEventPrincipals(handles)) return;
    const controller = new AbortController();
    getToken()
      .then((token) => fetchEventPrincipals(token, handles, controller.signal))
      .then((names) => setLoaded({ key, names }))
      .catch(() => {
        // Aborted, or the server refused: rows keep their plain summary.
      });
    return () => controller.abort();
  }, [handles, key]);
  if (handles.length === 0) return {};
  return getCachedEventPrincipals(handles) ?? (loaded?.key === key ? loaded.names : {});
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
  const principals = useEventPrincipals(((backlinks.event ?? []) as { handle: string }[]).map((e) => e.handle));
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
              label={
                type === "citation" ? citationLabel(detail, obj)
                : type === "event" ? eventLabel(obj, principals[obj.handle])
                : type === "person" ? associationLabel(detail, obj)
                : undefined
              }
            />
          ))}
        </div>
      ))}
    </SectionShell>
  );
}
