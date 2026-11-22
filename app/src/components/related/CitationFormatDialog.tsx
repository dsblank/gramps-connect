// The Formatted citation section's Format dialog: every format the tree
// offers, each with this record already written out in it, so choosing
// is seeing. Nothing changes until Apply, which sets (or, for the
// default, removes) one "Citation template" attribute.
import { useEffect, useState } from "react";
import { Anchor, Button, Group, Loader, Modal, SegmentedControl, Stack, Text, UnstyledButton } from "@mantine/core";
import { hasPermissions } from "../../auth/auth";
import { openPreferences } from "../../store/preferencesOpener";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import {
  CITATION_FORMATTERS,
  chooseCitationFormat,
  type CitationFormatChoice,
  type DisplaySettings,
} from "../../store/displaySettings";
import {
  citationFormatterLabel,
  citationFormatterName,
  fetchRepositoryName,
  formattedCitationLines,
  type SourceFields,
} from "../../store/citationFormat";
import { renderTemplateFor, type TemplateRun } from "../../store/citationTemplate";
import { CITATION_VIEW, SOURCE_VIEW } from "../../store/views";
import { CitationLinesView, plainLines } from "./CitationLines";
import { t } from "../../i18n/i18n";

export type FormatScope = "source" | "citation";

interface RawSource extends SourceFields {
  handle?: string;
  reporef_list?: { ref: string; call_number?: string }[];
}

