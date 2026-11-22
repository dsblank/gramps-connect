// A list of citations written out as a numbered bibliography, the way
// Gramps' reports print endnotes: each source once, numbered, with the
// citations of it lettered below (1. Source / a. page, date). Drawn for a
// Gramplet's bibliography(...) call (GrampletResultView.tsx). Every
// citation is written exactly as its own panel writes it: manual text,
// else this citation's format, else its source's, else the tree's.
import { useEffect, useMemo, useState } from "react";
import { Group, Loader, Stack, Text } from "@mantine/core";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import {
  chooseCitationFormat,
  useDisplaySettings,
  type CitationFormatChoice,
  type DisplaySettings,
} from "../../store/displaySettings";
import {
  CITATION_TEMPLATE_ATTRIBUTE,
  CITATION_TEXT_ATTRIBUTE,
  attributeText,
  formatCitationText,
  formatSourceText,
} from "../../store/citationFormat";
import { renderTemplateFor, selectForHandles, type TemplateRun } from "../../store/citationTemplate";
import { useDisplayFormatVersion } from "../../store/placeIndex";
import { CITATION_VIEW, SOURCE_VIEW } from "../../store/views";
import { CitationLinesView, CopyCitationButton } from "./CitationLines";
import { ObjectMenu } from "../../pyodidePoc/ObjectCellButton";
import { linesToText } from "../../store/citationTemplateSyntax";
import { t } from "../../i18n/i18n";

/** Handles per request -- a person with hundreds of citations still makes
 * only a few requests. */
const CHUNK = 200;

const CITATION_FIELDS = ["page", "date", "confidence", "attribute_list", "source_handle"];
const SOURCE_FIELDS = ["title", "author", "pubinfo", "abbrev", "attribute_list", "reporef_list", "repositories[0].name"];

interface CitationRow {
  handle: string;
  page?: string;
  date?: GrampsDate;
  confidence?: number;
  attributes: unknown;
  source: string | null;
}

interface SourceRow {
  handle: string;
  title?: string;
  author?: string;
  pubinfo?: string;
  abbrev?: string;
  attributes: unknown;
  callNumber?: string;
  repositoryName?: string | null;
}

/** One numbered entry: a source with its citations, or a citation with
 * manual text (which is a whole citation on its own). */
type Entry =
  | { kind: "source"; source: SourceRow; choice: CitationFormatChoice; citations: { row: CitationRow; choice: CitationFormatChoice }[] }
  | { kind: "manual"; row: CitationRow; text: string };

async function selectChunked(endpoint: string, handles: string[], fields: string[], signal: AbortSignal) {
  const out = new Map<string, Map<string, unknown>>();
  for (let i = 0; i < handles.length; i += CHUNK) {
    const part = await selectForHandles(endpoint, handles.slice(i, i + CHUNK), fields, signal);
    for (const [h, v] of part) out.set(h, v);
  }
  return out;
}

async function renderChunked(endpoint: string, template: string, handles: string[], signal: AbortSignal) {
  const out = new Map<string, TemplateRun[]>();
  for (let i = 0; i < handles.length; i += CHUNK) {
    const part = await renderTemplateFor(endpoint, template, handles.slice(i, i + CHUNK), signal);
    for (const [h, v] of part) out.set(h, v);
  }
  return out;
}

function buildEntries(settings: DisplaySettings, order: string[], citations: Map<string, CitationRow>, sources: Map<string, SourceRow>): Entry[] {
  const entries: Entry[] = [];
  const bySource = new Map<string, Extract<Entry, { kind: "source" }>>();
  for (const handle of order) {
    const row = citations.get(handle);
    if (!row) continue; // private, or deleted since
    const manual = attributeText(row.attributes, CITATION_TEXT_ATTRIBUTE);
    if (manual) {
      entries.push({ kind: "manual", row, text: manual });
      continue;
    }
    const source = row.source ? sources.get(row.source) : undefined;
    if (!source) continue;
    const sourceAsks = attributeText(source.attributes, CITATION_TEMPLATE_ATTRIBUTE);
    const citationAsks = attributeText(row.attributes, CITATION_TEMPLATE_ATTRIBUTE);
    let entry = bySource.get(source.handle);
    if (!entry) {
      entry = { kind: "source", source, choice: chooseCitationFormat(settings, sourceAsks).choice, citations: [] };
      bySource.set(source.handle, entry);
      entries.push(entry);
    }
    entry.citations.push({ row, choice: chooseCitationFormat(settings, citationAsks || sourceAsks).choice });
  }
  return entries;
}

