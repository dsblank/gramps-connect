import { useEffect, useState } from "react";
import { Alert, Button, Group, Loader, Modal, Stack, Text, Textarea } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { getToken, hasPermissions } from "../../../auth/auth";
import { chooseCitationFormat, useDisplaySettings } from "../../../store/displaySettings";
import { useCitationTemplateLines } from "../useCitationTemplateLines";
import { linesToText } from "../../../store/citationTemplateSyntax";
import { useDisplayFormatVersion } from "../../../store/placeIndex";
import { zipRefs } from "../../../store/objectDetail";
import { fetchPlainObject, updateObject } from "../../../store/objectsApi";
import { SOURCE_VIEW, type ViewConfig } from "../../../store/views";
import {
  CITATION_TEMPLATE_ATTRIBUTE,
  attributeText,
  citationFormatterLabel,
  fetchRepositoryName,
  formattedCitationLines,
  pastedCitationText,
  withAttributeText,
  withPastedCitationText,
  type RepositoryFields,
  type SourceFields,
} from "../../../store/citationFormat";
import { SectionShell } from "./shared";
import { CitationLinesView, CopyCitationButton, plainLines } from "../CitationLines";
import { CitationFormatDialog } from "../CitationFormatDialog";
import { InfoButton } from "../../InfoButton";
import { DocumentationDialog } from "../../DocumentationDialog";
import type { SectionProps } from "../types";
import { t } from "../../../i18n/i18n";

interface RawSource extends SourceFields {
  handle?: string;
  change?: unknown;
  attribute_list?: unknown;
  reporef_list?: { ref: string; call_number?: string }[];
}

/** One attribute set (or removed, for "") on a record: one GET and one
 * PUT, so one change in its History. */
async function setRecordAttribute(view: ViewConfig, handle: string, type: string, value: string): Promise<void> {
  const token = await getToken();
  const obj = await fetchPlainObject(token, view, handle);
  obj.attribute_list = withAttributeText(obj.attribute_list, type, value);
  await updateObject(token, view, handle, obj);
}

/** The record written out as a citation. Which format, first match wins:
 * 1. a Citation's own pasted text (its "Citation text" attribute);
 * 2. the format its "Citation template" attribute names, else its
 *    Source's (a tree template's name, or Legacy/Enhanced);
 * 3. the tree's Citation formatter (Preferences > Citations).
 * A built-in is written from the detail already loaded
 * (store/citationFormat.ts); a template is rendered by the server
 * (store/citationTemplate.ts), so it fills in after the rest of the panel.
 * On a Citation: the source line, then the page/date/confidence line, as
 * Gramps' report endnotes print them; on a Source, just the source line.
 * Editors paste text and pick the format here; Copy copies what's shown. */
export function FormattedCitationSection({ type, view, detail, onRefetch }: SectionProps) {
  const settings = useDisplaySettings();
  useDisplayFormatVersion(); // dates follow the tree's date format
  const [editing, setEditing] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);

  const source: RawSource | undefined =
    type === "citation" ? (detail.extended?.source as RawSource | undefined) : (detail as RawSource);
  const pasted = type === "citation" ? pastedCitationText(detail.attribute_list) : "";

  const citationAsks = type === "citation" ? attributeText(detail.attribute_list, CITATION_TEMPLATE_ATTRIBUTE) : "";
  const sourceAsks = attributeText(source?.attribute_list, CITATION_TEMPLATE_ATTRIBUTE);
  const requested = citationAsks || sourceAsks;
  const { choice, unknown } = chooseCitationFormat(settings, requested);
  const template = choice.template;
  const formatter = choice.formatter ?? "legacy";

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
    `${detail.change}:${source?.change}`,
  );
  const generated = template
    ? templated.lines ?? []
    : source?.handle
      ? plainLines(formattedCitationLines(formatter, citationFields, source, repository))
      : [];
  const shown = pasted ? plainLines([pasted]) : generated;
  const loading = !pasted && !!template && templated.lines === null && !templated.error;
  const canEdit = hasPermissions("EditObject");
  const canPaste = type === "citation" && canEdit;
  if (shown.length === 0 && !canEdit && !loading && !templated.error) return null;

  async function chooseFormat(target: "source" | "citation", name: string) {
    try {
      if (target === "source") {
        if (!source?.handle) return;
        await setRecordAttribute(SOURCE_VIEW, source.handle, CITATION_TEMPLATE_ATTRIBUTE, name);
      } else {
        await setRecordAttribute(view, detail.handle, CITATION_TEMPLATE_ATTRIBUTE, name);
      }
      onRefetch?.();
    } catch (e) {
      notifications.show({ color: "red", message: e instanceof Error ? e.message : String(e) });
    }
  }

  const chosenName = template?.name ?? citationFormatterLabel(formatter);
  let origin: string | null = null;
  if (!pasted && requested && !unknown) {
    origin = citationAsks
      ? t('Written as "{name}", chosen for this citation.')
      : t('Written as "{name}", chosen for this source\'s citations.');
  }

  return (
    <SectionShell
      label={type === "citation" ? t("Formatted citation") : t("Formatted source")}
      action={
        <Group gap={4}>
          <InfoButton size="xs" label={t("About formatted citations")} onClick={() => setHelpOpen(true)} />
          {shown.length > 0 && <CopyCitationButton lines={shown} />}
          {canPaste && (
            <Button size="compact-xs" variant="subtle" onClick={() => setEditing(true)}>
              {pasted ? t("Edit text") : t("Paste your own")}
            </Button>
          )}
          {canEdit && source?.handle && (
            <Button size="compact-xs" variant="subtle" onClick={() => setChoosing(true)}>
              {t("Format")}
            </Button>
          )}
        </Group>
      }
    >
      {shown.length > 0 && <CitationLinesView lines={shown} />}
      {loading && <Loader size="xs" />}
      {!pasted && templated.error && (
        <Text size="xs" c="red">
          {`${t("This tree's citation template didn't work here:")} ${templated.error}`}
        </Text>
      )}
      {origin && (
        <Text size="xs" c="dimmed">
          {origin.replace("{name}", chosenName)}
        </Text>
      )}
      {!pasted && unknown && (
        <Text size="xs" c="dimmed">
          {t('This {record} asks for the format "{name}", which this tree doesn\'t have, so the tree\'s own format is used.')
            .replace("{record}", citationAsks ? t("citation") : t("source"))
            .replace("{name}", unknown)}
        </Text>
      )}
      {pasted && (
        <Text size="xs" c="dimmed">
          {t("Pasted text, shown in place of the generated citation.")}
        </Text>
      )}
      {choosing && source?.handle && (
        <CitationFormatDialog
          settings={settings}
          isCitation={type === "citation"}
          source={source}
          citationHandle={type === "citation" ? detail.handle : undefined}
          citationFields={citationFields}
          sourceAsks={sourceAsks}
          citationAsks={citationAsks}
          onCancel={() => setChoosing(false)}
          onApply={async (scope, name) => {
            await chooseFormat(scope, name);
            setChoosing(false);
          }}
        />
      )}
      <DocumentationDialog opened={helpOpen} onClose={() => setHelpOpen(false)} initialPage="Citations" />
      {editing && (
        <PastedTextDialog
          initial={pasted}
          generated={linesToText(generated)}
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
