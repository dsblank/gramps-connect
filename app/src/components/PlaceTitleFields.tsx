// A place's Name and Title fields, shared by ObjectEditDialog.tsx (the
// top-level Place editor) and PlaceEditDialog.tsx (the nested one).
//
// The stored title is what the Places list shows and what its search
// matches, so it's an editable field of its own. When the title the user
// has (typed, or the one the place came with) differs from what the active
// place format builds from the name plus the enclosing places
// (draftPlaceTitle), a two-option choice under the field shows both texts
// and picks between them. Picking is reversible -- the user's own title is
// remembered in `ownTitle`, so choosing the built one can be switched back.
// Typing a name rebuilds the title too, but only while the title is still
// "following" the name (placeTitleFollowsName) -- a hand-edited title is
// left alone.
import { useState, useSyncExternalStore } from "react";
import { Radio, Stack, Text, TextInput } from "@mantine/core";
import { draftPlaceTitle, placeTitleFollowsName } from "../store/placeIndex";
import { getViewStore } from "../store/registry";
import { t } from "../i18n/i18n";

interface PlaceTitleFieldsProps {
  data: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  autoFocus?: boolean;
}

export function PlaceTitleFields({ data, onChange, autoFocus }: PlaceTitleFieldsProps) {
  // Re-render as the Places cache loads, so the choice appears once the
  // enclosing places' names are known.
  const placeStore = getViewStore("place");
  useSyncExternalStore(placeStore.subscribe, placeStore.getSnapshot);

  const name = (data.name ?? {}) as Record<string, unknown>;
  const nameValue = (name.value as string | undefined) ?? "";
  const title = (data.title as string | undefined) ?? "";
  const rebuilt = draftPlaceTitle(data);
  // The user's own title: what the place came with, or what was last typed
  // into the Title field. Kept apart from `title` so picking the built
  // title can be undone by picking this one again.
  const [ownTitle, setOwnTitle] = useState(title);

  // Whenever the two differ -- a blank own title included (the Places list
  // then falls back to the bare name), so a place saved without a title is
  // offered the built one too.
  const showChoice = rebuilt !== null && ownTitle.trim() !== rebuilt.trim();
  const choice = title.trim() === (rebuilt ?? "").trim() ? "built" : "own";

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
            // stays the bare name; a full one is left alone.
            if (nextTitle !== null) patch.title = nextTitle;
            else if (title.trim() === "" || title.trim() === nameValue.trim()) patch.title = v;
          }
          // An own title that was itself only following the name follows
          // along, so no stale choice is offered; a hand-written one stays.
          if (typeof patch.title === "string" && placeTitleFollowsName({ ...data, title: ownTitle })) {
            setOwnTitle(patch.title);
          }
          onChange(patch);
        }}
      />
      <Stack gap={6}>
        <TextInput
          label={t("Title")}
          description={t("Shown in the Places list, and matched by its search")}
          value={title}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setOwnTitle(v);
            onChange({ title: v });
          }}
        />
        {showChoice && (
          <Radio.Group
            value={choice}
            onChange={(v) => onChange({ title: v === "built" ? rebuilt : ownTitle })}
          >
            <Stack gap={4}>
              <Radio
                size="xs"
                value="own"
                label={
                  <Text size="xs" span>
                    <Text size="xs" c="dimmed" span>{t("Your title:")}</Text>{" "}
                    {ownTitle.trim() ? ownTitle : <Text size="xs" c="dimmed" fs="italic" span>{t("(none — the list shows the name)")}</Text>}
                  </Text>
                }
              />
              <Radio
                size="xs"
                value="built"
                label={
                  <Text size="xs" span>
                    <Text size="xs" c="dimmed" span>{t("From the name and enclosing places:")}</Text> {rebuilt}
                  </Text>
                }
              />
            </Stack>
          </Radio.Group>
        )}
      </Stack>
    </>
  );
}