const letter = (i: number) => (i < 26 ? String.fromCharCode(97 + i) : `${String.fromCharCode(97 + Math.floor(i / 26) - 1)}${String.fromCharCode(97 + (i % 26))}`);

/** A source's number or a citation's letter: a link to that record (the
 * same menu a Gramplet table's record cells offer) when `interactive`,
 * plain text otherwise (the editor's preview). The text itself stays
 * plain, so it can be selected and copied. */
function RecordMark({
  text,
  objectType,
  handle,
  label,
  interactive,
  dimmed,
}: {
  text: string;
  objectType: "source" | "citation";
  handle: string;
  label: string;
  interactive: boolean;
  dimmed?: boolean;
}) {
  if (!interactive) {
    return (
      <Text size="sm" c={dimmed ? "dimmed" : undefined} style={{ flexShrink: 0 }}>
        {text}
      </Text>
    );
  }
  return (
    <ObjectMenu objectType={objectType} handle={handle} label={label}>
      <Text
        component="button"
        size="sm"
        aria-label={`${text} ${label}`}
        style={{
          flexShrink: 0,
          cursor: "pointer",
          background: "none",
          border: "none",
          padding: 0,
          color: "var(--mantine-color-blue-6)",
        }}
      >
        {text}
      </Text>
    </ObjectMenu>
  );
}

