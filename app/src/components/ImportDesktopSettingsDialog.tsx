import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Checkbox, FileInput, Group, Modal, Select, Stack, Table, Text } from "@mantine/core";
import type { DateFormat } from "@gramps-connect/gramps-date";
import {
  DESKTOP_DATE_FORMATS,
  applyImport,
  buildImportItems,
  withDependencies,
  desktopLanguageFor,
  parseGrampsIni,
  parsePlaceFormatsXml,
  type ImportItem,
  type ImportKey,
  type IniValue,
} from "../store/desktopSettingsImport";
import { BUILTIN_NAME_FORMATS, type CustomNameFormat, type DisplaySettings, type PlaceFormatDef } from "../store/displaySettings";
import { formatPlaceWith, samplePlaceHandle } from "../store/placeIndex";
import { describeDateFormat } from "./displayFormatLabels";
import { getI18nSnapshot, t } from "../i18n/i18n";

interface ImportDesktopSettingsDialogProps {
  opened: boolean;
  onClose: () => void;
  /** The Display panel's current (possibly unsaved) settings. */
  current: DisplaySettings;
  customNameFormats: CustomNameFormat[];
  /** Receives the merged settings; the panel's own Save writes them. */
  onApply: (next: DisplaySettings) => void;
}

const ROW_LABELS: Record<ImportKey, string> = {
  date: "Date format",
  name: "Name format",
  placeAuto: "Automatic place titles",
  placeFormats: "Place formats",
  placeActive: "Place format in use",
  ids: "Gramps IDs for new records",
};

/** "Import from Gramps desktop…" -- a one-shot copy of the desktop display
 * preferences gramps-connect can honor (store/desktopSettingsImport.ts)
 * into the Display panel's draft. Nothing is saved here: the preview shows
 * what each setting would become, the user picks which to take, and the
 * panel's own Save button writes them, the same as any other edit there. */
