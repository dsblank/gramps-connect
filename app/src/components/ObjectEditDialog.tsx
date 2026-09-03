import { useEffect, useRef, useState } from "react";
import {
  Alert, Anchor, Button, Collapse, ColorInput, Group, Loader, Modal, NumberInput, Stack, Switch, Text, TextInput,
  Textarea,
} from "@mantine/core";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { getToken } from "../auth/auth";
import { fetchPage, type QueryItem } from "../store/api";
import { CITATION_VIEW, MEDIA_VIEW, NOTE_VIEW, PLACE_VIEW, SOURCE_VIEW, TAG_VIEW } from "../store/views";
import { DRAFT_TYPE_LABELS, type DraftEntry, type DraftType } from "../store/draftStack";
import { DateInput } from "./DateInput";
import {
  MediaListField, RefListField, RefSlot, cancelledNewDraftHandles, findEditDraft, newDraftsByHandle,
  openNewListItemPatch, pickerResultLabel,
} from "./RefPickerField";
import { withGrampsId } from "./related/summary";
import {
  AttributeListField, AddressListField, UrlListField, type Attribute, type Address, type Url,
} from "./EmbeddedListFields";
import { StoryEditor } from "./story/StoryEditor";
import type { StorySpec } from "../store/storyBuilder";
import type { ViewConfig } from "../store/views";
import { t } from "../i18n/i18n";

type FieldSpec =
  | { kind: "text"; key: string; label: string; placeholder?: string }
  | { kind: "number"; key: string; label: string; min?: number; max?: number }
  | { kind: "switch"; key: string; label: string }
  | { kind: "color"; key: string; label: string }
  | { kind: "date"; key: string; label: string }
  | { kind: "placeName"; label: string }
  | { kind: "styledText"; key: string; label: string }
  | { kind: "storyEditor"; key: string; label: string }
  | {
      kind: "reference"; key: string; label: string; refView: ViewConfig; refField: string; required?: boolean;
      /** Opts this field into "+ New <Type>" / "✎ Edit" on top of plain
       * "Select existing…" -- spawning a nested draftStack DraftEntry
       * (openDraft/openEditDraft, both with `openedFrom` pointing back at
       * this field) rather than only ever picking something that already
       * exists. Every reference field sets this now (Event's `place`,
       * Citation's `source_handle`) -- omit it only for a reference type
       * with no create/edit dialog of its own to nest. */
      nestedType?: DraftType;
    }
  | { kind: "attributeList"; key: string; label: string }
  | { kind: "addressList"; key: string; label: string }
  | { kind: "urlList"; key: string; label: string }
  | {
      /** A plain-handle reference *list* -- Citations/Notes/Tags, phase 4's
       * generalization of PersonEditDialog.tsx's own Notes/Citations/Tags
       * fields (built on the same RefListField) to every other type that
       * carries one. `refType` is what gets created/edited (openDraft's own
       * type param); `searchField` is the flat column RecordPicker prefix-
       * matches when `refView.simpleSearch.buildExpr` isn't already an
       * override (same convention every other picker in this app uses). */
      kind: "refList"; key: string; label: string; refView: ViewConfig; refType: DraftType; searchField: string;
      createLabel: string;
    }
  | {
      /** Media -- same list shape as refList, but a wrapped `{_class:
       * "MediaRef", ref}` entry, and "+ New Media" is a file upload, not a
       * nested draft (see MediaListField.tsx's own doc comment for why). */
      kind: "mediaList"; key: string; label: string;
    };

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

