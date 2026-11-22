import { useEffect, useState } from "react";
import { Alert, Button, CopyButton, Group, Loader, Modal, Stack, Text, Textarea } from "@mantine/core";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { getToken, hasPermissions } from "../../../auth/auth";
import { activeCitationTemplate, isBuiltinFormatter, useDisplaySettings } from "../../../store/displaySettings";
import { useCitationTemplateLines } from "../useCitationTemplateLines";
import { useDisplayFormatVersion } from "../../../store/placeIndex";
import { zipRefs } from "../../../store/objectDetail";
import { fetchPlainObject, updateObject } from "../../../store/objectsApi";
import {
  fetchRepositoryName,
  formattedCitationLines,
  pastedCitationText,
  withPastedCitationText,
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
 * (Preferences > Citations): a built-in (store/citationFormat.ts, from the
 * detail already loaded) or one of the tree's templates
 * (store/citationTemplate.ts, rendered by the server, so it loads after
 * the rest of the panel). On a Citation, the
 * source line then the page/date/confidence line, as Gramps' report
 * endnotes print them; on a Source, just the source line. A Citation's own
 * pasted text (its "Citation text" attribute) replaces the generated
 * lines; editors set or clear it here. Copy puts what's shown on the
 * clipboard. */
export function FormattedCitationSection({ type, view, detail, onRefetch }: SectionProps) {
  const settings = useDisplaySettings();
  const formatter = isBuiltinFormatter(settings.citation.formatter) ? settings.citation.formatter : "legacy";
  const template = activeCitationTemplate(settings);
  useDisplayFormatVersion(); // dates follow the tree's date format
  const [editing, setEditing] = useState(false);

  const source: RawSource | undefined =
    type === "citation" ? (detail.extended?.source as RawSource | undefined) : (detail as RawSource);
  const pasted = type === "citation" ? pastedCitationText(detail.attribute_list) : "";

  // Enhanced names the source's first repository. A Source's own detail
  // already carries it (extended.repositories); a Citation's only reaches
  // as far as its source, so fetch that one repository.
  const firstRef = source?.handle ? source.reporef_list?.[0] : undefined;
  const extendedRepo =
    type === "source" ? (zipRefs(detail.reporef_list, detail.extended?.repositories)[0]?.target as { name?: string } | undefined) : undefined;
  const [fetchedRepo, setFetchedRepo] = useState<{ handle: string; name: string } | null>(null);
  const fetchHandle = !template && formatter === "enhanced" && type === "citation" && !pasted ? firstRef?.ref : undefined;
  useEffect(() => {
    if (!fetchHandle || fetchedRepo?.handle === fetchHandle) return;
    const controller = new AbortController();
    fetchRepositoryName(fetchHandle, controller.signal)
      .then((name) => name !== undefined && setFetchedRepo({ handle: fetchHandle, name }))
      .catch(() => {});
    return () => controller.abort();
  }, [fetchHandle, fetchedRepo]);

  let repository: RepositoryFields | null = null;
  if (firstRef) {
    const name = type === "source" ? extendedRepo?.name : fetchedRepo?.handle === firstRef.ref ? fetchedRepo.name : undefined;
    if (name !== undefined) repository = { name, callNumber: firstRef.call_number };
  }

  const citationFields =
    type === "citation"
      ? {
          page: detail.page as string | undefined,
          date: detail.date as GrampsDate | undefined,
          confidence: detail.confidence as number | undefined,
        }
      : null;
  const templated = useCitationTemplateLines(
    pasted ? null : template,
    source?.handle,
    type === "citation" ? detail.handle : undefined,
    `${detail.change}:${(source as { change?: unknown } | undefined)?.change}`,
  );
  const generated = template
    ? templated.lines ?? []
    : source?.handle
      ? formattedCitationLines(formatter, citationFields, source, repository)
      : [];
  const shown = pasted ? [pasted] : generated;
  const loading = !pasted && !!template && templated.lines === null && !templated.error;
  const canEdit = type === "citation" && hasPermissions("EditObject");
  if (shown.length === 0 && !canEdit && !loading && !templated.error) return null;

  return (
    <SectionShell
      label={type === "citation" ? t("Formatted citation") : t("Formatted source")}
      action={
        <Group gap={0}>
          {shown.length > 0 && (
            <CopyButton value={shown.join("\n")}>
              {({ copied, copy }) => (
                <Button size="compact-xs" variant="subtle" onClick={copy}>
                  {copied ? t("Copied") : t("Copy")}
                </Button>
              )}
            </CopyButton>
          )}
          {canEdit && (
            <Button size="compact-xs" variant="subtle" onClick={() => setEditing(true)}>
              {pasted ? t("Edit text") : t("Paste your own")}
            </Button>
          )}
        </Group>
      }
    >
      {shown.length > 0 && (
        <Stack gap={2}>
          {shown.map((line, i) => (
            <Text key={i} size="sm" pl={i > 0 ? "md" : undefined} style={{ userSelect: "text" }}>
              {line}
            </Text>
          ))}
        </Stack>
      )}
      {loading && <Loader size="xs" />}
      {!pasted && templated.error && (
        <Text size="xs" c="red">
          {`${t("This tree's citation template didn't work here:")} ${templated.error}`}
        </Text>
      )}
      {pasted && (
        <Text size="xs" c="dimmed">
          {t("Pasted text, shown in place of the generated citation.")}
        </Text>
      )}
      {editing && (
        <PastedTextDialog
          initial={pasted}
          generated={generated.join("\n")}
          onClose={() => setEditing(false)}
          onSave={async (text) => {
            const token = await getToken();
            const obj = await fetchPlainObject(token, view, detail.handle);
            obj.attribute_list = withPastedCitationText(obj.attribute_list, text);
            await updateObject(token, view, detail.handle, obj);
            setEditing(false);
            onRefetch?.();
          }}
        />
      )}
    </SectionShell>
  );
}

function PastedTextDialog({ initial, generated, onClose, onSave }: {
  initial: string;
  generated: string;
  onClose: () => void;
  onSave: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(value: string) {
    setSaving(true);
    setError(null);
    try {
      await onSave(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <Modal opened onClose={onClose} title={t("Citation text")} size="lg">
      <Stack gap="sm">
        <Text size="sm">
          {t('Paste the citation a website gives you, such as FamilySearch\'s "Cite this record" or Ancestry\'s source citation. It is shown here, and copied, instead of the generated text.')}
        </Text>
        <Textarea
          autosize
          minRows={3}
          maxRows={10}
          data-autofocus
          value={text}
          placeholder={generated}
          onChange={(e) => setText(e.currentTarget.value)}
        />
        <Text size="xs" c="dimmed">
          {t('Kept as this citation\'s "Citation text" attribute, which Gramps desktop shows too.')}
        </Text>
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="space-between">
          {initial ? (
            <Button variant="subtle" color="red" disabled={saving} onClick={() => save("")}>
              {t("Use generated text")}
            </Button>
          ) : (
            <span />
          )}
          <Group gap="xs">
            <Button variant="default" onClick={onClose} disabled={saving}>
              {t("Cancel")}
            </Button>
            <Button loading={saving} disabled={text.trim() === initial} onClick={() => save(text)}>
              {t("Save")}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