export function ImportDesktopSettingsDialog({ opened, onClose, current, customNameFormats, onApply }: ImportDesktopSettingsDialogProps) {
  const [iniFile, setIniFile] = useState<File | null>(null);
  const [xmlFile, setXmlFile] = useState<File | null>(null);
  const [ini, setIni] = useState<Map<string, IniValue> | null>(null);
  const [placeFormats, setPlaceFormats] = useState<PlaceFormatDef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [desktopLanguage, setDesktopLanguage] = useState(() => desktopLanguageFor(getI18nSnapshot().lang));
  const [chosen, setChosen] = useState<Set<ImportKey>>(new Set());

  useEffect(() => {
    if (!opened) return;
    setIniFile(null);
    setXmlFile(null);
    setIni(null);
    setPlaceFormats(null);
    setError(null);
  }, [opened]);

  useEffect(() => {
    if (!iniFile) {
      setIni(null);
      return;
    }
    iniFile.text().then((text) => {
      const parsed = parseGrampsIni(text);
      if (![...parsed.keys()].some((key) => key.startsWith("preferences."))) {
        setError(t("That doesn't look like a Gramps gramps.ini file (no [preferences] section)."));
        setIni(null);
      } else {
        setError(null);
        setIni(parsed);
      }
    });
  }, [iniFile]);

  useEffect(() => {
    if (!xmlFile) {
      setPlaceFormats(null);
      return;
    }
    xmlFile.text().then((text) => {
      try {
        setPlaceFormats(parsePlaceFormatsXml(text));
        setError(null);
      } catch (err: any) {
        setPlaceFormats(null);
        setError(`${t("Couldn't read place_formats.xml")}: ${err.message ?? String(err)}`);
      }
    });
  }, [xmlFile]);

  const items = useMemo(
    () =>
      ini
        ? buildImportItems({ ini, placeFormats, desktopLanguage, customNameFormats, dateFormatLabel: describeDateFormat })
        : [],
    [ini, placeFormats, desktopLanguage, customNameFormats],
  );

  // Pre-tick what the user evidently chose on desktop: usable, not just
  // desktop's default, and actually different from what's here now.
  useEffect(() => {
    setChosen(
      withDependencies(
        items,
        new Set(
          items
            .filter((item) => item.usable && !item.isDefault && JSON.stringify(item.apply(current)) !== JSON.stringify(current))
            .map((item) => item.key),
        ),
      ),
    );
    // `current` deliberately left out: re-ticking on every draft change
    // would undo the user's own unticking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const sampleHandle = samplePlaceHandle();

  function currentText(key: ImportKey, s: DisplaySettings): string {
    switch (key) {
      case "date":
        return describeDateFormat(s.date.format as DateFormat);
      case "name": {
        const known = [...BUILTIN_NAME_FORMATS, ...customNameFormats].find((opt) => opt.format === s.name.format);
        return known ? t(known.name) : s.name.format;
      }
      case "placeAuto":
        return s.place.auto ? t("On") : t("Off");
      case "placeFormats":
        return s.place.formats.map((f) => f.name).join(", ");
      case "ids": {
        const set = Object.values(s.ids).filter(Boolean);
        return set.length ? set.join(", ") : t("Server default");
      }
      case "placeActive": {
        const fmt = s.place.formats[s.place.active];
        const example = fmt && sampleHandle ? formatPlaceWith(sampleHandle, fmt) : null;
        return example ? `${fmt.name} — ${example}` : fmt?.name ?? "";
      }
    }
  }

  /** What this row would look like after import, for the preview. */
  function desktopText(item: ImportItem): string {
    if (!item.usable) return item.desktop;
    // Applying on top of the other chosen rows matters for placeActive,
    // whose name and example come from the imported format list.
    const after = applyImport(current, items, new Set([...chosen, item.key]));
    if (item.key === "placeFormats" || item.key === "placeActive" || item.key === "name") return currentText(item.key, after);
    return item.key === "placeAuto" ? t(item.desktop) : item.desktop;
  }

  function toggle(key: ImportKey, on: boolean) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      // Keep the pair consistent both ways (see withDependencies).
      if (!on && key === "placeFormats") next.delete("placeActive");
      return withDependencies(items, next);
    });
  }

  return (
    <Modal opened={opened} onClose={onClose} title={t("Import from Gramps desktop")} size="52rem">
      <Stack gap="sm">
        <Text size="sm">
          {t("Copies Gramps desktop's display preferences (Edit → Preferences) into these settings. Choose your gramps.ini, and place_formats.xml too if you've made your own place formats. Nothing is saved until you press Save.")}
        </Text>
        <Text size="xs" c="dimmed">
          {t("Linux and macOS: ~/.config/gramps/gramps60/gramps.ini and ~/.config/gramps/place_formats.xml (older installs: ~/.gramps/). Windows: %APPDATA%\\gramps\\gramps60\\gramps.ini and %APPDATA%\\gramps\\place_formats.xml.")}
        </Text>
        <Group grow align="flex-start">
          <FileInput label="gramps.ini" placeholder={t("Choose file…")} accept=".ini" value={iniFile} onChange={setIniFile} clearable />
          <FileInput
            label={`place_formats.xml (${t("optional")})`}
            placeholder={t("Choose file…")}
            accept=".xml"
            value={xmlFile}
            onChange={setXmlFile}
            clearable
          />
          <Select
            label={t("Desktop language")}
            description={t("Gramps numbers its date formats differently in each language")}
            allowDeselect={false}
            value={desktopLanguage}
            onChange={(value) => value && setDesktopLanguage(value)}
            data={Object.entries(DESKTOP_DATE_FORMATS)
              .map(([value, { label }]) => ({ value, label: t(label) }))
              .sort((a, b) => a.label.localeCompare(b.label))}
          />
        </Group>
        {error && <Alert color="red">{error}</Alert>}
        {ini && items.length === 0 && (
          <Text size="sm" c="dimmed">{t("This file has none of the settings Gramps Connect can use.")}</Text>
        )}
        {items.length > 0 && (
          <Table withTableBorder verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th />
                <Table.Th>{t("Setting")}</Table.Th>
                <Table.Th>{t("From Gramps desktop")}</Table.Th>
                <Table.Th>{t("Now")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((item) => (
                <Table.Tr key={item.key}>
                  <Table.Td>
                    <Checkbox
                      checked={item.usable && chosen.has(item.key)}
                      disabled={!item.usable}
                      onChange={(e) => toggle(item.key, e.currentTarget.checked)}
                      aria-label={t(ROW_LABELS[item.key])}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{t(ROW_LABELS[item.key])}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{desktopText(item)}</Text>
                    {item.isDefault && (
                      <Badge size="xs" variant="light" color="gray">
                        {t("Gramps default")}
                      </Badge>
                    )}
                    {item.reason && <Text size="xs" c="dimmed">{t(item.reason)}</Text>}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">{currentText(item.key, current)}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            disabled={chosen.size === 0}
            onClick={() => {
              onApply(applyImport(current, items, chosen));
              onClose();
            }}
          >
            {t("Use these settings")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
