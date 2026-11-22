import { useEffect, useState } from "react";
import { Loader, Stack, Text } from "@mantine/core";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { API_BASE } from "../config";
import { getToken } from "../auth/auth";
import { apiFetch } from "../store/apiFetch";
import type { CitationFormatter } from "../store/displaySettings";
import { useDisplayFormatVersion } from "../store/placeIndex";
import { fetchRepositoryName, formattedCitationLines, type SourceFields } from "../store/citationFormat";
import { renderTemplateFor, type CitationTemplate, type TemplateRun } from "../store/citationTemplate";
import { CitationLinesView, plainLines } from "./related/CitationLines";
import { CITATION_VIEW, SOURCE_VIEW } from "../store/views";
import { t } from "../i18n/i18n";

const SAMPLE_COUNT = 3;
/** Citations looked through for samples -- enough that some usually have
 * a repository, so switching to Enhanced visibly changes something. */
const CANDIDATE_COUNT = 20;
/** Quiet time after typing in a template before the preview asks the
 * server again. */
const TEMPLATE_DEBOUNCE_MS = 400;

interface Sample {
  handle: string;
  page?: string;
  date?: GrampsDate;
  confidence?: number;
  source?: SourceFields & { handle?: string; reporef_list?: { ref: string; call_number?: string }[] };
  /** Name of the source's first repository, "" for none. */
  repoName?: string;
}

/** A few of the tree's own citations written out with a built-in
 * `formatter`, or with `template` when given (a tree template, possibly
 * still being edited), so a change shows at once. Generated text only: a
 * citation's pasted text isn't affected by the formatter. The samples are
 * fetched once per mount, repositories too, so switching built-ins costs no
 * requests; a template costs one request per line (all samples batched),
 * after typing pauses. */
export function CitationFormatPreview({
  formatter,
  template,
  onError,
}: {
  formatter: CitationFormatter;
  template?: CitationTemplate | null;
  /** Told the server's error for `template` (null once it renders). */
  onError?: (error: string | null) => void;
}) {
  useDisplayFormatVersion();
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [templated, setTemplated] = useState<{ lines: Map<string, TemplateRun[][]> | null; error: string | null }>({
    lines: null,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const token = await getToken();
      const res = await apiFetch(`${API_BASE}/api/citations/?page=1&pagesize=${CANDIDATE_COUNT}&extend=all`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!res.ok) return;
      type Row = Sample & { extended?: { source?: Sample["source"] } };
      const all = (await res.json()) as Row[];
      // Citations whose source has a repository first, then ones with a
      // page or date, so both Enhanced's difference and the second line show.
      const score = (row: Row) =>
        (row.extended?.source?.reporef_list?.length ? 2 : 0) + (row.page || row.date?.sortval ? 1 : 0);
      const rows = [...all].sort((a, b) => score(b) - score(a)).slice(0, SAMPLE_COUNT);
      const withRepos = await Promise.all(
        rows.map(async (row) => {
          const source = row.extended?.source;
          const ref = source?.reporef_list?.[0]?.ref;
          const repoName = ref ? await fetchRepositoryName(ref, controller.signal) : undefined;
          return { handle: row.handle, page: row.page, date: row.date, confidence: row.confidence, source, repoName };
        }),
      );
      setSamples(withRepos);
    })().catch(() => {});
    return () => controller.abort();
  }, []);

  const templateSource = template?.source ?? null;
  const templateCitation = template?.citation ?? null;
  useEffect(() => {
    if (templateSource === null || templateCitation === null || !samples) return;
    setTemplated((s) => ({ ...s, error: null }));
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const sourceHandles = [...new Set(samples.map((s) => s.source?.handle).filter((h): h is string => !!h))];
      Promise.all([
        templateSource.trim()
          ? renderTemplateFor(SOURCE_VIEW.endpoint, templateSource, sourceHandles, controller.signal)
          : Promise.resolve(new Map<string, TemplateRun[]>()),
        templateCitation.trim()
          ? renderTemplateFor(CITATION_VIEW.endpoint, templateCitation, samples.map((s) => s.handle), controller.signal)
          : Promise.resolve(new Map<string, TemplateRun[]>()),
      ])
        .then(([sourceLines, citationLines]) =>
          setTemplated({
            lines: new Map(
              samples.map((s) => [
                s.handle,
                [sourceLines.get(s.source?.handle ?? "") ?? [], citationLines.get(s.handle) ?? []].filter((l) => l.length),
              ]),
            ),
            error: null,
          }),
        )
        .catch((e) => {
          if (!controller.signal.aborted) setTemplated({ lines: null, error: e instanceof Error ? e.message : String(e) });
        });
    }, TEMPLATE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [templateSource, templateCitation, samples]);

  const templateError = template ? templated.error : null;
  useEffect(() => {
    onError?.(templateError);
  }, [templateError, onError]);

  if (template && templated.error) {
    return (
      <Text size="xs" c="red" style={{ whiteSpace: "pre-wrap" }}>
        {templated.error}
      </Text>
    );
  }
  if (template && !templated.lines && samples?.length) return <Loader size="xs" />;

  const shown = (samples ?? [])
    .map((s) => {
      if (template) return { handle: s.handle, lines: templated.lines?.get(s.handle) ?? [] };
      const ref = s.source?.reporef_list?.[0];
      const repository = ref && s.repoName !== undefined ? { name: s.repoName, callNumber: ref.call_number } : null;
      return { handle: s.handle, lines: plainLines(formattedCitationLines(formatter, s, s.source?.handle ? s.source : null, repository)) };
    })
    .filter((s) => s.lines.length > 0);
  if (shown.length === 0) return null;

  return (
    <Stack gap={6}>
      <Text size="xs" c="dimmed">{t("Examples from this tree:")}</Text>
      {shown.map(({ handle, lines }) => (
        <CitationLinesView key={handle} lines={lines} />
      ))}
    </Stack>
  );
}
