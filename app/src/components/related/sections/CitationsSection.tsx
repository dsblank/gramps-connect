import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Anchor, Group, Loader, Stack, Text } from "@mantine/core";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { getToken, hasPermissions } from "../../../auth/auth";
import { confirmDialog } from "../../../store/confirmDialog";
import { detachRefListEntry } from "../../../store/refListApi";
import { fetchCitationsWithSources, getCachedCitations, type CitationWithSource } from "../../../store/citationsApi";
import { isEmptyDate } from "../../../store/placeDisplay";
import { STORAGE_KEYS } from "../../../store/storageKeys";
import { CITATION_VIEW } from "../../../store/views";
import { AttachControl } from "../AttachControl";
import { collectCitations, type CollectedCitation, type CitationVia } from "../citationSources";
import { displayDate, summaryLine } from "../summary";
import { SectionShell, RefRow, LINK_STYLE } from "./shared";
import type { OnNavigate, SectionProps } from "../types";
import { t } from "../../../i18n/i18n";

const CONFIDENCE_LABELS = ["Very Low", "Low", "Normal", "High", "Very High"];
const CONF_NORMAL = 2;

function readOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.citationsSectionOpen) === "1";
  } catch {
    return false;
  }
}

function writeOpen(open: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEYS.citationsSectionOpen, open ? "1" : "0");
  } catch {
    // Private window or blocked storage: the section just starts closed.
  }
}

/** Page, date and confidence (when it isn't Normal) -- the source title is
 * already the group heading above. */
function citationLabel(c: CitationWithSource): string {
  const parts: string[] = [];
  if (c.page) parts.push(c.page);
  if (c.date && !isEmptyDate(c.date as GrampsDate)) {
    const text = displayDate(c.date);
    if (text) parts.push(text);
  }
  if (typeof c.confidence === "number" && c.confidence !== CONF_NORMAL) {
    parts.push(t(CONFIDENCE_LABELS[c.confidence] ?? ""));
  }
  return parts.join(" · ") || c.gramps_id || t("(citation)");
}

interface Group_ {
  key: string;
  title: string;
  sourceHandle?: string;
  rows: { citation: CitationWithSource; collected: CollectedCitation }[];
}