// Shared refList/mediaList specs -- one object per list, reused across
// every type that actually carries that list (per RELATED_CONFIG in
// components/related/config.ts, which is the authority on which types
// have which: Repository/Note/Citation/Source don't all carry the same
// four, matching Gramps' own object model -- Source and Citation have no
// citation_list of their own, e.g., and Repository has neither citations
// nor media). Plain constants, not a factory: there's nothing per-type to
// parameterize beyond which subset of these four a given type's own
// `details` array includes.
const CITATIONS_FIELD: FieldSpec = {
  kind: "refList", key: "citation_list", label: "Citations", refView: CITATION_VIEW, refType: "citation",
  searchField: "gramps_id", createLabel: "Citation",
};
const NOTES_FIELD: FieldSpec = {
  kind: "refList", key: "note_list", label: "Notes", refView: NOTE_VIEW, refType: "note", searchField: "gramps_id",
  createLabel: "Note",
};
const TAGS_FIELD: FieldSpec = {
  kind: "refList", key: "tag_list", label: "Tags", refView: TAG_VIEW, refType: "tag", searchField: "name",
  createLabel: "Tag",
};
const MEDIA_FIELD: FieldSpec = { kind: "mediaList", key: "media_list", label: "Media" };

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
      CITATIONS_FIELD, NOTES_FIELD, MEDIA_FIELD, TAGS_FIELD,
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
      CITATIONS_FIELD, NOTES_FIELD, MEDIA_FIELD, TAGS_FIELD,
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
      // No CITATIONS_FIELD -- a Source has no citation_list of its own
      // (see components/related/config.ts's own comment on why: citations
      // point *at* a source, not the other way around).
      NOTES_FIELD, MEDIA_FIELD, TAGS_FIELD,
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
      // Repository carries neither citations nor media in Gramps' own
      // schema -- just these two.
      NOTES_FIELD, TAGS_FIELD,
    ],
  },
  citation: {
    quick: [
      GRAMPS_ID_FIELD,
      {
        kind: "reference", key: "source_handle", label: "Source", refView: SOURCE_VIEW, refField: "title",
        required: true, nestedType: "source",
      },
    ],
    details: [
      { kind: "text", key: "page", label: "Page" },
      { kind: "date", key: "date", label: "Date" },
      { kind: "number", key: "confidence", label: "Confidence", min: 0, max: 4 },
      { kind: "switch", key: "private", label: "Private" },
      { kind: "attributeList", key: "attribute_list", label: "Attributes" },
      // No CITATIONS_FIELD -- a citation doesn't cite another citation.
      NOTES_FIELD, MEDIA_FIELD, TAGS_FIELD,
    ],
  },
  note: {
    quick: [GRAMPS_ID_FIELD, { kind: "styledText", key: "text", label: "Text" }],
    details: [
      { kind: "text", key: "type", label: "Type", placeholder: TYPE_HINT },
      { kind: "switch", key: "private", label: "Private" },
      // A Note only ever carries tag_list -- no citation_list/note_list/
      // media_list of its own.
      TAGS_FIELD,
    ],
  },
  tag: {
    quick: [{ kind: "text", key: "name", label: "Name" }],
    details: [
      { kind: "color", key: "color", label: "Color" },
      { kind: "number", key: "priority", label: "Order priority", min: 0 },
    ],
  },
  // A story note's text.string is a JSON-stringified StorySpec
  // (storyBuilder.ts), not free text -- "storyEditor" (below) reads/writes
  // the same {_class: "StyledText", string} shape "styledText" uses for an
  // ordinary Note's text, just presented as a structured slide list instead
  // of hand-edited JSON. No citation_list/media_list/note_list fields: a
  // story note doesn't reference those the way a person or event would.
  story: {
    quick: [GRAMPS_ID_FIELD, { kind: "storyEditor", key: "text", label: "Story" }],
    details: [
      { kind: "switch", key: "private", label: "Private" },
      TAGS_FIELD,
    ],
  },
};

function allFields(type: DraftType): FieldSpec[] {
  const spec = FIELD_SPECS[type];
  return spec ? [...spec.quick, ...spec.details] : [];
}

