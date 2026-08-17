import { useEffect, useRef, useState } from "react";
import {
  Alert, Anchor, Button, Collapse, ColorInput, Group, Loader, Modal, NumberInput, Stack, Switch, Text, TextInput,
  Textarea,
} from "@mantine/core";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { getToken } from "../auth/auth";
import { fetchPage, type QueryItem } from "../store/api";
import { PLACE_VIEW, SOURCE_VIEW } from "../store/views";
import { DRAFT_TYPE_LABELS, type DraftEntry, type DraftType } from "../store/draftStack";
import { DateInput } from "./DateInput";
import { RecordPicker } from "./RecordPicker";
import { CircleGlyphButton } from "./CircleGlyphButton";
import { withGrampsId } from "./related/summary";
import {
  AttributeListField, AddressListField, UrlListField, type Attribute, type Address, type Url,
} from "./EmbeddedListFields";
import type { ViewConfig } from "../store/views";

type FieldSpec =
  | { kind: "text"; key: string; label: string; placeholder?: string }
  | { kind: "number"; key: string; label: string; min?: number; max?: number }
  | { kind: "switch"; key: string; label: string }
  | { kind: "color"; key: string; label: string }
  | { kind: "date"; key: string; label: string }
  | { kind: "placeName"; label: string }
  | { kind: "styledText"; key: string; label: string }
  | {
      kind: "reference"; key: string; label: string; refView: ViewConfig; refField: string; required?: boolean;
      /** Opts this field into "+ New <Type>" / "✎ Edit" on top of plain
       * "Select existing…" -- spawning a nested draftStack DraftEntry
       * (openDraft/openEditDraft, both with `openedFrom` pointing back at
       * this field) rather than only ever picking something that already
       * exists. Scoped to Event's `place` field only for now, not
       * Citation's `source_handle` -- see the plan. */
      nestedType?: DraftType;
    }
  | { kind: "attributeList"; key: string; label: string }
  | { kind: "addressList"; key: string; label: string }
  | { kind: "urlList"; key: string; label: string };

const TYPE_HINT = "e.g. a built-in name, or your own custom label…";

// One entry per type ObjectEditDialog handles -- Person/Family have their
// own bespoke dialogs (PersonEditDialog.tsx/FamilyEditDialog.tsx) and are
// never routed here (see EditDialogs.tsx). Most fields here are a flat
// scalar or a single optional/required reference; reference-*list* fields
// to other top-level objects (citations, notes, media, tags on any of
// these types) stay out of scope -- those go through RelatedPanel's
// attach/detach instead (AttachControl.tsx/refListApi.ts), since they point
// at a separately-existing record. Attribute/Address/Url are the exception:
// they're inline structs with no handle of their own, so attach/detach
// doesn't apply to them -- attributeList/addressList/urlList kinds below
// edit those lists directly (see EmbeddedListFields.tsx and the plan).
// GrampsType fields (Event.type, Place.place_type, Repository.type,
// Note.type) are plain text, not curated dropdowns: gramps-web-api's
// fix_object_dict turns any string into a valid custom-or-known type
// server-side (same pattern already used for Family's relationship type),
// and sourcing each type's full enum is extra scope for later.
// Prepended to every type's `quick` fields below -- never set client-side
// for a "new" draft (draftStack.ts's defaultDataFor never touches it), so it
// starts blank and the key stays absent from the create POST unless the
// user types one in, letting gramps-web-api's own add_object auto-assign
// the next id exactly as it does when this field doesn't exist at all. On
// an edit draft, this pre-fills from the server GET and a changed value is
// just another field in the PUT -- update_object keeps the old id only when
// this comes back empty, otherwise honors whatever's here.
const GRAMPS_ID_FIELD: FieldSpec = { kind: "text", key: "gramps_id", label: "Gramps ID", placeholder: "auto-assigned" };

