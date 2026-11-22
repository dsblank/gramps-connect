// Preferences > Family tree > Citations: the formatter choice (Legacy,
// Enhanced, or one of the tree's own templates), the templates themselves,
// and their editor. Everything here edits the Preferences draft; nothing
// is stored until the panel's Save.
import { useRef, useState } from "react";
import { Button, Combobox, Group, Modal, Select, Stack, Text, Textarea, TextInput } from "@mantine/core";
import {
  CITATION_FORMATTERS,
  isBuiltinFormatter,
  type DisplaySettings,
  type TreeCitationTemplate,
} from "../store/displaySettings";
import { citationFormatterLabel } from "../store/citationFormat";
import {
  ENHANCED_TEMPLATE,
  LEGACY_TEMPLATE,
  STARTER_TEMPLATES,
  TemplateError,
  locateTemplateExpression,
  parseTemplate,
  type CitationTemplate,
} from "../store/citationTemplateSyntax";
import { CitationFormatPreview } from "./CitationFormatPreview";
import { GoqlCompletionDropdown, useGoqlCompletion } from "./goqlCompletion/useGoqlCompletion";
import { t } from "../i18n/i18n";

type CitationSettings = DisplaySettings["citation"];

function newTemplateId(): string {
  return `tpl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function describe(citation: CitationSettings): string {
  switch (citation.formatter) {
    case "legacy":
      return t("Gramps' own format: author, title, publication info and abbreviation, then page, date and confidence. Shown on each citation and source.");
    case "enhanced":
      return t("As Legacy, but starting with the source's first repository and its call number. Shown on each citation and source.");
    default:
      return t("This tree's own template. Shown on each citation and source.");
  }
}

export function CitationTemplateSettings({
  citation,
  canEdit,
  onChange,
}: {
  citation: CitationSettings;
  canEdit: boolean;
  onChange: (next: CitationSettings) => void;
}) {
  // null: closed; a template with an id not in the list: a new one.
  const [editing, setEditing] = useState<TreeCitationTemplate | null>(null);
  const active = isBuiltinFormatter(citation.formatter)
    ? null
    : citation.templates.find((tpl) => tpl.id === citation.formatter) ?? null;

  function saveTemplate(tpl: TreeCitationTemplate) {
    const exists = citation.templates.some((other) => other.id === tpl.id);
    onChange({
      // A new template becomes the one in use; an edited one keeps the choice.
      formatter: exists ? citation.formatter : tpl.id,
      templates: exists ? citation.templates.map((other) => (other.id === tpl.id ? tpl : other)) : [...citation.templates, tpl],
    });
    setEditing(null);
  }

  function removeTemplate(id: string) {
    onChange({
      formatter: citation.formatter === id ? "legacy" : citation.formatter,
      templates: citation.templates.filter((tpl) => tpl.id !== id),
    });
  }

  return (
    <Stack gap="xs">
      <Select
        label={t("Citation formatter")}
        description={describe(citation)}
        disabled={!canEdit}
        allowDeselect={false}
        value={citation.formatter}
        onChange={(value) => value && onChange({ ...citation, formatter: value })}
        data={[
          ...CITATION_FORMATTERS.map((f) => ({ value: f, label: citationFormatterLabel(f) })),
          ...citation.templates.map((tpl) => ({ value: tpl.id, label: tpl.name })),
        ]}
      />
      {citation.templates.length > 0 && (
        <Stack gap={4}>
          {citation.templates.map((tpl) => (
            <Group key={tpl.id} gap="xs" wrap="nowrap">
              <Text size="sm" style={{ flex: 1, minWidth: 0 }} truncate>
                {tpl.name}
              </Text>
              {canEdit && (
                <>
                  <Button size="compact-xs" variant="subtle" onClick={() => setEditing(tpl)}>
                    {t("Edit")}
                  </Button>
                  <Button size="compact-xs" variant="subtle" color="red" onClick={() => removeTemplate(tpl.id)}>
                    {t("Delete")}
                  </Button>
                </>
              )}
            </Group>
          ))}
        </Stack>
      )}
      {canEdit && (
        <Group>
          <Button
            variant="default"
            size="xs"
            onClick={() => {
              const base = active ?? LEGACY_TEMPLATE;
              setEditing({ id: newTemplateId(), name: "", source: base.source, citation: base.citation });
            }}
          >
            {t("New template")}
          </Button>
        </Group>
      )}
      <CitationFormatPreview
        formatter={isBuiltinFormatter(citation.formatter) ? citation.formatter : "legacy"}
        template={active}
      />
      {editing && (
        <TemplateEditDialog
          initial={editing}
          isNew={!citation.templates.some((tpl) => tpl.id === editing.id)}
          onCancel={() => setEditing(null)}
          onSave={saveTemplate}
        />
      )}
    </Stack>
  );
}

function templateError(template: string): TemplateError | null {
  try {
    parseTemplate(template);
    return null;
  } catch (e) {
    return e instanceof TemplateError ? e : new TemplateError(String(e), 1);
  }
}

function TemplateEditDialog({
  initial,
  isNew,
  onCancel,
  onSave,
}: {
  initial: TreeCitationTemplate;
  isNew: boolean;
  onCancel: () => void;
  onSave: (tpl: TreeCitationTemplate) => void;
}) {
  const [draft, setDraft] = useState(initial);
  // The server's verdict on the expressions (unknown field, ...), from the
  // preview; OK waits for it to clear.
  const [serverError, setServerError] = useState<string | null>(null);
  const sourceError = templateError(draft.source);
  const citationError = templateError(draft.citation);
  const valid = !!draft.name.trim() && !sourceError && !citationError && !serverError;
  const bases: Record<string, CitationTemplate & { name?: string }> = {
    legacy: LEGACY_TEMPLATE,
    enhanced: ENHANCED_TEMPLATE,
    ...Object.fromEntries(STARTER_TEMPLATES.map((st) => [`starter:${st.name}`, st])),
  };
  // Both lines from the chosen base; a starter also names an unnamed draft.
  const startFrom = (key: string) => {
    const base = bases[key];
    if (!base) return;
    setDraft((d) => ({
      ...d,
      source: base.source,
      citation: base.citation,
      name: d.name.trim() || !key.startsWith("starter:") ? d.name : base.name ?? d.name,
    }));
  };
  const descriptions = Object.fromEntries(STARTER_TEMPLATES.map((st) => [`starter:${st.name}`, st.description]));

  return (
    <Modal opened onClose={onCancel} title={isNew ? t("New citation template") : t("Edit citation template")} size="xl">
      <Stack gap="sm">
        <Text size="sm">
          {t("Write GOQL between backticks, as in a list column: `title`, `repositories[0].name`, `attribute_list['Film'].value`. A part in [ ] is left out when a value in it is empty, and a separator such as \", \" at its start is left out at the start of a line. *Italic* and **bold** work as in Markdown. Write \\[ \\] \\` \\* for the characters themselves. <Tab> completes inside backticks.")}
        </Text>
        <TextInput
          label={t("Name")}
          required
          data-autofocus
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
        />
        <Select
          label={t("Start from")}
          description={t("Replaces both lines below with a ready-made format, to adjust as you like.")}
          placeholder={t("Choose a format to start from")}
          value={null}
          onChange={(key) => key && startFrom(key)}
          data={[
            {
              group: t("Gramps' own"),
              items: [
                { value: "legacy", label: t("Legacy") },
                { value: "enhanced", label: t("Enhanced") },
              ],
            },
            {
              group: t("Starters"),
              items: STARTER_TEMPLATES.map((st) => ({ value: `starter:${st.name}`, label: t(st.name) })),
            },
          ]}
          renderOption={({ option }) => (
            <Stack gap={0}>
              <Text size="sm">{option.label}</Text>
              {descriptions[option.value] && (
                <Text size="xs" c="dimmed">
                  {t(descriptions[option.value])}
                </Text>
              )}
            </Stack>
          )}
        />
        <TemplateLineInput
          label={t("Source line")}
          description={t("Written for the source: `author`, `title`, `pubinfo`, `abbrev`, `repositories[0].name`, ...")}
          namespace="Source"
          value={draft.source}
          error={sourceError}
          onChange={(source) => setDraft({ ...draft, source })}
        />
        <TemplateLineInput
          label={t("Citation line")}
          description={t("Written for the citation: `page`, `date`, `confidence`, `source.title`, ...")}
          namespace="Citation"
          value={draft.citation}
          error={citationError}
          onChange={(citation) => setDraft({ ...draft, citation })}
        />
        {!sourceError && !citationError && (
          <CitationFormatPreview
            formatter="legacy"
            template={{ source: draft.source, citation: draft.citation }}
            onError={setServerError}
          />
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button disabled={!valid} onClick={() => onSave({ ...draft, name: draft.name.trim() })}>
            {t("OK")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function TemplateLineInput({
  label,
  description,
  namespace,
  value,
  error,
  onChange,
}: {
  label: string;
  description: string;
  namespace: string;
  value: string;
  error: TemplateError | null;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const completion = useGoqlCompletion({
    value,
    setValue: onChange,
    fieldRef: ref,
    locate: (text, cursor) => {
      const spot = locateTemplateExpression(text, cursor);
      return spot && { namespace, ...spot };
    },
  });
  return (
    <Combobox store={completion.combobox} onOptionSubmit={completion.accept} position="bottom-start" width={320} withinPortal>
      <Combobox.Target withKeyboardNavigation={false}>
        <Textarea
          ref={ref}
          label={label}
          description={description}
          ff="monospace"
          autosize
          minRows={2}
          spellCheck={false}
          value={value}
          error={error ? `${t("Column")} ${error.column}: ${error.message}` : undefined}
          onChange={(e) => {
            const next = e.currentTarget.value;
            onChange(next);
            completion.handleChange(next, e.currentTarget.selectionStart ?? next.length);
          }}
          onKeyDown={(e) => {
            completion.handleKeyDown(e);
          }}
          onBlur={completion.close}
          data-mantine-stop-propagation
        />
      </Combobox.Target>
      <GoqlCompletionDropdown completions={completion.completions} />
    </Combobox>
  );
}
