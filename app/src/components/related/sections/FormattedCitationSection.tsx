import { useEffect, useState } from "react";
import { Button, CopyButton, Text } from "@mantine/core";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { API_BASE } from "../../../config";
import { getToken } from "../../../auth/auth";
import { apiFetch } from "../../../store/apiFetch";
import { useDisplaySettings } from "../../../store/displaySettings";
import { useDisplayFormatVersion } from "../../../store/placeIndex";
import { zipRefs } from "../../../store/objectDetail";
import {
  formatCitationText,
  formatSourceText,
  type RepositoryFields,
  type SourceFields,
} from "../../../store/citationFormat";
import { SectionShell } from "./shared";
import type { SectionProps } from "../types";
import { t } from "../../../i18n/i18n";

interface RawSource extends SourceFields {
  handle?: string;
  reporef_list?: { ref: string; call_number?: string }[];
}

/** The record written out as a citation, in the tree's chosen formatter
 * (Preferences > Citations, store/citationFormat.ts): on a Citation, the
 * source line then the page/date/confidence line, as Gramps' report
 * endnotes print them; on a Source, just the source line. Copy puts the
 * same lines on the clipboard. */
export function FormattedCitationSection({ type, detail }: SectionProps) {
  const { citation: { formatter } } = useDisplaySettings();
  useDisplayFormatVersion(); // dates follow the tree's date format

  const source: RawSource | undefined =
    type === "citation" ? (detail.extended?.source as RawSource | undefined) : (detail as RawSource);
  const hasSource = !!source?.handle;

  // Enhanced names the source's first repository. A Source's own detail
  // already carries it (extended.repositories); a Citation's only reaches
  // as far as its source, so fetch that one repository.
  const firstRef = source?.reporef_list?.[0];
  const extendedRepo =
    type === "source" ? (zipRefs(detail.reporef_list, detail.extended?.repositories)[0]?.target as { name?: string } | undefined) : undefined;
  const [fetchedRepo, setFetchedRepo] = useState<{ handle: string; name: string } | null>(null);
  const needFetch = formatter === "enhanced" && type === "citation" && !!firstRef?.ref;
  useEffect(() => {
    if (!needFetch || !firstRef || fetchedRepo?.handle === firstRef.ref) return;
    const controller = new AbortController();
    (async () => {
      const token = await getToken();
      const res = await apiFetch(`${API_BASE}/api/repositories/${encodeURIComponent(firstRef.ref)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!res.ok) return;
      const repo = (await res.json()) as { name?: string };
      setFetchedRepo({ handle: firstRef.ref, name: repo.name ?? "" });
    })().catch(() => {});
    return () => controller.abort();
  }, [needFetch, firstRef, fetchedRepo]);

  if (!hasSource) return null;

  let repository: RepositoryFields | null = null;
  if (firstRef) {
    const name = type === "source" ? extendedRepo?.name : fetchedRepo?.handle === firstRef.ref ? fetchedRepo.name : undefined;
    if (name !== undefined) repository = { name, callNumber: firstRef.call_number };
  }

  const lines = [formatSourceText(formatter, source, repository)];
  if (type === "citation") {
    lines.push(
      formatCitationText({
        page: detail.page as string | undefined,
        date: detail.date as GrampsDate | undefined,
        confidence: detail.confidence as number | undefined,
      }),
    );
  }
  const shown = lines.filter((line) => line !== "");
  if (shown.length === 0) return null;

  return (
    <SectionShell
      label={type === "citation" ? t("Formatted citation") : t("Formatted source")}
      action={
        <CopyButton value={shown.join("\n")}>
          {({ copied, copy }) => (
            <Button size="compact-xs" variant="subtle" onClick={copy}>
              {copied ? t("Copied") : t("Copy")}
            </Button>
          )}
        </CopyButton>
      }
    >
      {shown.map((line, i) => (
        <Text key={i} size="sm" pl={i > 0 ? "md" : undefined} style={{ userSelect: "text" }}>
          {line}
        </Text>
      ))}
    </SectionShell>
  );
}