export function CitationBibliography({
  handles,
  title,
  interactive = false,
}: {
  handles: string[];
  title: string | null;
  /** Numbers and letters open their record (not in the editor's preview). */
  interactive?: boolean;
}) {
  const settings = useDisplaySettings();
  useDisplayFormatVersion();
  const [data, setData] = useState<{ citations: Map<string, CitationRow>; sources: Map<string, SourceRow> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handlesKey = handles.join(",");

  // The citations, then their sources: two batched requests.
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(null);
    (async () => {
      const rawCitations = await selectChunked(CITATION_VIEW.endpoint, handles, CITATION_FIELDS, controller.signal);
      const citations = new Map<string, CitationRow>();
      for (const [handle, v] of rawCitations) {
        citations.set(handle, {
          handle,
          page: v.get("page") as string | undefined,
          date: v.get("date") as GrampsDate | undefined,
          confidence: v.get("confidence") as number | undefined,
          attributes: v.get("attribute_list"),
          source: (v.get("source_handle") as string) || null,
        });
      }
      const sourceHandles = [...new Set([...citations.values()].map((c) => c.source).filter((h): h is string => !!h))];
      const rawSources = await selectChunked(SOURCE_VIEW.endpoint, sourceHandles, SOURCE_FIELDS, controller.signal);
      const sources = new Map<string, SourceRow>();
      for (const [handle, v] of rawSources) {
        const refs = v.get("reporef_list") as { call_number?: string }[] | undefined;
        sources.set(handle, {
          handle,
          title: v.get("title") as string | undefined,
          author: v.get("author") as string | undefined,
          pubinfo: v.get("pubinfo") as string | undefined,
          abbrev: v.get("abbrev") as string | undefined,
          attributes: v.get("attribute_list"),
          callNumber: refs?.[0]?.call_number,
          repositoryName: (v.get("repositories[0].name") as string | null | undefined) ?? null,
        });
      }
      setData({ citations, sources });
    })().catch((e) => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    });
    return () => controller.abort();
    // handlesKey stands for handles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handlesKey]);

  const entries = useMemo(
    () => (data ? buildEntries(settings, handles, data.citations, data.sources) : null),
    // handlesKey stands for handles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, settings, handlesKey],
  );

  // Template lines, one batched request per template and line.
  const [templated, setTemplated] = useState<{ sources: Map<string, TemplateRun[]>; citations: Map<string, TemplateRun[]> } | null>(null);
  useEffect(() => {
    if (!entries) return;
    const controller = new AbortController();
    setTemplated(null);
    const sourceJobs = new Map<string, { template: string; handles: string[] }>();
    const citationJobs = new Map<string, { template: string; handles: string[] }>();
    for (const entry of entries) {
      if (entry.kind !== "source") continue;
      const st = entry.choice.template;
      if (st?.source.trim()) {
        const job = sourceJobs.get(st.id) ?? { template: st.source, handles: [] };
        job.handles.push(entry.source.handle);
        sourceJobs.set(st.id, job);
      }
      for (const { row, choice } of entry.citations) {
        const ct = choice.template;
        if (!ct?.citation.trim()) continue;
        const job = citationJobs.get(ct.id) ?? { template: ct.citation, handles: [] };
        job.handles.push(row.handle);
        citationJobs.set(ct.id, job);
      }
    }
    // Keyed by template id + handle, since one record can't use two formats here.
    (async () => {
      const sources = new Map<string, TemplateRun[]>();
      const citations = new Map<string, TemplateRun[]>();
      await Promise.all([
        ...[...sourceJobs].map(async ([id, job]) => {
          for (const [h, runs] of await renderChunked(SOURCE_VIEW.endpoint, job.template, job.handles, controller.signal)) {
            sources.set(`${id}\u0000${h}`, runs);
          }
        }),
        ...[...citationJobs].map(async ([id, job]) => {
          for (const [h, runs] of await renderChunked(CITATION_VIEW.endpoint, job.template, job.handles, controller.signal)) {
            citations.set(`${id}\u0000${h}`, runs);
          }
        }),
      ]);
      setTemplated({ sources, citations });
    })().catch((e) => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    });
    return () => controller.abort();
  }, [entries]);

  if (error) return <Text size="sm" c="red">{error}</Text>;
  if (!entries || !templated) return <Loader size="sm" />;
  if (entries.length === 0) {
    return <Text size="sm" c="dimmed">{t("No citations to list.")}</Text>;
  }

  const sourceLine = (entry: Extract<Entry, { kind: "source" }>): TemplateRun[] => {
    const tpl = entry.choice.template;
    if (tpl) return templated.sources.get(`${tpl.id}\u0000${entry.source.handle}`) ?? [];
    const s = entry.source;
    const repository = s.repositoryName != null ? { name: s.repositoryName, callNumber: s.callNumber } : null;
    const text = formatSourceText(entry.choice.formatter ?? "legacy", s, repository);
    return text ? [{ text }] : [];
  };
  const citationLine = (row: CitationRow, choice: CitationFormatChoice): TemplateRun[] => {
    if (choice.template) return templated.citations.get(`${choice.template.id}\u0000${row.handle}`) ?? [];
    const text = formatCitationText({ page: row.page, date: row.date, confidence: row.confidence });
    return text ? [{ text }] : [];
  };

  // What's shown, and the same thing as lines for Copy.
  const blocks = entries.map((entry, i) => {
    const number = `${i + 1}.`;
    if (entry.kind === "manual") {
      return {
        number,
        head: [{ text: entry.text }] as TemplateRun[],
        target: { objectType: "citation" as const, handle: entry.row.handle },
        subs: [] as { letter: string; line: TemplateRun[]; handle: string }[],
      };
    }
    const subs = entry.citations
      .map(({ row, choice }) => ({ line: citationLine(row, choice), handle: row.handle }))
      .filter((sub) => sub.line.length)
      .map((sub, j) => ({ ...sub, letter: `${letter(j)}.` }));
    return { number, head: sourceLine(entry), target: { objectType: "source" as const, handle: entry.source.handle }, subs };
  });
  const INDENT = "    ";
  const copyLines: TemplateRun[][] = [
    ...(title ? [[{ text: title, bold: true }]] : []),
    ...blocks.flatMap((b) => [
      [{ text: `${b.number} ` }, ...b.head],
      ...b.subs.map((sub) => [{ text: `${INDENT}${sub.letter} ` }, ...sub.line]),
    ]),
  ];

  return (
    <Stack gap="xs">
      <Group justify="space-between" wrap="nowrap">
        {title ? <Text fw={600}>{title}</Text> : <span />}
        <CopyCitationButton lines={copyLines} />
      </Group>
      {blocks.map((b) => (
        <Group key={b.number} gap="xs" wrap="nowrap" align="flex-start">
          <Group w="2.5em" justify="flex-end" style={{ flexShrink: 0 }}>
            <RecordMark
              text={b.number}
              objectType={b.target.objectType}
              handle={b.target.handle}
              label={linesToText([b.head])}
              interactive={interactive}
            />
          </Group>
          <Stack gap={2} style={{ minWidth: 0 }}>
            <CitationLinesView lines={[b.head]} />
            {b.subs.map((sub) => (
              <Group key={sub.letter} gap={6} wrap="nowrap" align="flex-start">
                <RecordMark
                  text={sub.letter}
                  objectType="citation"
                  handle={sub.handle}
                  label={linesToText([sub.line])}
                  interactive={interactive}
                  dimmed
                />
                <CitationLinesView lines={[sub.line]} />
              </Group>
            ))}
          </Stack>
        </Group>
      ))}
    </Stack>
  );
}
