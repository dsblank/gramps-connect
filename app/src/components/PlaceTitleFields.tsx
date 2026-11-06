// A place's Name and Title fields, shared by ObjectEditDialog.tsx (the
// top-level Place editor) and PlaceEditDialog.tsx (the nested one).
//
// The stored title is what the Places list shows and what its search
// matches, so it's an editable field of its own, with a Rebuild button that
// writes it in the active place format from the name plus the enclosing
// places (draftPlaceTitle). Typing a name rebuilds the title too, but only
// while the title is still "following" the name (placeTitleFollowsName) --
// a hand-edited title is left alone.
import { useSyncExternalStore } from "react";
import { Button, TextInput } from "@mantine/core";
import { draftPlaceTitle, placeTitleFollowsName } from "../store/placeIndex";
import { getViewStore } from "../store/registry";
import { t } from "../i18n/i18n";

interface PlaceTitleFieldsProps {
  data: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  autoFocus?: boolean;
}

export function PlaceTitleFields({ data, onChange, autoFocus }: PlaceTitleFieldsProps) {
  // Re-render as the Places cache loads, so Rebuild enables once the
  // enclosing places' names are known.
  const placeStore = getViewStore("place");
  useSyncExternalStore(placeStore.subscribe, placeStore.getSnapshot);

  const name = (data.name ?? {}) as Record<string, unknown>;
  const nameValue = (name.value as string | undefined) ?? "";
  const title = (data.title as string | undefined) ?? "";
  const rebuilt = draftPlaceTitle(data);

  return (
    <>
      <TextInput
        label={t("Name")}
        value={nameValue}
        autoFocus={autoFocus}
        onChange={(e) => {
          const v = e.currentTarget.value;
          const nextName = { _class: "PlaceName", ...name, value: v };
          const patch: Record<string, unknown> = { name: nextName };
          if (placeTitleFollowsName(data)) {
            const nextTitle = draftPlaceTitle({ ...data, name: nextName });
            // Hierarchy not loaded yet: a title that was just the bare name
            // stays the bare name; a full one is left for Rebuild.
            if (nextTitle !== null) patch.title = nextTitle;
            else if (title.trim() === "" || title.trim() === nameValue.trim()) patch.title = v;
          }
          onChange(patch);
        }}
      />
      <TextInput
        label={t("Title")}
        description={t("Shown in the Places list, and matched by its search")}
        value={title}
        onChange={(e) => onChange({ title: e.currentTarget.value })}
        rightSectionWidth={80}
        rightSection={
          <Button
            size="compact-xs"
            variant="default"
            disabled={rebuilt === null || rebuilt === title}
            title={rebuilt === null ? t("Loading places…") : rebuilt}
            onClick={() => rebuilt !== null && onChange({ title: rebuilt })}
          >
            {t("Rebuild")}
          </Button>
        }
      />
    </>
  );
}