interface ObjectEditDialogProps {
  draft: DraftEntry;
  opened: boolean;
  /** Every draft opened this session -- same array EditDialogs.tsx already
   * threads into FamilyEditDialog, needed here to find/reopen a
   * `nestedType` reference field's own in-progress nested draft. */
  stack: DraftEntry[];
  onChange: (patch: Record<string, unknown>) => void;
  /** Spawns a nested "new" draft for a `nestedType` reference field or a
   * `refList` field's own "+ New X" (draftStack.ts's openDraft with
   * `openedFrom` set to this field) -- returns the new draft's handle
   * synchronously (openDraft's own return value), which a `refList` field
   * needs to append to its own list immediately (a single `reference`
   * field doesn't: openDraft's `openedFrom` already wrote it there
   * directly, see FamilyEditDialog.tsx's identical distinction). */
  onOpenDraft: (type: DraftType, field: string) => string;
  /** Spawns a nested "edit" draft for an already-picked reference or list
   * entry (openEditDraft with `openedFrom`). */
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
  draft, opened, stack, onChange, onOpenDraft, onOpenEditDraft, onShowDraft, onCloseDraft, onCancel,
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
  // Note is the only other type with a styledText field -- the rest are
  // all short scalar/reference fields that are fine in the default-width
  // modal. Widened here (rather than just the Textarea) since a wide
  // textarea inside a narrow modal would just wrap awkwardly. Story's own
  // "json" field needs even more room than plain prose does -- a StorySpec
  // with several points reads far more comfortably at near-full-width than
  // "xl" allows.
  const modalSize = draft.type === "story" ? "90%" : draft.type === "note" ? "xl" : "md";