const FIELD_SPECS: Partial<Record<DraftType, { quick: FieldSpec[]; details: FieldSpec[] }>> = {
  event: {
    quick: [
      GRAMPS_ID_FIELD,
      { kind: "text", key: "type", label: "Type", placeholder: TYPE_HINT },
      { kind: "text", key: "description", label: "Description" },
    ],
    details: [
      { kind: "date", key: "date", label: "Date" },
      { kind: "reference", key: "place", label: "Place", refView: PLACE_VIEW, refField: "title", nestedType: "place" },
      { kind: "switch", key: "private", label: "Private" },
      { kind: "attributeList", key: "attribute_list", label: "Attributes" },
    ],
  },
  place: {
    quick: [GRAMPS_ID_FIELD, { kind: "placeName", label: "Name" }],
    details: [
      { kind: "text", key: "place_type", label: "Type", placeholder: TYPE_HINT },
      { kind: "text", key: "lat", label: "Latitude" },
      { kind: "text", key: "long", label: "Longitude" },
      { kind: "switch", key: "private", label: "Private" },
      { kind: "urlList", key: "urls", label: "Web links" },
    ],
  },
  source: {
    quick: [
      GRAMPS_ID_FIELD,
      { kind: "text", key: "title", label: "Title" },
      { kind: "text", key: "author", label: "Author" },
    ],
    details: [
      { kind: "text", key: "pubinfo", label: "Publication info" },
      { kind: "text", key: "abbrev", label: "Abbreviation" },
      { kind: "switch", key: "private", label: "Private" },
      { kind: "attributeList", key: "attribute_list", label: "Attributes" },
    ],
  },
  repository: {
    quick: [
      GRAMPS_ID_FIELD,
      { kind: "text", key: "name", label: "Name" },
      { kind: "text", key: "type", label: "Type", placeholder: TYPE_HINT },
    ],
    details: [
      { kind: "switch", key: "private", label: "Private" },
      { kind: "addressList", key: "address_list", label: "Addresses" },
      { kind: "urlList", key: "urls", label: "Web links" },
    ],
  },
  citation: {
    quick: [
      GRAMPS_ID_FIELD,
      {
        kind: "reference", key: "source_handle", label: "Source", refView: SOURCE_VIEW, refField: "title",
        required: true,
      },
    ],
    details: [
      { kind: "text", key: "page", label: "Page" },
      { kind: "date", key: "date", label: "Date" },
      { kind: "number", key: "confidence", label: "Confidence", min: 0, max: 4 },
      { kind: "switch", key: "private", label: "Private" },
      { kind: "attributeList", key: "attribute_list", label: "Attributes" },
    ],
  },
  note: {
    quick: [GRAMPS_ID_FIELD, { kind: "styledText", key: "text", label: "Text" }],
    details: [
      { kind: "text", key: "type", label: "Type", placeholder: TYPE_HINT },
      { kind: "switch", key: "private", label: "Private" },
    ],
  },
  tag: {
    quick: [{ kind: "text", key: "name", label: "Name" }],
    details: [
      { kind: "color", key: "color", label: "Color" },
      { kind: "number", key: "priority", label: "Priority", min: 0 },
    ],
  },
};

function allFields(type: DraftType): FieldSpec[] {
  const spec = FIELD_SPECS[type];
  return spec ? [...spec.quick, ...spec.details] : [];
}

/** Best-effort display label for a nested draft that isn't saved (or hasn't
 * finished loading) yet -- there's no server row to fetch a real label from.
 * Only ever called for `place` nested drafts today (see FieldSpec's
 * `nestedType` doc comment); reads the same title/name.value shape
 * PlaceEditDialog.tsx itself patches. */
function nestedDraftLabel(draft: DraftEntry): string {
  if (draft.status !== "ready") return "…";
  const name = (draft.data.name ?? {}) as Record<string, unknown>;
  const value = (name.value as string | undefined) ?? (draft.data.title as string | undefined) ?? "";
  return value || "(unnamed)";
}

interface ReferenceFieldProps {
  spec: Extract<FieldSpec, { kind: "reference" }>;
  handle: string | null;
  label: string | null;
  onPick: (item: QueryItem) => void;
  onRemove: () => void;
  /** The in-progress nested "new" or "edit" draft this field's `nestedType`
   * spawned (openDraft/openEditDraft with `openedFrom` pointing back at
   * this field), if any -- mirrors FamilyEditDialog's ParentSlot `childDraft`
   * concept, generalized past "new Person" to "new-or-edit <nestedType>". */
  nestedDraft?: DraftEntry;
  nestedOpen?: boolean;
  onOpenNew?: () => void;
  onOpenEdit?: () => void;
  onReopenNested?: () => void;
  onRemoveNestedDraft?: () => void;
}

