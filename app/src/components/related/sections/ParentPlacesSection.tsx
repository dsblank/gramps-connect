import { useState } from "react";
import { Button, Group, Modal, Radio, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { getToken, hasPermissions } from "../../../auth/auth";
import { confirmDialog } from "../../../store/confirmDialog";
import { zipRefs, type RawRef } from "../../../store/objectDetail";
import {
  addEnclosingPlace, insertEnclosingLevel, moveEnclosingPlace, removeEnclosingPlace, setEnclosingPlaceDate,
} from "../../../store/placeHierarchy";
import type { QueryItem } from "../../../store/api";
import { PLACE_VIEW } from "../../../store/views";
import { CircleGlyphButton } from "../../CircleGlyphButton";
import { DateInput } from "../../DateInput";
import { RecordPicker } from "../../RecordPicker";
import { pickerResultLabel } from "../../RefPickerField";
import { summaryLine } from "../summary";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";
import { t } from "../../../i18n/i18n";

type Row = { ref: RawRef; target: unknown };

/** Place.placeref_list -- enclosing places (e.g. a city's placeref_list
 * points at its state/country); "places at this place" (the reverse) only
 * ever shows up via BacklinksSection.
 *
 * With EditObject, every operation on the hierarchy lives here (writes in
 * placeHierarchy.ts): "+" picks a place and, when this place already has
 * enclosing places, asks whether it goes *between* this place and one of
 * them (adding a level: city-in-state -> city-in-county-in-state) or
 * alongside them; each row can be removed, given a date (a PlaceRef's own
 * "enclosed by this place during ..." range) and, with more than one, moved
 * up/down -- the first undated one is what titles are built from. Neither
 * place editor shows placeref_list at all, so this section is also the
 * only place the hierarchy is ever visible. */
export function ParentPlacesSection({ detail, onNavigate, onRefetch }: SectionProps) {
  const rows: Row[] = zipRefs(detail.placeref_list, detail.extended?.places);
  const canEdit = hasPermissions("EditObject");
  const [adding, setAdding] = useState(false);
  const [datingIndex, setDatingIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  if (rows.length === 0 && !canEdit) return null;

  async function run(action: (token: string) => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action(await getToken());
      onRefetch?.();
    } catch (err) {
      notifications.show({
        color: "red",
        title: t("Couldn't change enclosing places"),
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(index: number, row: Row) {
    const summary = summaryLine("place", row.target) || t("this place");
    const message = rows.length === 1
      ? t("Remove %s as an enclosing place? This place becomes a top-level place. %s itself is not deleted.")
      : t("Remove %s as an enclosing place? %s itself is not deleted.");
    if (!(await confirmDialog(message.replace("%s", summary).replace("%s", summary), t("Remove")))) return;
    await run((token) => removeEnclosingPlace(token, detail.handle, index, row.ref.ref));
  }

  return (
    <SectionShell
      label={t("Enclosing places")}
      action={canEdit && (
        <CircleGlyphButton glyph="+" label={t("Add an enclosing place")} onClick={() => setAdding(true)} />
      )}
    >
      {rows.map((row, i) => (
        <RefRow
          key={`${i}-${row.ref.ref}`}
          type="place"
          handle={row.ref.ref}
          obj={row.target}
          refMeta={row.ref}
          onNavigate={onNavigate}
          extra={canEdit && (
            <>
              {rows.length > 1 && i > 0 && (
                <CircleGlyphButton
                  glyph="↑"
                  label={t("Move up")}
                  size={16}
                  onClick={() => run((token) => moveEnclosingPlace(token, detail.handle, i, row.ref.ref, -1))}
                />
              )}
              {rows.length > 1 && i < rows.length - 1 && (
                <CircleGlyphButton
                  glyph="↓"
                  label={t("Move down")}
                  size={16}
                  onClick={() => run((token) => moveEnclosingPlace(token, detail.handle, i, row.ref.ref, 1))}
                />
              )}
              <CircleGlyphButton glyph="📅" label={t("Set date")} size={16} onClick={() => setDatingIndex(i)} />
            </>
          )}
          onRemove={canEdit ? () => handleRemove(i, row) : undefined}
        />
      ))}
      {rows.length > 1 && canEdit && (
        <Text size="xs" c="dimmed">
          {t("Titles use the first enclosing place whose date fits (an undated one always fits).")}
        </Text>
      )}
      {adding && (
        <AddEnclosingPlaceDialog
          rows={rows}
          busy={busy}
          onClose={() => setAdding(false)}
          onAdd={async (picked, insertAt) => {
            await run((token) =>
              insertAt == null
                ? addEnclosingPlace(token, detail.handle, picked)
                : insertEnclosingLevel(token, detail.handle, insertAt, rows[insertAt].ref.ref, picked)
            );
            setAdding(false);
          }}
        />
      )}
      {datingIndex != null && rows[datingIndex] && (
        <EnclosingDateDialog
          row={rows[datingIndex]}
          busy={busy}
          onClose={() => setDatingIndex(null)}
          onSave={async (date) => {
            const index = datingIndex;
            await run((token) => setEnclosingPlaceDate(token, detail.handle, index, rows[index].ref.ref, date));
            setDatingIndex(null);
          }}
        />
      )}
    </SectionShell>
  );
}

/** Pick a place, then -- only when there's already an enclosing place to
 * put it next to -- say where it goes. "Between" is the default, since
 * adding a missing level (a county under an existing state) is the common
 * reason to be here; one choice per existing enclosing place, so a place
 * with several (historical boundary changes) can pick which one. */
function AddEnclosingPlaceDialog({ rows, busy, onClose, onAdd }: {
  rows: Row[];
  busy: boolean;
  onClose: () => void;
  onAdd: (picked: string, insertAt: number | null) => Promise<void>;
}) {
  const [picked, setPicked] = useState<QueryItem | null>(null);
  const [choice, setChoice] = useState("0");

  function handlePick(item: QueryItem) {
    if (rows.length === 0) {
      void onAdd(item.handle, null);
      return;
    }
    setPicked(item);
  }

  const pickedLabel = picked ? pickerResultLabel("place", picked) : "";

  return (
    <Modal opened onClose={onClose} title={t("Adding an enclosing place")} size="md">
      {!picked ? (
        <RecordPicker
          view={PLACE_VIEW}
          searchField="gramps_id"
          placeholder={PLACE_VIEW.simpleSearch?.placeholder ?? t("Search…")}
          buildExpr={PLACE_VIEW.simpleSearch?.buildExpr}
          renderLabel={(item) => pickerResultLabel("place", item)}
          onPick={handlePick}
          confirmWithButton
        />
      ) : (
        <Stack gap="sm">
          <Text size="sm">{t("Where does %s go?").replace("%s", pickedLabel)}</Text>
          <Radio.Group value={choice} onChange={setChoice}>
            <Stack gap="xs">
              {rows.map((row, i) => {
                const parent = summaryLine("place", row.target);
                return (
                  <Radio
                    key={`${i}-${row.ref.ref}`}
                    value={String(i)}
                    label={t("Between this place and %s").replace("%s", parent)}
                    description={t("This place moves inside %s, and %s goes inside %s.")
                      .replace("%s", pickedLabel).replace("%s", pickedLabel).replace("%s", parent)}
                  />
                );
              })}
              <Radio
                value="alongside"
                label={t("As another enclosing place")}
                description={t("Keep the current enclosing places and add this one next to them, e.g. for a boundary change -- give each a date afterwards.")}
              />
            </Stack>
          </Radio.Group>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPicked(null)}>{t("Back")}</Button>
            <Button
              loading={busy}
              onClick={() => void onAdd(picked.handle, choice === "alongside" ? null : Number(choice))}
            >
              {t("Add")}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

/** A PlaceRef's own date: when this place was inside that one. */
function EnclosingDateDialog({ row, busy, onClose, onSave }: {
  row: Row;
  busy: boolean;
  onClose: () => void;
  onSave: (date: GrampsDate | null) => Promise<void>;
}) {
  const [date, setDate] = useState<GrampsDate | null>((row.ref.date as GrampsDate | undefined) ?? null);
  const parent = summaryLine("place", row.target);
  return (
    <Modal opened onClose={onClose} title={t("Enclosed by %s").replace("%s", parent)} size="md">
      <Stack gap="sm">
        <DateInput
          id={`placeref-date-${row.ref.ref}`}
          label={t("Date")}
          description={t("When this place was inside %s, e.g. \"from 1820 to 1850\". Leave empty if always.").replace("%s", parent)}
          value={date}
          onChange={setDate}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>{t("Cancel")}</Button>
          <Button loading={busy} onClick={() => void onSave(date)}>{t("Save")}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