  // Same fix as FamilyEditDialog.tsx's father/mother seeding effect,
  // generalized across every field kind that points at another object --
  // single `reference` fields *and*, since phase 4, `refList`/`mediaList`
  // fields too: an edit draft's already-set value(s) come straight off the
  // server GET, with no entry yet in pickedLabels (only ever populated by
  // an in-session pick) -- without this, RefSlot/RefListField would show
  // an empty state for an already-set field, indistinguishable from a
  // genuinely empty one. Each field kind labels its results differently
  // (a `reference` field's own `refField` column vs. `pickerResultLabel`'s
  // per-type convention for a list), so this collects `{handle, view,
  // label}` triples up front and fetches them all the same way.
  useEffect(() => {
    if (draft.mode !== "edit" || draft.status !== "ready" || !spec) return;
    const draftHandles = new Set(
      stack.filter((d) => d.active && d.openedFrom?.handle === draft.handle).map((d) => d.handle)
    );
    const pending: { handle: string; view: ViewConfig; label: (item: QueryItem) => string }[] = [];
    function maybeAdd(handle: string | undefined, view: ViewConfig, label: (item: QueryItem) => string) {
      if (handle && !(handle in pickedLabels) && !draftHandles.has(handle)) pending.push({ handle, view, label });
    }
    for (const f of allFields(draft.type)) {
      if (f.kind === "reference") {
        maybeAdd(draft.data[f.key] as string | undefined, f.refView, (item) => {
          const text = (item[f.refField] as string | undefined) ?? "";
          return withGrampsId(item.gramps_id as string | undefined, text);
        });
      } else if (f.kind === "refList") {
        const refs = (draft.data[f.key] as string[] | undefined) ?? [];
        for (const h of refs) maybeAdd(h, f.refView, (item) => pickerResultLabel(f.refType, item));
      } else if (f.kind === "mediaList") {
        const refs = (draft.data[f.key] as { ref: string }[] | undefined) ?? [];
        for (const r of refs) maybeAdd(r.ref, MEDIA_VIEW, (item) => pickerResultLabel("media", item));
      }
    }
    if (pending.length === 0) return;
    (async () => {
      const token = await getToken();
      for (const { handle, view, label } of pending) {
        const { page } = await fetchPage(view, token, null, false, `handle == "${handle}"`);
        const item = page.items[0];
        if (item) setPickedLabels((prev) => ({ ...prev, [handle]: label(item) }));
      }
    })();
    // pickedLabels deliberately excluded -- see FamilyEditDialog.tsx's
    // identical effect for why.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.mode, draft.status, draft.type, draft.data, stack]);

  // New, since phase 4 -- ObjectEditDialog had no list fields (only single
  // `reference` ones) before this, so no pruning was ever needed: a single
  // field's own cancelled-draft cleanup is closeDraft's own job (nulls the
  // field directly), but a `refList` field's underlying array needs the
  // same two-part cleanup FamilyEditDialog.tsx's child_ref_list effect
  // does, generalized across however many refList fields this type has.
  useEffect(() => {
    if (!spec) return;
    const data = draft.data as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    let changed = false;

    const listFields = allFields(draft.type).filter(
      (f): f is Extract<FieldSpec, { kind: "refList" }> => f.kind === "refList"
    );
    const fieldPrefixes = listFields.map((f) => `__${f.key}_`);
    for (const key of Object.keys(data)) {
      if (fieldPrefixes.some((p) => key.startsWith(p)) && data[key] !== undefined) {
        patch[key] = undefined;
        changed = true;
      }
    }

    for (const f of listFields) {
      const cancelled = cancelledNewDraftHandles(stack, draft.handle, f.refType, `__${f.key}_`);
      if (cancelled.length === 0) continue;
      const refs = (data[f.key] as string[] | undefined) ?? [];
      if (refs.some((h) => cancelled.includes(h))) {
        patch[f.key] = refs.filter((h) => !cancelled.includes(h));
        changed = true;
      }
    }

    if (changed) onChange(patch);
  }, [stack, draft.handle, draft.data, draft.type, onChange]);

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
          <Alert color="red" title={t("Could not load")}>{draft.loadError}</Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={onCancel}>{t("Close")}</Button>
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
        <Alert color="red" title={t("No fields defined")}>Unknown object type "{draft.type}".</Alert>
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
      case "storyEditor": {
        // Same {_class: "StyledText", string} shape as "styledText" -- just
        // a StorySpec JSON-stringified into it rather than free text. Parsed
        // back into a spec for StoryEditor to render as a slide list; falls
        // back to an empty spec if the stored JSON is somehow missing or
        // invalid (only reachable at all in edit mode on an already-created
        // story note, so this is a defensive fallback, not a real path).
        const text = (draft.data[f.key] ?? {}) as Record<string, unknown>;
        const raw = (text.string as string | undefined) ?? "";
        let spec: StorySpec;
        try {
          const parsed = JSON.parse(raw);
          spec = { title: typeof parsed.title === "string" ? parsed.title : "", points: Array.isArray(parsed.points) ? parsed.points : [] };
        } catch {
          spec = { title: "", points: [] };
        }
        return (
          <StoryEditor
            key={f.key}
            spec={spec}
            onChange={(next) => onChange({ [f.key]: { _class: "StyledText", ...text, string: JSON.stringify(next) } })}
            previewStackId={`${draft.handle}-story-preview`}
          />
        );
      }
      case "reference": {
        const handle = (draft.data[f.key] as string | undefined) ?? null;
        const nestedDraft = f.nestedType ? findNestedDraft(f.key) : undefined;
        return (
          <RefSlot
            key={f.key}
            label={f.label}
            required={f.required}
            handle={handle}
            pickedLabel={handle ? (pickedLabels[handle] ?? null) : null}
            onPick={(item) => {
              const text = (item[f.refField] as string | undefined) ?? "";
              setPickedLabels((prev) => ({
                ...prev,
                [item.handle]: withGrampsId(item.gramps_id as string | undefined, text),
              }));
              onChange({ [f.key]: item.handle });
            }}
            onRemovePicked={() => onChange({ [f.key]: null })}
            nestedDraft={nestedDraft}
            onReopenNested={() => nestedDraft && onShowDraft(nestedDraft.handle)}
            onCancelNested={() => nestedDraft && onCloseDraft(nestedDraft.handle)}
            onOpenNew={f.nestedType ? () => onOpenDraft(f.nestedType!, f.key) : undefined}
            onOpenEdit={f.nestedType && handle ? () => onOpenEditDraft(f.nestedType!, handle, f.key) : undefined}
            createLabel={f.nestedType ? DRAFT_TYPE_LABELS[f.nestedType] : undefined}
            view={f.refView}
            searchField={f.refField}
            placeholder={`Search by ${f.refField}…`}
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
      case "refList": {
        const refs = (draft.data[f.key] as string[] | undefined) ?? [];
        const fieldPrefix = `__${f.key}_`;
        const editFieldPrefix = `__${f.key}_edit_`;
        return (
          <RefListField
            key={f.key}
            label={f.label}
            refs={refs}
            labels={pickedLabels}
            newDraftsByHandle={newDraftsByHandle(stack, draft.handle, f.refType, fieldPrefix)}
            findEditDraft={(h) => findEditDraft(stack, draft.handle, editFieldPrefix, h)}
            onAddExisting={(item) => {
              setPickedLabels((prev) => ({ ...prev, [item.handle]: pickerResultLabel(f.refType, item) }));
              onChange({ [f.key]: [...refs, item.handle] });
            }}
            onAddNew={() => onChange(openNewListItemPatch(onOpenDraft, f.refType, fieldPrefix, f.key, refs))}
            onRemoveExisting={(h) => onChange({ [f.key]: refs.filter((x) => x !== h) })}
            onOpenEditDraft={(h) => onOpenEditDraft(f.refType, h, `${editFieldPrefix}${h}`)}
            onReopenDraft={onShowDraft}
            onCancelDraft={onCloseDraft}
            view={f.refView}
            searchField={f.searchField}
            buildExpr={f.refView.simpleSearch?.buildExpr}
            renderLabel={(item) => pickerResultLabel(f.refType, item)}
            placeholder={f.refView.simpleSearch?.placeholder}
            createLabel={f.createLabel}
          />
        );
      }
      case "mediaList": {
        const refsRaw = (draft.data[f.key] as { _class: "MediaRef"; ref: string }[] | undefined) ?? [];
        return (
          <MediaListField
            key={f.key}
            label={f.label}
            refs={refsRaw.map((r) => r.ref)}
            labels={pickedLabels}
            onAddExisting={(item) => {
              setPickedLabels((prev) => ({ ...prev, [item.handle]: pickerResultLabel("media", item) }));
              onChange({ [f.key]: [...refsRaw, { _class: "MediaRef", ref: item.handle }] });
            }}
            onAdded={(handle, label) => {
              setPickedLabels((prev) => ({ ...prev, [handle]: label }));
              onChange({ [f.key]: [...refsRaw, { _class: "MediaRef", ref: handle }] });
            }}
            onRemove={(h) => onChange({ [f.key]: refsRaw.filter((r) => r.ref !== h) })}
          />
        );
      }
    }
  }

  const missingRequired = allFields(draft.type).some(
    (f) => f.kind === "reference" && f.required && !draft.data[f.key]
  );
  // A story needs a title and at least one slide -- StoryEditor can't
  // produce invalid JSON (it writes a JSON.stringify'd object, not
  // hand-typed text), so this replaces the old "json" field kind's
  // parse-validity check with the structural minimum StoryActions.tsx's
  // Present button and storyHydration.ts both expect.
  const invalidStory = draft.type === "story" && (() => {
    const f = allFields(draft.type).find((field): field is Extract<FieldSpec, { kind: "storyEditor" }> => field.kind === "storyEditor");
    if (!f) return false;
    const text = (draft.data[f.key] as { string?: string } | undefined)?.string ?? "";
    try {
      const spec = JSON.parse(text);
      return !(typeof spec.title === "string" && spec.title.trim() && Array.isArray(spec.points) && spec.points.length > 0);
    } catch {
      return true;
    }
  })();

  return (
    <Modal opened={opened} onClose={onCancel} title={title} stackId={draft.handle} size={modalSize}>
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
          <Alert color="red" title={t("Could not save")}>
            {error}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel} disabled={saving}>
            {t("Cancel")}
          </Button>
          <Button onClick={onPrimary} loading={saving} disabled={missingRequired || invalidStory}>
            {primaryLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