function groupBySource(collected: CollectedCitation[], citations: CitationWithSource[]): Group_[] {
  const byHandle = new Map(citations.map((c) => [c.handle, c]));
  const groups = new Map<string, Group_>();
  for (const entry of collected) {
    const citation = byHandle.get(entry.handle);
    // Gone since, or private to this user: the endpoint leaves it out.
    if (!citation) continue;
    const source = citation.extended?.source;
    const key = source?.handle ?? citation.source_handle ?? "";
    let group = groups.get(key);
    if (!group) {
      group = { key, title: source?.title || t("(no source)"), sourceHandle: source?.handle ?? undefined, rows: [] };
      groups.set(key, group);
    }
    group.rows.push({ citation, collected: entry });
  }
  return [...groups.values()].sort((a, b) => {
    if (!a.sourceHandle !== !b.sourceHandle) return a.sourceHandle ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

function ViaLine({ direct, via, onNavigate }: { direct: boolean; via: CitationVia[]; onNavigate: OnNavigate }) {
  if (via.length === 0) return null;
  return (
    <Text size="xs" c="dimmed" pl={18}>
      {direct ? t("also on") : t("on")}{" "}
      {via.map((v, i) => (
        <Fragment key={`${v.label}:${v.handle ?? ""}`}>
          {i > 0 && "; "}
          {v.type && v.handle ? (
            <Anchor component="button" type="button" size="xs" c="dimmed" underline="always" style={LINK_STYLE}
              onClick={() => onNavigate(v.type!, v.handle!)}>
              {v.label}
            </Anchor>
          ) : v.label}
        </Fragment>
      ))}
    </Text>
  );
}

/** Every citation on this record and on the things that belong to it (a
 * person's names, events, addresses, associations...; a family's events
 * and children -- see citationSources.ts), grouped by source, the way
 * Gramps desktop's Citations gramplet shows them.
 *
 * The record's own detail request only carries citations without their
 * source, so showing them takes one more request. The section therefore
 * starts closed with just a count (worked out from data already loaded),
 * fetches only while open, and remembers open/closed per browser. "−"
 * removes only the record's own citations; one on an event belongs to that
 * event and is removed from its page. */
export function CitationsSection({ view, detail, onNavigate, onRefetch }: SectionProps) {
  const collected = useMemo(() => collectCitations(detail), [detail]);
  const handles = useMemo(() => collected.map((c) => c.handle), [collected]);
  const handlesKey = handles.join(",");
  const canAttach = hasPermissions("EditObject");
  const [open, setOpen] = useState(readOpen);
  const [citations, setCitations] = useState<CitationWithSource[] | null>(() => getCachedCitations(handles) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!open || handles.length === 0) return;
    const cached = getCachedCitations(handles);
    if (cached) {
      setCitations(cached);
      setError(null);
      return;
    }
    setCitations(null);
    setError(null);
    const controller = new AbortController();
    (async () => {
      try {
        const token = await getToken();
        const result = await fetchCitationsWithSources(token, handles, controller.signal);
        if (!controller.signal.aborted) setCitations(result);
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => controller.abort();
    // handlesKey stands in for `handles` (a new array on every detail fetch).
  }, [open, handlesKey, retry]);

  if (collected.length === 0 && !canAttach) return null;

  function toggle() {
    setOpen((o) => {
      writeOpen(!o);
      return !o;
    });
  }

  async function handleRemove(handle: string, target: unknown) {
    const summary = summaryLine("citation", target) || "this citation";
    if (!(await confirmDialog(`Remove ${summary} from this ${view.key}? This does not delete the citation itself.`))) return;
    const token = await getToken();
    await detachRefListEntry(token, view, detail.handle, "citation_list", handle);
    onRefetch?.();
  }

  let body: ReactNode = null;
  if (open && collected.length > 0) {
    if (error) {
      body = (
        <Group gap="xs">
          <Text size="sm" c="red">{error}</Text>
          <Anchor component="button" type="button" size="sm" onClick={() => setRetry((n) => n + 1)}>{t("Retry")}</Anchor>
        </Group>
      );
    } else if (!citations) {
      body = <Loader size="xs" />;
    } else {
      body = groupBySource(collected, citations).map((group) => (
        <Stack key={group.key} gap={4}>
          {group.sourceHandle ? (
            <RefRow type="source" handle={group.sourceHandle} obj={null} label={group.title} onNavigate={onNavigate} />
          ) : (
            <Text size="md" c="dimmed">{group.title}</Text>
          )}
          <Stack gap={4} pl="md">
            {group.rows.map(({ citation, collected: entry }) => (
              <Stack key={citation.handle} gap={0}>
                <RefRow
                  type="citation"
                  handle={citation.handle}
                  obj={citation}
                  label={citationLabel(citation)}
                  onNavigate={onNavigate}
                  onRemove={canAttach && entry.direct ? () => handleRemove(citation.handle, citation) : undefined}
                />
                <ViaLine direct={entry.direct} via={entry.via} onNavigate={onNavigate} />
              </Stack>
            ))}
          </Stack>
        </Stack>
      ));
    }
  }

  return (
    <SectionShell
      label={t("Citations")}
      // Nothing to show or hide: a plain label (with just the "+").
      open={open}
      onToggle={collected.length > 0 ? toggle : undefined}
      count={collected.length}
      action={canAttach && (
        <AttachControl
          targetView={view}
          targetHandle={detail.handle}
          pickerView={CITATION_VIEW}
          listField="citation_list"
          itemLabel="a citation"
          createType="citation"
          onAttached={() => {
            if (!open) {
              setOpen(true);
              writeOpen(true);
            }
            onRefetch?.();
          }}
        />
      )}
    >
      {body}
    </SectionShell>
  );
}
