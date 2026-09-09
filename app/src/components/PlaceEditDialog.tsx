import { useEffect, useState } from "react";
import { Button, Group, Modal, Stack, Switch, TextInput } from "@mantine/core";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { UrlListField, type Url } from "./EmbeddedListFields";
import { NewPlaceChoice, WikidataPlaceLookupButton } from "./WikidataPlaceLookupDialog";
import { DateInput } from "./DateInput";
import { t } from "../i18n/i18n";

const TYPE_HINT = "e.g. a built-in name, or your own custom label…";

interface PlaceEditDialogProps {
  stackId: string;
  opened: boolean;
  title: string;
  data: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  onDone: () => void;
  /** True for a still-blank "+ New Place" draft -- shows NewPlaceChoice's
   * "how do you want to add this?" screen up front instead of the plain
   * field form (see WikidataPlaceLookupButton's own doc comment on why).
   * False (the default) for an already-saved place being re-edited, which
   * has no such choice to make and keeps the inline "Look up on
   * Wikidata…" button as a plain enrichment action. */
  isNew?: boolean;
}

/** Full editor for one Place struct -- reusable the same way NameEditDialog.tsx
 * is: purely presentational (data in, patches out via onChange, no API calls
 * of its own), so a caller can bind it to whatever persistence shape fits --
 * a nested draftStack "place" DraftEntry (ObjectEditDialog.tsx's Place
 * reference fields), a locally-deferred birth/death Event's place
 * (PersonEditDialog.tsx), or an immediately-saved local dict (RelatedPanel's
 * event-creation dialog). Unlike Name, a Place is a real top-level object
 * with its own handle -- top-level New/Edit Place (MenuBar, the Places view)
 * still goes through ObjectEditDialog.tsx's own FIELD_SPECS-driven dialog,
 * unchanged; this component only ever appears nested inside another dialog
 * (see the plan). Same field set as that FIELD_SPECS entry (Wikidata
 * lookup, name, type, lat, long, private, urls) so both stay in sync by
 * inspection. A Wikidata Apply can also silently set `placeref_list`
 * (WikidataPlaceLookupDialog.tsx) -- there's no field here to see that
 * directly, same as the top-level dialog; ParentPlacesSection.tsx
 * (RelatedPanel) is the only place enclosing-place hierarchy is ever
 * displayed, and only once this place is actually saved. */
export function PlaceEditDialog({ stackId, opened, title, data, onChange, onDone, isNew = false }: PlaceEditDialogProps) {
  const name = (data.name ?? {}) as Record<string, unknown>;
  const titleValue = (name.value as string | undefined) ?? (data.title as string | undefined) ?? "";
  const [manualChosen, setManualChosen] = useState(false);
  // A fresh handle means a genuinely new draft (see EventPlaceField's own
  // "+ New Place" handler) -- reset back to the choice screen for it, same
  // reasoning as ObjectEditDialog.tsx's own session-reset effect.
  useEffect(() => {
    setManualChosen(false);
  }, [data.handle]);
  const showChoice = isNew && !manualChosen && !titleValue.trim();

  return (
    <Modal opened={opened} onClose={onDone} title={title} size="md" stackId={stackId}>
      {showChoice ? (
        <Stack gap="md">
          <NewPlaceChoice
            stackId={`${stackId}-wikidata`}
            onChange={onChange}
            onResolved={() => setManualChosen(true)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onDone}>{t("Cancel")}</Button>
          </Group>
        </Stack>
      ) : (
      <Stack gap="md">
        {!isNew && <WikidataPlaceLookupButton stackId={`${stackId}-wikidata`} data={data} onChange={onChange} />}
        <TextInput
          label={t("Name")}
          value={titleValue}
          onChange={(e) => {
            const v = e.currentTarget.value;
            onChange({ title: v, name: { _class: "PlaceName", ...name, value: v } });
          }}
          autoFocus
        />
        <TextInput
          label={t("Type")}
          placeholder={TYPE_HINT}
          value={(data.place_type as string | undefined) ?? ""}
          onChange={(e) => onChange({ place_type: e.currentTarget.value })}
        />
        <DateInput
          id={`${stackId}-name-date`}
          label={t("Date")}
          value={(name.date as GrampsDate | undefined) ?? null}
          onChange={(date) => onChange({ name: { _class: "PlaceName", ...name, date: date ?? undefined } })}
        />
        <TextInput
          label={t("Language")}
          placeholder="e.g. en, fr, la"
          value={(name.lang as string | undefined) ?? ""}
          onChange={(e) => onChange({ name: { _class: "PlaceName", ...name, lang: e.currentTarget.value } })}
        />
        <TextInput
          label={t("Latitude")}
          value={(data.lat as string | undefined) ?? ""}
          onChange={(e) => onChange({ lat: e.currentTarget.value })}
        />
        <TextInput
          label={t("Longitude")}
          value={(data.long as string | undefined) ?? ""}
          onChange={(e) => onChange({ long: e.currentTarget.value })}
        />
        <Switch
          label={t("Private")}
          checked={Boolean(data.private)}
          onChange={(e) => onChange({ private: e.currentTarget.checked })}
        />
        <UrlListField
          items={(data.urls as Url[] | undefined) ?? []}
          onChange={(items) => onChange({ urls: items })}
        />
        <Group justify="flex-end">
          <Button onClick={onDone}>{t("Done")}</Button>
        </Group>
      </Stack>
      )}
    </Modal>
  );
}
