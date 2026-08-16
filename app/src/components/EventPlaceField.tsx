import { useEffect, useState } from "react";
import { Anchor, Button, Group, Stack, Text } from "@mantine/core";
import { getToken } from "../auth/auth";
import { createHandle, fetchPlainObject, updateObject } from "../store/objectsApi";
import { PLACE_VIEW } from "../store/views";
import { RecordPicker } from "./RecordPicker";
import { PlaceEditDialog } from "./PlaceEditDialog";
import { CircleGlyphButton } from "./CircleGlyphButton";

export interface EventPlaceValue {
  handle: string;
  /** Set only while this points at a not-yet-saved "+ New Place" -- the
   * caller is expected to fold it into whatever create batch also creates
   * the Event this place belongs to (see PersonEditDialog.tsx's birth/death
   * extraCreate effect, or EventCreateDialog.tsx's own submit). Absent once
   * it names an existing, already-saved Place (picked via "Select
   * existing…", or once "✎ Edit"'s own immediate PUT below has landed). */
  pendingData?: Record<string, unknown>;
}

interface EventPlaceFieldProps {
  label: string;
  /** Unique per mounted instance -- becomes the nested PlaceEditDialog's
   * stackId. `label` alone ("Birth place") isn't enough: two Person drafts
   * can be open at once (draftStack.ts), each with its own "Birth place"
   * field, and Mantine's ModalStack needs distinct stackIds across all of
   * them, not just within one dialog. */
  id: string;
  value: EventPlaceValue | null;
  onChange: (value: EventPlaceValue | null) => void;
}

/** An Event's own Place picker, for the two corners that need one without
 * going through ObjectEditDialog.tsx's draftStack-mediated ReferenceField
 * (see PlaceEditDialog.tsx's own doc comment on why that's the third
 * reusable shape): PersonEditDialog.tsx's bespoke birth/death Event fields
 * (predates draftStack's nested-draft support) and RelatedPanel's
 * EventCreateDialog.tsx (self-contained, no draftStack draft at all -- an
 * Event created there is linked to an already-saved Person/Family
 * immediately, not deferred to some other dialog's Save).
 *
 * "+ New Place" holds its data locally (`value.pendingData`) until the
 * caller's own save/submit actually creates it; "✎ Edit" on an
 * already-saved place instead saves immediately when its dialog closes,
 * matching RefEditDialog.tsx/AttachControl.tsx's self-contained-immediate
 * convention rather than deferring to whatever else the caller is doing --
 * deliberate asymmetry, since only the not-yet-saved case has nothing to
 * PUT against yet (see the plan). One PlaceEditDialog Modal, only ever
 * toggled via `opened` rather than conditionally rendered, branching
 * internally on whether `value.pendingData` is set -- same never-unmount-a-
 * registered-Modal rule as everywhere else (draftStack.ts's
 * DraftEntry.active doc comment has the fuller story). Unlike
 * ObjectEditDialog.tsx's nested Place drafts (rendered at EditDialogs.tsx's
 * own flat top level, immune to this by construction), this component is
 * itself nested inside PersonEditDialog's own conditional loading/error/
 * ready `modalBody` -- so it's still unmounted, same as everything else
 * there, across the one narrow path PersonEditDialog's own "Computed rather
 * than three separate early returns" comment describes (Cancel, then
 * re-Edit the same Person, while this field's dialog had been opened at
 * least once). Accepted as a rare, cosmetic (ModalStack z-index bookkeeping
 * only, no data loss) gap rather than lifting this component's state up to
 * avoid it. */
export function EventPlaceField({ label, id, value, onChange }: EventPlaceFieldProps) {
  const [searching, setSearching] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [existingData, setExistingData] = useState<Record<string, unknown> | null>(null);
  const [existingLabel, setExistingLabel] = useState<string | null>(null);

  // Fetches the full dict (to seed "✎ Edit" from) and a display label for
  // an already-saved place, once per handle -- not needed for a "+ New
  // Place" still in progress (pendingData already has everything locally).
  useEffect(() => {
    if (!value || value.pendingData) {
      setExistingData(null);
      setExistingLabel(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const token = await getToken();
      const data = await fetchPlainObject(token, PLACE_VIEW, value.handle);
      if (cancelled) return;
      setExistingData(data);
      const name = (data.name ?? {}) as Record<string, unknown>;
      setExistingLabel((name.value as string | undefined) ?? (data.title as string | undefined) ?? "(unnamed)");
    })();
    return () => {
      cancelled = true;
    };
  }, [value?.handle, value?.pendingData]);

  async function saveExistingEdit() {
    if (!existingData) return;
    const token = await getToken();
    await updateObject(token, PLACE_VIEW, existingData.handle as string, existingData);
    const name = (existingData.name ?? {}) as Record<string, unknown>;
    setExistingLabel((name.value as string | undefined) ?? (existingData.title as string | undefined) ?? "(unnamed)");
    setDialogOpen(false);
  }

  const pendingTitle = value?.pendingData
    ? (((value.pendingData.name as Record<string, unknown> | undefined)?.value as string | undefined) ??
        (value.pendingData.title as string | undefined) ?? "(unnamed)")
    : null;

  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>{label}</Text>
      {value ? (
        <Group gap="xs">
          <Anchor component="button" type="button" size="sm" onClick={() => setDialogOpen(true)}>
            {pendingTitle ?? existingLabel ?? "…"}
          </Anchor>
          <CircleGlyphButton glyph="−" label="Remove" onClick={() => onChange(null)} size={16} />
        </Group>
      ) : searching ? (
        <RecordPicker
          view={PLACE_VIEW}
          searchField="title"
          placeholder="Search by title…"
          onPick={(item) => {
            setSearching(false);
            onChange({ handle: item.handle });
          }}
        />
      ) : (
        <Group gap="xs">
          <Button variant="default" size="xs" onClick={() => setSearching(true)}>
            Select existing…
          </Button>
          <Button
            variant="default"
            size="xs"
            onClick={() => {
              const handle = createHandle();
              onChange({
                handle,
                pendingData: { _class: "Place", handle, name: { _class: "PlaceName", value: "" }, title: "" },
              });
              setDialogOpen(true);
            }}
          >
            + New Place
          </Button>
        </Group>
      )}
      <PlaceEditDialog
        stackId={id}
        opened={dialogOpen && Boolean(value)}
        title={value?.pendingData ? "New Place" : "Edit Place"}
        data={value?.pendingData ?? existingData ?? {}}
        onChange={(patch) => {
          if (value?.pendingData) {
            onChange({ handle: value.handle, pendingData: { ...value.pendingData, ...patch } });
          } else {
            setExistingData((prev) => (prev ? { ...prev, ...patch } : prev));
          }
        }}
        onDone={() => (value?.pendingData ? setDialogOpen(false) : saveExistingEdit())}
      />
    </Stack>
  );
}
