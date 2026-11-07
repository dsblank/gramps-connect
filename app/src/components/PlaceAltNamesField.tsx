// A place's alternate names (alt_names): add, edit, remove. Each is a
// PlaceName like the primary one -- a value, a language, and a date for
// when the name applied ("Fort Wayne" vs an older name, with its era).
// Shared by ObjectEditDialog.tsx (the top-level Place editor) and
// PlaceEditDialog.tsx (the nested one).
//
// Which name a place title uses is placeDisplay.ts's nameAt: the primary
// name first, then these in order -- the first valid at the date whose
// language matches the place format's.
import { Group, Stack, TextInput } from "@mantine/core";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { ListShell } from "./EmbeddedListFields";
import { DateInput } from "./DateInput";
import { t } from "../i18n/i18n";

export interface PlaceNameItem {
  _class?: "PlaceName";
  value?: string;
  lang?: string;
  date?: GrampsDate;
}

interface PlaceAltNamesFieldProps {
  /** Prefix for each row's DateInput id, unique per editor. */
  idPrefix: string;
  items: PlaceNameItem[];
  onChange: (items: PlaceNameItem[]) => void;
}

export function PlaceAltNamesField({ idPrefix, items, onChange }: PlaceAltNamesFieldProps) {
  return (
    <ListShell
      label={t("Alternate names")}
      addLabel="Add alternate name"
      items={items}
      onChange={onChange}
      makeNew={(): PlaceNameItem => ({ _class: "PlaceName", value: "", lang: "" })}
      renderRow={(item, onPatch) => (
        <Stack gap={4}>
          <Group gap="xs" wrap="nowrap">
            <TextInput
              placeholder={t("Name")}
              aria-label={t("Alternate name")}
              value={item.value ?? ""}
              onChange={(e) => onPatch({ value: e.currentTarget.value })}
              style={{ flex: 1 }}
            />
            <TextInput
              placeholder={t("Language")}
              aria-label={t("Alternate name language")}
              title={t("e.g. en, fr, la")}
              value={item.lang ?? ""}
              onChange={(e) => onPatch({ lang: e.currentTarget.value })}
              w={90}
            />
          </Group>
          <DateInput
            id={`${idPrefix}-${items.indexOf(item)}`}
            label={t("Date")}
            description={t("When this name applied (optional)")}
            value={item.date ?? null}
            onChange={(date) => onPatch({ date: date ?? undefined })}
          />
        </Stack>
      )}
    />
  );
}