function ReferenceField({
  spec, handle, label, onPick, onRemove, nestedDraft, nestedOpen, onOpenNew, onOpenEdit, onReopenNested,
  onRemoveNestedDraft,
}: ReferenceFieldProps) {
  const [searching, setSearching] = useState(false);

  if (nestedDraft) {
    const verb = nestedDraft.mode === "new" ? "New" : "Editing";
    return (
      <Stack gap={4}>
        <Text size="sm" fw={500}>{spec.label}</Text>
        <Group gap="xs">
          <Anchor component="button" type="button" size="sm" onClick={onReopenNested}>
            {verb} {DRAFT_TYPE_LABELS[nestedDraft.type]}: {nestedDraftLabel(nestedDraft)}
          </Anchor>
          {!nestedOpen && <Text size="xs" c="dimmed">(hidden -- click name to edit)</Text>}
          <CircleGlyphButton
            glyph="−"
            label={nestedDraft.mode === "new" ? "Remove" : "Cancel edit"}
            onClick={() => onRemoveNestedDraft?.()}
            size={16}
          />
        </Group>
      </Stack>
    );
  }

  if (handle && label) {
    return (
      <Stack gap={4}>
        <Text size="sm" fw={500}>{spec.label}</Text>
        <Group gap="xs">
          <Text size="sm">{label}</Text>
          {onOpenEdit && <CircleGlyphButton glyph="✎" label="Edit" onClick={onOpenEdit} size={16} />}
          <Anchor component="button" type="button" size="sm" c="red" onClick={onRemove}>
            Remove
          </Anchor>
        </Group>
      </Stack>
    );
  }

  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>{spec.label}{spec.required ? " (required)" : ""}</Text>
      {searching ? (
        <RecordPicker
          view={spec.refView}
          searchField={spec.refField}
          placeholder={`Search by ${spec.refField}…`}
          onPick={(item) => {
            setSearching(false);
            onPick(item);
          }}
        />
      ) : (
        <Group gap="xs">
          <Button variant="default" size="xs" onClick={() => setSearching(true)}>
            Select existing…
          </Button>
          {onOpenNew && (
            <Button variant="default" size="xs" onClick={onOpenNew}>
              + New {DRAFT_TYPE_LABELS[spec.nestedType!]}
            </Button>
          )}
        </Group>
      )}
    </Stack>
  );
}

interface ObjectEditDialogProps {
  draft: DraftEntry;
  opened: boolean;
  /** Every draft opened this session and which of them are currently shown
   * -- same two arrays EditDialogs.tsx already threads into
   * FamilyEditDialog, needed here to find/reopen a `nestedType` reference
   * field's own in-progress nested draft (see ReferenceField). */
  stack: DraftEntry[];
  openHandles: string[];
  onChange: (patch: Record<string, unknown>) => void;
  /** Spawns a nested "new" draft for a `nestedType` reference field
   * (draftStack.ts's openDraft with `openedFrom` set to this field). */
  onOpenDraft: (type: DraftType, field: string) => void;
  /** Spawns a nested "edit" draft for a `nestedType` reference field's
   * already-picked value (openEditDraft with `openedFrom`). */
  onOpenEditDraft: (type: DraftType, handle: string, field: string) => void;
  onShowDraft: (handle: string) => void;
  onCloseDraft: (handle: string) => void;
  onCancel: () => void;
  primaryLabel: string;
  onPrimary: () => void;
  saving: boolean;
  error: string | null;
}

/** The create/edit dialog for every type besides Person/Family (Event,
 * Place, Repository, Source, Citation, Note, Tag) -- driven entirely by
 * FIELD_SPECS above rather than one bespoke component per type, since
 * checking each type's actual schema found them all to be flat records
 * (see the plan). Same shell as PersonEditDialog.tsx/FamilyEditDialog.tsx
 * (loading/error states, "> Details" disclosure, Cancel/Save footer). */