interface Option {
  /** What Apply stores: a format's name, or "" for the default. */
  value: string;
  label: string;
  choice: CitationFormatChoice;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function CitationFormatDialog({
  settings,
  isCitation,
  source,
  citationHandle,
  citationFields,
  sourceAsks,
  citationAsks,
  onCancel,
  onApply,
}: {
  settings: DisplaySettings;
  isCitation: boolean;
  source: RawSource;
  citationHandle?: string;
  citationFields: { page?: string; date?: GrampsDate; confidence?: number } | null;
  sourceAsks: string;
  citationAsks: string;
  onCancel: () => void;
  onApply: (scope: FormatScope, name: string) => Promise<void>;
}) {
  const [scope, setScope] = useState<FormatScope>(isCitation && citationAsks ? "citation" : "source");
  const asked = scope === "citation" ? citationAsks : sourceAsks;
  const [selected, setSelected] = useState<string>(asked);
  const [applying, setApplying] = useState(false);
  useEffect(() => setSelected(scope === "citation" ? citationAsks : sourceAsks), [scope, citationAsks, sourceAsks]);

  // Every way the record can be written, whichever option leads to it.
  const named: Option[] = [
    ...CITATION_FORMATTERS.map((f) => ({
      value: citationFormatterLabel(f),
      label: citationFormatterLabel(f),
      choice: { formatter: f, template: null } as CitationFormatChoice,
    })),
    ...settings.citation.templates.map((tpl) => ({
      value: tpl.name,
      label: tpl.name,
      choice: { formatter: null, template: tpl } as CitationFormatChoice,
    })),
  ];
  const fallback: Option =
    scope === "citation"
      ? { value: "", label: t("Same as its source"), choice: chooseCitationFormat(settings, sourceAsks).choice }
      : {
          value: "",
          label: `${t("The tree's format")} (${citationFormatterName(settings.citation)})`,
          choice: chooseCitationFormat(settings, "").choice,
        };
  const options = [fallback, ...named];

  // Enhanced needs the first repository's name.
  const [repoName, setRepoName] = useState<string | null | undefined>(undefined);
  const repoRef = source.reporef_list?.[0];
  useEffect(() => {
    if (!repoRef?.ref) {
      setRepoName(null);
      return;
    }
    const controller = new AbortController();
    fetchRepositoryName(repoRef.ref, controller.signal)
      .then((name) => setRepoName(name ?? null))
      .catch(() => setRepoName(null));
    return () => controller.abort();
  }, [repoRef?.ref]);

  // Each template written for this record: its source line against the
  // source, its citation line against the citation, all at once.
  const [rendered, setRendered] = useState<Map<string, TemplateRun[][] | { error: string }>>(new Map());
  useEffect(() => {
    const controller = new AbortController();
    for (const tpl of settings.citation.templates) {
      Promise.all([
        tpl.source.trim() && source.handle
          ? renderTemplateFor(SOURCE_VIEW.endpoint, tpl.source, [source.handle], controller.signal).then((m) => m.get(source.handle!) ?? [])
          : Promise.resolve([] as TemplateRun[]),
        isCitation && citationHandle && tpl.citation.trim()
          ? renderTemplateFor(CITATION_VIEW.endpoint, tpl.citation, [citationHandle], controller.signal).then((m) => m.get(citationHandle) ?? [])
          : Promise.resolve([] as TemplateRun[]),
      ])
        .then((lines) => setRendered((r) => new Map(r).set(tpl.id, lines.filter((l) => l.length))))
        .catch((e) => {
          if (!controller.signal.aborted) {
            setRendered((r) => new Map(r).set(tpl.id, { error: e instanceof Error ? e.message : String(e) }));
          }
        });
    }
    return () => controller.abort();
  }, [settings.citation.templates, source.handle, citationHandle, isCitation]);

  function linesFor(choice: CitationFormatChoice): TemplateRun[][] | { error: string } | null {
    if (choice.template) return rendered.get(choice.template.id) ?? null;
    if (choice.formatter === "enhanced" && repoName === undefined) return null;
    const repository = repoRef && repoName != null ? { name: repoName, callNumber: repoRef.call_number } : null;
    return plainLines(formattedCitationLines(choice.formatter, citationFields, source, repository));
  }

  const changed = !same(selected, asked) || (selected === "") !== (asked === "");

  return (
    <Modal opened onClose={onCancel} title={t("Auto format")} size="lg">
      <Stack gap="sm">
        {isCitation && (
          <SegmentedControl
            value={scope}
            onChange={(value) => setScope(value as FormatScope)}
            data={[
              { value: "source", label: t("All citations of this source") },
              { value: "citation", label: t("Only this citation") },
            ]}
          />
        )}
        <Text size="xs" c="dimmed">
          {t("Which format writes the citation from its fields. Each one is shown with this record written out in it: pick one, then Apply.")}
        </Text>
        <Stack gap={6}>
          {options.map((option) => {
            const active = option.value === "" ? selected === "" : selected !== "" && same(selected, option.value);
            const lines = linesFor(option.choice);
            return (
              <UnstyledButton
                key={option.value || "default"}
                onClick={() => setSelected(option.value)}
                aria-pressed={active}
                p="xs"
                style={{
                  borderRadius: "var(--mantine-radius-sm)",
                  border: `1px solid ${active ? "var(--mantine-primary-color-filled)" : "var(--mantine-color-default-border)"}`,
                  background: active ? "var(--mantine-primary-color-light)" : undefined,
                }}
              >
                <Text size="sm" fw={600} mb={4}>
                  {active ? "✓ " : ""}
                  {option.label}
                </Text>
                {lines === null ? (
                  <Loader size="xs" />
                ) : "error" in lines ? (
                  <Text size="xs" c="red">{lines.error}</Text>
                ) : lines.length ? (
                  <CitationLinesView lines={lines} />
                ) : (
                  <Text size="xs" c="dimmed">{t("Nothing to show for this record")}</Text>
                )}
              </UnstyledButton>
            );
          })}
        </Stack>
        <Text size="xs" c="dimmed">
          {hasPermissions("EditTree") ? (
            <>
              {t("Need another format?")}{" "}
              <Anchor
                component="button"
                type="button"
                size="xs"
                onClick={() => {
                  onCancel();
                  openPreferences({ tab: "tree", section: "citations" });
                }}
              >
                {t("Make one in Preferences")}
              </Anchor>
            </>
          ) : (
            t("A tree owner can add more formats in Preferences.")
          )}
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel} disabled={applying}>
            {t("Cancel")}
          </Button>
          <Button
            loading={applying}
            disabled={!changed}
            onClick={async () => {
              setApplying(true);
              try {
                await onApply(scope, selected);
              } finally {
                setApplying(false);
              }
            }}
          >
            {t("Apply")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
