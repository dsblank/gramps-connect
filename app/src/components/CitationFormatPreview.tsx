import { useEffect, useState } from "react";
import { Stack, Text } from "@mantine/core";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { API_BASE } from "../config";
import { getToken } from "../auth/auth";
import { apiFetch } from "../store/apiFetch";
import type { CitationFormatter } from "../store/displaySettings";
import { useDisplayFormatVersion } from "../store/placeIndex";
import { fetchRepositoryName, formattedCitationLines, type SourceFields } from "../store/citationFormat";
import { t } from "../i18n/i18n";

const SAMPLE_COUNT = 3;
/** Citations looked through for samples -- enough that some usually have
 * a repository, so switching to Enhanced visibly changes something. */
const CANDIDATE_COUNT = 20;

interface Sample {
  handle: string;
  page?: string;
  date?: GrampsDate;
  confidence?: number;
  source?: SourceFields & { handle?: string; reporef_list?: { ref: string; call_number?: string }[] };
  /** Name of the source's first repository, "" for none. */
  repoName?: string;
}

/** A few of the tree's own citations written out with `formatter`, under
 * Preferences' Citation formatter choice, so switching shows the
 * difference at once. Generated text only: a citation's pasted text isn't
 * affected by the formatter. Fetched once per mount -- the repositories
 * too, though only Enhanced shows them, so switching costs no requests. */
export function CitationFormatPreview({ formatter }: { formatter: CitationFormatter }) {
  useDisplayFormatVersion();
  const [samples, setSamples] = useState<Sample[] | null>(null);

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

  const shown = (samples ?? [])
    .map((s) => {
      const ref = s.source?.reporef_list?.[0];
      const repository = ref && s.repoName !== undefined ? { name: s.repoName, callNumber: ref.call_number } : null;
      return { handle: s.handle, lines: formattedCitationLines(formatter, s, s.source?.handle ? s.source : null, repository) };
    })
    .filter((s) => s.lines.length > 0);
  if (shown.length === 0) return null;

  return (
    <Stack gap={6}>
      <Text size="xs" c="dimmed">{t("Examples from this tree:")}</Text>
      {shown.map(({ handle, lines }) => (
        <Stack key={handle} gap={2}>
          {lines.map((line, i) => (
            <Text key={i} size="sm" pl={i > 0 ? "md" : undefined}>
              {line}
            </Text>
          ))}
        </Stack>
      ))}
    </Stack>
  );
}
