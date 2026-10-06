import { useEffect, useMemo, useState } from "react";
import { ActionIcon, Alert, Button, Checkbox, Group, Select, SimpleGrid, Stack, Switch, Table, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { DateFormat } from "@gramps-connect/gramps-date";
import { DATE_FORMAT_LABELS, describeDateFormat } from "./displayFormatLabels";
import { ImportDesktopSettingsDialog } from "./ImportDesktopSettingsDialog";
import { formatGrampsId } from "../store/grampsIds";
import { hasPermissions } from "../auth/auth";
import { formatPlaceWith, samplePlaceHandle, useDisplayFormatVersion } from "../store/placeIndex";
import {
  BUILTIN_NAME_FORMATS,
  GRAMPS_DEFAULT_ID_TEMPLATES,
  ID_TYPES,
  isValidIdTemplate,
  type IdType,
  type DisplaySettings,
  type CustomNameFormat,
  type PlaceFormatDef,
  fetchCustomNameFormats,
  loadDisplaySettings,
  saveDisplaySettings,
} from "../store/displaySettings";
import { t } from "../i18n/i18n";


const ID_TYPE_LABELS: Record<IdType, string> = {
  person: "People",
  family: "Families",
  event: "Events",
  place: "Places",
  source: "Sources",
  citation: "Citations",
  repository: "Repositories",
  media: "Media",
  note: "Notes",
};

const STREET_OPTIONS = [
  { value: "0", label: "None" },
  { value: "1", label: "Number Street" },
  { value: "2", label: "Street Number" },
];

/** Per-tree display settings editor -- the "Preferences" tab (named after
 * desktop's Edit > Preferences rather than "Display", since it's meant to
 * grow settings that affect saving too, e.g. ID prefixes) of both
 * AdministrationDialog.tsx (Admin) and OwnerAdministrationDialog.tsx
 * (Owner), the same way UserManagementPanel.tsx is shared between them.
 * Both roles have EditTree, which PUT /api/trees/-/config requires; the
 * read-only fallback is just defensive. Edits are local until Save, which
 * writes all three sections in one PUT (see displaySettings.ts). */
export function DisplaySettingsPanel({ active }: { active: boolean }) {
  const [saved, setSaved] = useState<DisplaySettings | null>(null);
  const [draft, setDraft] = useState<DisplaySettings | null>(null);
  const [customNameFormats, setCustomNameFormats] = useState<CustomNameFormat[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importOpened, setImportOpened] = useState(false);
  const canEdit = hasPermissions("EditTree");
  // Re-renders as the Places cache loads, for the live examples below.
  useDisplayFormatVersion();

  useEffect(() => {
    if (!active) return;
    setLoadError(null);
    loadDisplaySettings()
      .then((settings) => {
        setSaved(settings);
        setDraft(settings);
      })
      .catch((err: any) => setLoadError(err.message ?? String(err)));
    // Custom formats are optional -- a failure just leaves the built-ins.
    fetchCustomNameFormats()
      .then(setCustomNameFormats)
      .catch(() => setCustomNameFormats([]));
  }, [active]);

  const nameOptions = useMemo(
    () => [
      ...BUILTIN_NAME_FORMATS.map((opt) => ({
        value: String(opt.number),
        label: opt.number === 0 ? t(opt.name) : `${t(opt.name)}  (${opt.format})`,
        format: opt.format,
        disabled: false,
      })),
      // The tree's own formats, shown as written in desktop's editor. One
      // that can't be converted to %-codes (translated keywords, ...) is
      // listed but not selectable -- the server would reject it.
      ...customNameFormats.map((opt) => ({
        value: String(opt.number),
        label: `${opt.name}  (${opt.original})${opt.usable ? "" : ` — ${t("not supported")}`}`,
        format: opt.format,
        disabled: !opt.usable,
      })),
    ],
    [customNameFormats],
  );

  // Recomputed each render: cheap next to the table, and it picks up the
  // Places cache as soon as it loads.
  const sampleHandle = samplePlaceHandle();

  if (loadError) return <Alert color="red">{loadError}</Alert>;
  if (!draft || !saved) return null;

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  // Save would silently drop an invalid template (normalizeDisplaySettings).
  const idsValid = ID_TYPES.every((type) => draft.ids[type] === "" || isValidIdTemplate(draft.ids[type]));
  // A stored format string that matches no listed option (e.g. a custom
  // format since deleted from the tree) still shows, as its own entry.
  const selectedName = nameOptions.find((opt) => !opt.disabled && opt.format === draft.name.format);
  const nameSelectData = selectedName
    ? nameOptions
    : [...nameOptions, { value: "stored", label: `${t("Custom")}  (${draft.name.format})`, format: draft.name.format, disabled: false }];

  function update(fn: (d: DisplaySettings) => DisplaySettings) {
    setDraft((d) => (d ? fn(d) : d));
  }

  function updatePlaceFormat(index: number, patch: Partial<PlaceFormatDef>) {
    update((d) => ({
      ...d,
      place: { ...d.place, formats: d.place.formats.map((f, i) => (i === index ? { ...f, ...patch } : f)) },
    }));
  }

  function addPlaceFormat() {
    update((d) => ({
      ...d,
      place: {
        ...d.place,
        formats: [...d.place.formats, { name: t("New"), levels: ":", language: "", street: 0, reverse: false }],
      },
    }));
  }

  function removePlaceFormat(index: number) {
    update((d) => {
      const formats = d.place.formats.filter((_, i) => i !== index);
      // Keep the same format selected if it survives; otherwise fall back to Full.
      const active = d.place.active === index ? 0 : d.place.active > index ? d.place.active - 1 : d.place.active;
      return { ...d, place: { ...d.place, formats, active } };
    });
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    try {
      await saveDisplaySettings(draft);
      setSaved(draft);
      notifications.show({ color: "green", message: t("Display settings saved.") });
    } catch (err: any) {
      notifications.show({ color: "red", message: err.message ?? String(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Text size="sm" c="dimmed">
          {t("These settings apply to everyone using this tree in Gramps Connect. Reports, exports, and other text the server formats keep the server's own settings.")}
        </Text>
        {canEdit && (
          <Button variant="default" size="xs" style={{ flexShrink: 0 }} onClick={() => setImportOpened(true)}>
            {t("Import from Gramps desktop…")}
          </Button>
        )}
      </Group>
      <ImportDesktopSettingsDialog
        opened={importOpened}
        onClose={() => setImportOpened(false)}
        current={draft}
        customNameFormats={customNameFormats}
        onApply={(next) => {
          setDraft(next);
          notifications.show({ message: t("Imported. Check the settings below, then press Save to keep them.") });
        }}
      />

      <Title order={5}>{t("Dates")}</Title>
      <Select
        label={t("Date format")}
        disabled={!canEdit}
        allowDeselect={false}
        value={String(draft.date.format)}
        onChange={(value) => value != null && update((d) => ({ ...d, date: { format: Number(value) as DateFormat } }))}
        data={Object.keys(DATE_FORMAT_LABELS).map((fmt) => ({
          value: fmt,
          label: describeDateFormat(Number(fmt) as DateFormat),
        }))}
      />

      <Title order={5}>{t("Names")}</Title>
      <Select
        label={t("Name format")}
        disabled={!canEdit}
        allowDeselect={false}
        value={selectedName?.value ?? "stored"}
        onChange={(value) => {
          const opt = nameSelectData.find((o) => o.value === value);
          if (opt) update((d) => ({ ...d, name: { format: opt.format } }));
        }}
        data={nameSelectData.map(({ value, label, disabled }) => ({ value, label, disabled }))}
      />

      <Title order={5}>{t("Places")}</Title>
      <Switch
        label={t("Enable automatic place title generation")}
        disabled={!canEdit}
        checked={draft.place.auto}
        onChange={(e) => {
          const auto = e.currentTarget.checked;
          update((d) => ({ ...d, place: { ...d.place, auto } }));
        }}
      />
      <Select
        label={t("Place format")}
        disabled={!canEdit || !draft.place.auto}
        allowDeselect={false}
        value={String(draft.place.active)}
        onChange={(value) => value != null && update((d) => ({ ...d, place: { ...d.place, active: Number(value) } }))}
        data={draft.place.formats.map((f, i) => ({ value: String(i), label: f.name || t("(unnamed)") }))}
      />
      <Table withTableBorder verticalSpacing={4}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("Name")}</Table.Th>
            <Table.Th>{t("Levels")}</Table.Th>
            <Table.Th>{t("Language")}</Table.Th>
            <Table.Th>{t("Street format")}</Table.Th>
            <Table.Th>{t("Reverse")}</Table.Th>
            <Table.Th>{t("Example")}</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {draft.place.formats.map((fmt, i) => {
            // Format 0 is desktop's fixed "Full" -- not editable there either.
            const locked = i === 0 || !canEdit;
            return (
              <Table.Tr key={i}>
                <Table.Td>
                  <TextInput size="xs" value={fmt.name} disabled={locked} onChange={(e) => updatePlaceFormat(i, { name: e.currentTarget.value })} />
                </Table.Td>
                <Table.Td>
                  <TextInput size="xs" value={fmt.levels} disabled={locked} onChange={(e) => updatePlaceFormat(i, { levels: e.currentTarget.value })} />
                </Table.Td>
                <Table.Td>
                  <TextInput size="xs" w={70} value={fmt.language} disabled={locked} onChange={(e) => updatePlaceFormat(i, { language: e.currentTarget.value })} />
                </Table.Td>
                <Table.Td>
                  <Select
                    size="xs"
                    allowDeselect={false}
                    disabled={locked}
                    value={String(fmt.street)}
                    onChange={(value) => value != null && updatePlaceFormat(i, { street: Number(value) as 0 | 1 | 2 })}
                    data={STREET_OPTIONS.map((o) => ({ value: o.value, label: t(o.label) }))}
                  />
                </Table.Td>
                <Table.Td>
                  <Checkbox checked={fmt.reverse} disabled={locked} onChange={(e) => updatePlaceFormat(i, { reverse: e.currentTarget.checked })} />
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {sampleHandle ? formatPlaceWith(sampleHandle, fmt) ?? "…" : "…"}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {!locked && (
                    <ActionIcon variant="subtle" color="red" onClick={() => removePlaceFormat(i)} aria-label={t("Remove")}>
                      ✕
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed">
        {t('Levels selects which parts of the place hierarchy to show, counting from the place itself (0) upward: ":" is all, "0:2" the first two, "-1" the last. A "p" prefix counts from the populated place (city, town, village…), e.g. "p:".')}
      </Text>
      {canEdit && (
        <Group>
          <Button variant="default" size="xs" onClick={addPlaceFormat}>
            {t("Add place format")}
          </Button>
        </Group>
      )}

      <Title order={5}>{t("New records")}</Title>
      <Text size="xs" c="dimmed">
        {t('The Gramps ID given to each new record, like Gramps\' own "I%04d" (I0001, I0002, ...). Gramps Connect picks the next unused number. Leave a type empty to let the server number it the standard Gramps way (I0001, F0001, ...). Imported files keep their own IDs.')}
      </Text>
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs" verticalSpacing="xs">
        {ID_TYPES.map((type) => {
          const value = draft.ids[type];
          const valid = value === "" || isValidIdTemplate(value);
          return (
            <TextInput
              key={type}
              size="xs"
              label={t(ID_TYPE_LABELS[type])}
              placeholder={t("Server default")}
              disabled={!canEdit}
              value={value}
              error={valid ? undefined : t('Needs one number field, e.g. "I%04d"')}
              description={value && valid ? `${t("e.g.")} ${formatGrampsId(value, 42)}` : undefined}
              onChange={(e) => {
                const next = e.currentTarget.value.trim();
                update((d) => ({ ...d, ids: { ...d.ids, [type]: next } }));
              }}
            />
          );
        })}
      </SimpleGrid>
      {canEdit && (
        <Group justify="space-between">
          <Button
            variant="default"
            size="xs"
            onClick={() => update((d) => ({ ...d, ids: { ...GRAMPS_DEFAULT_ID_TEMPLATES } }))}
          >
            {t("Use Gramps' default IDs")}
          </Button>
          <Group gap="xs">
            <Button variant="default" disabled={!dirty || saving} onClick={() => setDraft(saved)}>
              {t("Revert")}
            </Button>
            <Button disabled={!dirty || !idsValid} loading={saving} onClick={handleSave}>
              {t("Save")}
            </Button>
          </Group>
        </Group>
      )}
    </Stack>
  );
}
