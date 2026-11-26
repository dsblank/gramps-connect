// "Who is this?" for a box just drawn on a photo in the full-size view:
// find someone in the tree, or start a new person from the typed name.
// Kept inside the lightbox's own DOM (no portals): the lightbox closes on
// clicks that land outside the photo, and a portaled dropdown would count.
import { Button, Group, Loader, Paper, Select, Stack, Text, TextInput } from "@mantine/core";
import { useState, type ReactNode } from "react";
import { t } from "../../i18n/i18n";
import { useListSearch } from "../../store/listSearch";
import { PERSON_VIEW } from "../../store/views";
import { pickerResultLabel } from "../RefPickerField";
import type { FaceWho } from "../../store/markFace";

const NEW_PERSON = "__new_person__";

/** Splits "Anna Mae Miller" into first "Anna Mae", surname "Miller"; the
 * fields stay editable, so a wrong guess is easy to fix. */
function splitName(name: string): { first: string; surname: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return { first: words[0] ?? "", surname: "" };
  return { first: words.slice(0, -1).join(" "), surname: words[words.length - 1] };
}

export function FaceWhoPicker({ known = [], exclude, onPick, onCancel, saveIcon }: {
  /** People to offer first (e.g. the ones pinned on the Evidence Board). */
  known?: { value: string; label: string }[];
  /** Already marked in this photo. */
  exclude: Set<string>;
  onPick: (who: FaceWho) => void;
  onCancel: () => void;
  /** Shown on the confirming buttons (the board's tree mark). */
  saveIcon?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<{ first: string; surname: string } | null>(null);
  // The People list's own search, as in every other picker.
  const { items, loading } = useListSearch(PERSON_VIEW, query);
  const found = items.map((item) => ({ value: item.handle, label: pickerResultLabel("person", item) }));

  const q = query.trim();
  const lower = q.toLowerCase();
  const seen = new Set(exclude);
  const data: { value: string; label: string }[] = [];
  for (const o of [...known.filter((k) => !q || k.label.toLowerCase().includes(lower)), ...found]) {
    if (seen.has(o.value)) continue;
    seen.add(o.value);
    data.push(o);
  }
  if (q.length >= 2) data.push({ value: NEW_PERSON, label: `${t("New person")}: ${q}` });

  return (
    <Paper shadow="lg" p="sm" radius="md" w={300} data-lightbox-keep onPointerDown={(e) => e.stopPropagation()}>
      {draft ? (
        <Stack gap="xs">
          <Text size="sm" fw={600}>{t("New person")}</Text>
          <TextInput size="xs" label={t("First name")} value={draft.first} onChange={(e) => setDraft({ ...draft, first: e.currentTarget.value })} data-autofocus />
          <TextInput size="xs" label={t("Surname")} value={draft.surname} onChange={(e) => setDraft({ ...draft, surname: e.currentTarget.value })} />
          <Group justify="flex-end" gap="xs">
            <Button size="xs" variant="default" onClick={() => setDraft(null)}>{t("Back")}</Button>
            <Button size="xs" disabled={!draft.first.trim() && !draft.surname.trim()} rightSection={saveIcon} onClick={() => onPick({ first: draft.first.trim(), surname: draft.surname.trim() })}>
              {t("Add")}
            </Button>
          </Group>
        </Stack>
      ) : (
        <Stack gap="xs">
          <Text size="sm" fw={600}>{t("Who is this?")}</Text>
          <Select
            size="xs"
            autoFocus
            placeholder={t("Type a name")}
            searchable
            value={null}
            data={data}
            searchValue={query}
            onSearchChange={setQuery}
            filter={({ options }) => options}
            comboboxProps={{ withinPortal: false }}
            nothingFoundMessage={q.length < 2 ? t("Type at least two letters") : loading ? t("Searching…") : t("No one found")}
            rightSection={loading ? <Loader size="xs" /> : undefined}
            onChange={(v) => {
              if (!v) return;
              if (v === NEW_PERSON) setDraft(splitName(q));
              else onPick({ handle: v, label: data.find((o) => o.value === v)?.label ?? "" });
            }}
          />
          <Group justify="flex-end">
            <Button size="xs" variant="default" onClick={onCancel}>{t("Cancel")}</Button>
          </Group>
        </Stack>
      )}
    </Paper>
  );
}