export function ObjectEditDialog({
  draft, opened, stack, openHandles, onChange, onOpenDraft, onOpenEditDraft, onShowDraft, onCloseDraft, onCancel,
  primaryLabel, onPrimary, saving, error,
}: ObjectEditDialogProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [pickedLabels, setPickedLabels] = useState<Record<string, string>>({});

  // This dialog stays mounted (same `key={draft.handle}`) across a Cancel
  // and a later re-Edit of the *same* object -- draftStack.ts's
  // openEditDraft bumps `session` when that happens, rather than mounting a
  // fresh component -- so a "Details" disclosure left open from a cancelled
  // session would otherwise still show expanded next time. See
  // PersonEditDialog's identical session-reset effect for the fuller story.
  const sessionRef = useRef(draft.session);
  useEffect(() => {
    if (draft.session === sessionRef.current) return;
    sessionRef.current = draft.session;
    setShowDetails(false);
    setPickedLabels({});
  }, [draft.session]);

  const typeLabel = DRAFT_TYPE_LABELS[draft.type];
  const title = draft.mode === "edit" ? `Edit ${typeLabel}` : `New ${typeLabel}`;
  const spec = FIELD_SPECS[draft.type];
  // Note is the only type with a styledText field -- the rest are all
  // short scalar/reference fields that are fine in the default-width
  // modal. Widened here (rather than just the Textarea) since a wide
  // textarea inside a narrow modal would just wrap awkwardly.
  const modalSize = draft.type === "note" ? "xl" : "md";

  // Same fix as FamilyEditDialog.tsx's father/mother seeding effect: an
  // edit draft's already-set reference field comes straight off the
  // server GET, with no entry yet in pickedLabels (only ever populated by
  // an in-session RecordPicker pick) -- without this, ReferenceField would
  // show "Select existing..." for an already-set field, indistinguishable
  // from an empty one.
  useEffect(() => {
    if (draft.mode !== "edit" || draft.status !== "ready" || !spec) return;
    const refFields = allFields(draft.type).filter((f): f is Extract<FieldSpec, { kind: "reference" }> =>
      f.kind === "reference"
    );
    const toFetch = refFields
      .map((f) => ({ f, handle: draft.data[f.key] as string | undefined }))
      .filter((x): x is { f: Extract<FieldSpec, { kind: "reference" }>; handle: string } =>
        typeof x.handle === "string" && x.handle.length > 0 && !(x.handle in pickedLabels)
      );
    if (toFetch.length === 0) return;
    (async () => {
      const token = await getToken();
      for (const { f, handle } of toFetch) {
        const { page } = await fetchPage(f.refView, token, null, false, `handle == "${handle}"`);
        const item = page.items[0];
        const text = item ? (item[f.refField] as string | undefined) : undefined;
        if (text) setPickedLabels((prev) => ({ ...prev, [handle]: withGrampsId(item?.gramps_id as string | undefined, text) }));
      }
    })();
    // pickedLabels deliberately excluded -- see FamilyEditDialog.tsx's
    // identical effect for why.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.mode, draft.status, draft.type, draft.data]);

  if (draft.status === "loading") {
    return (
      <Modal opened={opened} onClose={onCancel} title={title} stackId={draft.handle} size={modalSize}>
        <Group justify="center" py="md">
          <Loader size="sm" />
        </Group>
      </Modal>
    );
  }
  if (draft.status === "error") {
    return (
      <Modal opened={opened} onClose={onCancel} title={title} stackId={draft.handle} size={modalSize}>
        <Stack gap="md">
          <Alert color="red" title="Could not load">{draft.loadError}</Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={onCancel}>Close</Button>
          </Group>
        </Stack>
      </Modal>
    );
  }
  function findNestedDraft(field: string): DraftEntry | undefined {
    return stack.find((d) => d.active && d.openedFrom?.handle === draft.handle && d.openedFrom.field === field);
  }

  if (!spec) {
    // Never actually reachable from EditDialogs.tsx (it only routes
    // person/family elsewhere and every other DraftType has a spec here),
    // but keeps this component total rather than crashing if that ever
    // drifts out of sync.
    return (
      <Modal opened={opened} onClose={onCancel} title={title} stackId={draft.handle} size={modalSize}>
        <Alert color="red" title="No fields defined">Unknown object type "{draft.type}".</Alert>
      </Modal>
    );
  }

  function renderField(f: FieldSpec) {
    switch (f.kind) {
      case "text":
        return (
          <TextInput
            key={f.key}
            label={f.label}
            placeholder={f.placeholder}
            value={(draft.data[f.key] as string | undefined) ?? ""}
            onChange={(e) => onChange({ [f.key]: e.currentTarget.value })}
          />
        );
      case "number":
        return (
          <NumberInput
            key={f.key}
            label={f.label}
            min={f.min}
            max={f.max}
            allowDecimal={false}
            value={(draft.data[f.key] as number | undefined) ?? ""}
            onChange={(v) => onChange({ [f.key]: Number(v) || 0 })}
          />
        );
      case "switch":
        return (
          <Switch
            key={f.key}
            label={f.label}
            checked={Boolean(draft.data[f.key])}
            onChange={(e) => onChange({ [f.key]: e.currentTarget.checked })}
          />
        );
      case "color":
        return (
          <ColorInput
            key={f.key}
            label={f.label}
            value={(draft.data[f.key] as string | undefined) ?? ""}
            onChange={(v) => onChange({ [f.key]: v })}
          />
        );
      case "date":
        return (
          <DateInput
            key={f.key}
            id={`${draft.handle}-${f.key}`}
            label={f.label}
            value={(draft.data[f.key] as GrampsDate | undefined) ?? null}
            onChange={(date) => onChange({ [f.key]: date })}
          />
        );
      case "placeName": {
        const name = (draft.data.name ?? {}) as Record<string, unknown>;
        const value = (name.value as string | undefined) ?? (draft.data.title as string | undefined) ?? "";
        return (
          <TextInput
            key="placeName"
            label={f.label}
            value={value}
            onChange={(e) => {
              const v = e.currentTarget.value;
              onChange({ title: v, name: { _class: "PlaceName", ...name, value: v } });
            }}
          />
        );
      }
      case "styledText": {
        const text = (draft.data[f.key] ?? {}) as Record<string, unknown>;
        const value = (text.string as string | undefined) ?? "";
        return (
          <Textarea
            key={f.key}
            label={f.label}
            autosize
            minRows={12}
            maxRows={30}
            value={value}
            onChange={(e) => onChange({ [f.key]: { _class: "StyledText", ...text, string: e.currentTarget.value } })}
          />
        );
      }
      case "reference": {
        const handle = (draft.data[f.key] as string | undefined) ?? null;
        const nestedDraft = f.nestedType ? findNestedDraft(f.key) : undefined;
        return (
          <ReferenceField
            key={f.key}
            spec={f}
            handle={handle}
            label={handle ? (pickedLabels[handle] ?? null) : null}
            onPick={(item) => {
              const text = (item[f.refField] as string | undefined) ?? "";
              setPickedLabels((prev) => ({
                ...prev,
                [item.handle]: withGrampsId(item.gramps_id as string | undefined, text),
              }));
              onChange({ [f.key]: item.handle });
            }}
            onRemove={() => onChange({ [f.key]: null })}
            nestedDraft={nestedDraft}
            nestedOpen={nestedDraft ? openHandles.includes(nestedDraft.handle) : false}
            onOpenNew={f.nestedType ? () => onOpenDraft(f.nestedType!, f.key) : undefined}
            onOpenEdit={f.nestedType && handle ? () => onOpenEditDraft(f.nestedType!, handle, f.key) : undefined}
            onReopenNested={() => nestedDraft && onShowDraft(nestedDraft.handle)}
            onRemoveNestedDraft={() => nestedDraft && onCloseDraft(nestedDraft.handle)}
          />
        );
      }
      case "attributeList":
        return (
          <AttributeListField
            key={f.key}
            items={(draft.data[f.key] as Attribute[] | undefined) ?? []}
            onChange={(items) => onChange({ [f.key]: items })}
          />
        );
      case "addressList":
        return (
          <AddressListField
            key={f.key}
            items={(draft.data[f.key] as Address[] | undefined) ?? []}
            onChange={(items) => onChange({ [f.key]: items })}
          />
        );
      case "urlList":
        return (
          <UrlListField
            key={f.key}
            items={(draft.data[f.key] as Url[] | undefined) ?? []}
            onChange={(items) => onChange({ [f.key]: items })}
          />
        );
    }
  }

  const missingRequired = allFields(draft.type).some(
    (f) => f.kind === "reference" && f.required && !draft.data[f.key]
  );

  return (
    <Modal opened={opened} onClose={onCancel} title={title} stackId={draft.handle}>
      <Stack gap="md">
        {spec.quick.map(renderField)}

        {spec.details.length > 0 && (
          <>
            <Anchor component="button" type="button" size="sm" onClick={() => setShowDetails((v) => !v)}>
              {showDetails ? "▾" : "▸"} Details
            </Anchor>
            <Collapse in={showDetails}>
              <Stack gap="md">{spec.details.map(renderField)}</Stack>
            </Collapse>
          </>
        )}

        {error && (
          <Alert color="red" title="Could not save">
            {error}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onPrimary} loading={saving} disabled={missingRequired}>
            {primaryLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
