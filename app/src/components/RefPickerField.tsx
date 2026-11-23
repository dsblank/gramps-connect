import { useState, type ReactNode } from "react";
import { Button, Group, Select, Stack, Text } from "@mantine/core";
import { FileButton } from "@mantine/core";
import { getToken } from "../auth/auth";
import { createHandle } from "../store/objectsApi";
import { uploadMediaFile } from "../store/jobsApi";
import { prepareImageUploads } from "../store/imageResize";
import { CircleGlyphButton } from "./CircleGlyphButton";
import { SortableList } from "./SortableList";
import { RecordPicker } from "./RecordPicker";
import { withGrampsId } from "./related/summary";
import { EVENT_ROLE_OPTIONS } from "./related/RefEditDialog";
import { EVENT_VIEW, MEDIA_VIEW, formatEventType, displayName } from "../store/views";
import type { QueryItem } from "../store/api";
import type { DraftEntry, DraftType } from "../store/draftStack";
import type { ViewConfig } from "../store/views";
import { t } from "../i18n/i18n";

/** A result's display label for a Person picker -- shared by every "pick an
 * existing Person" surface (Family's parent/child slots today; Associations
 * once phase 3 moves it into a dialog too). Leads with the Gramps ID, same
 * convention as every other type's own picker label. */
export function personLabel(item: QueryItem): string {
  return withGrampsId(item.gramps_id as string | undefined, displayName(item.primary_name) || "(unnamed)");
}

/** A result's display label for the four plain-handle-list picker types
 * (Note/Citation/Tag/Media) -- moved here from AttachControl.tsx once
 * RefListField below needed the exact same labels for the in-dialog
 * fields, not just the live-attach modal. Built from the *query-list*
 * shape fetchPage actually returns (each view's own flat `columns` --
 * see views.ts), not summary.ts's summaryLine(), which expects a
 * RelatedPanel-style extended detail fetch neither caller ever makes. */
export function pickerResultLabel(type: string, item: QueryItem): string {
  const id = item.gramps_id as string | undefined;
  switch (type) {
    case "note":
      return withGrampsId(id, (item.text as string | undefined) || "(untitled)");
    case "citation": {
      const title = (item.source_title as string | undefined) ?? "";
      const page = (item.page as string | undefined) ?? "";
      return withGrampsId(id, [title, page].filter(Boolean).join(", ") || "(untitled)");
    }
    case "tag":
      return (item.name as string | undefined) || "(untitled)";
    case "media":
      return withGrampsId(id, (item.desc as string | undefined) || (item.path as string | undefined) || "(untitled)");
    case "event": {
      // event_type's raw column value is the *stored* JSON-serialized
      // EventType struct (needed for SQL filtering, see views.ts's own
      // `toSql: toSqlJson`), not the plain string a full-object GET
      // returns elsewhere -- formatEventType is the same toDisplay
      // transform DataTable itself already applies to this column.
      const raw = item.event_type;
      const eventType = raw == null ? "" : formatEventType(typeof raw === "string" ? raw : JSON.stringify(raw));
      const desc = (item.description as string | undefined) ?? "";
      return withGrampsId(id, [eventType, desc].filter(Boolean).join(": ") || "(untitled)");
    }
    // Same label as every other "pick an existing Person" surface --
    // AssociationsSection.tsx/ChildrenSection.tsx's own AttachControl are
    // the first live-attach callers to search PERSON_VIEW, so this and the
    // "repository"/"place"/"source" cases below were picker types still
    // falling through to the raw-handle default until RelatedPanel's
    // sections started live-picking them too (RepositoriesSection.tsx/
    // ParentsSection.tsx/PlaceSection.tsx/SourceSection.tsx).
    case "person":
      return personLabel(item);
    case "repository":
      return withGrampsId(id, (item.name as string | undefined) || "(untitled)");
    case "place":
      return withGrampsId(id, (item.title as string | undefined) || "(untitled)");
    case "source":
      return withGrampsId(id, (item.title as string | undefined) || "(untitled)");
    case "family": {
      // father_name/mother_name are FAMILY_VIEW's json_path columns (views.ts)
      // -- raw JSON-serialized Name structs on a live query result, same as
      // event_type above, not the plain string a full-object GET returns.
      const father = displayName(item.father_name) || "?";
      const mother = displayName(item.mother_name) || "?";
      return withGrampsId(id, `${father} & ${mother}`);
    }
    default:
      return withGrampsId(id, item.handle);
  }
}

/** Display label for a nested draft -- either not-yet-saved (nothing to
 * fetch a real label from, so this reads straight off the draft's own
 * in-progress data) or an in-progress *edit* of an already-real record
 * (whose data, once loaded, already carries a real `gramps_id` -- leading
 * with it here keeps this consistent with every picked-existing label,
 * which always does). Dispatches on `draft.type` since each type's own
 * "name" lives in a genuinely different shape -- Person's primary_name,
 * Place/Source's name.value/title, Tag's own `name` as a bare string (not
 * a struct -- got this wrong once already, see the fixed bug this comment
 * replaces), Note's text.string, Citation's own page (it has no "name" of
 * its own at all until a Source is picked, so this is the closest thing). */
export function nestedDraftLabel(draft: DraftEntry): string {
  if (draft.status !== "ready") return "…";
  const grampsId = draft.data.gramps_id as string | undefined;
  switch (draft.type) {
    case "person": {
      return withGrampsId(grampsId, displayName(draft.data.primary_name) || "(unnamed)");
    }
    case "tag":
      return (draft.data.name as string | undefined) || "(unnamed)";
    case "note": {
      const text = (draft.data.text ?? {}) as { string?: string };
      return withGrampsId(grampsId, text.string || "(empty note)");
    }
    case "citation": {
      const page = draft.data.page as string | undefined;
      return withGrampsId(grampsId, page || "(new citation)");
    }
    case "event": {
      const eventType = draft.data.type as string | undefined;
      const desc = draft.data.description as string | undefined;
      return withGrampsId(grampsId, [eventType, desc].filter(Boolean).join(": ") || "(new event)");
    }
    default: {
      // place / source, and anything else that names itself the same way.
      const name = (draft.data.name ?? {}) as Record<string, unknown>;
      const value = (name.value as string | undefined) ?? (draft.data.title as string | undefined) ?? "";
      return withGrampsId(grampsId, value || "(unnamed)");
    }
  }
}

interface OccupiedRefRowProps {
  label: string;
  /** True for a not-yet-saved draft, false for an already-existing pick --
   * the only thing that still visually distinguishes the two now that both
   * get the same &#9998;/&minus; controls (see the plan: states 3 and 4 used
   * to diverge, a new draft's own label being the click target while an
   * existing pick got a separate button, and only on some surfaces). */
  isNew: boolean;
  /** Omitted (not just a no-op) for a reference field with no `nestedType`
   * -- i.e. no create/edit dialog of its own to nest at all. */
  onEdit?: () => void;
  onRemove: () => void;
  /** "Remove" for a new draft or a plain existing pick; "Cancel edit" while
   * an existing pick's own nested edit draft is in progress -- same nuance
   * ReferenceField already drew before this was generalized. */
  removeLabel: string;
  /** Optional control shown between the label and the &#9998;/&minus;
   * buttons -- EventsField's per-row Role select. */
  extra?: ReactNode;
  /** SortableList.tsx's drag grip, rendered first in the row. */
  grip?: ReactNode;
}

/** The unified "occupied" row -- a slot or list item that currently points
 * at something, whether that something is an already-saved record or a
 * still-unsaved nested draft. Same three controls either way: a plain
 * label, &#9998; Edit, &minus; Remove. */
export function OccupiedRefRow({ label, isNew, onEdit, onRemove, removeLabel, extra, grip }: OccupiedRefRowProps) {
  return (
    <Group gap="xs" wrap="nowrap">
      {grip}
      {isNew && (
        <Text
          size="10px"
          fw={700}
          tt="uppercase"
          c="blue"
          bg="var(--mantine-color-blue-light)"
          px={7}
          py={1}
          style={{ borderRadius: 100, letterSpacing: "0.04em", flexShrink: 0 }}
        >
          {t("new")}
        </Text>
      )}
      <Text size="sm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</Text>
      {extra}
      {onEdit && <CircleGlyphButton glyph="✎" label={t("Edit")} onClick={onEdit} size={16} />}
      <CircleGlyphButton glyph="−" label={removeLabel} onClick={onRemove} size={16} />
    </Group>
  );
}

interface SearchOrCreateProps {
  view: ViewConfig;
  searchField: string;
  buildExpr?: (term: string) => string | null;
  renderLabel?: (item: QueryItem) => string;
  placeholder?: string;
  onPick: (item: QueryItem) => void;
  /** Omitted for a reference field with no `nestedType` -- drops both the
   * "+ New X" button and the search results' own "create new" bridge. */
  onOpenNew?: () => void;
  /** e.g. "Person"/"Place"/"Source" -- used in both the "+ New X" button and
   * the search-results bridge's "create new X" copy. */
  createLabel?: string;
}

/** States 1 and 2 of the shared anatomy: empty (two equal-weight buttons) or
 * searching (RecordPicker, plus -- when `onOpenNew` is given -- a "not
 * finding it?" bridge right inside the results, so converting a search into
 * a new record doesn't mean backing out first). Deliberately has no opinion
 * about what "occupied" looks like once something's picked -- see
 * OccupiedRefRow and RefSlot for that. */
export function SearchOrCreate({
  view, searchField, buildExpr, renderLabel, placeholder, onPick, onOpenNew, createLabel,
}: SearchOrCreateProps) {
  const [searching, setSearching] = useState(false);

  if (searching) {
    return (
      <RecordPicker
        view={view}
        searchField={searchField}
        buildExpr={buildExpr}
        renderLabel={renderLabel}
        placeholder={placeholder ?? `Search by ${searchField}…`}
        onPick={(item) => {
          setSearching(false);
          onPick(item);
        }}
        createLabel={createLabel}
        onCreateNew={
          onOpenNew
            ? () => {
                setSearching(false);
                onOpenNew();
              }
            : undefined
        }
      />
    );
  }
  return (
    <Group gap="xs">
      <Button variant="default" size="xs" onClick={() => setSearching(true)}>
        {t("Select existing…")}
      </Button>
      {onOpenNew && (
        <Button variant="default" size="xs" onClick={onOpenNew}>
          + New {createLabel}
        </Button>
      )}
    </Group>
  );
}

interface RefSlotProps extends SearchOrCreateProps {
  label: string;
  required?: boolean;
  handle: string | null;
  pickedLabel: string | null;
  onRemovePicked: () => void;
  /** Omitted for a reference field with no `nestedType` -- gated
   * independently of `onOpenNew`, though in practice every reference field
   * with one capability has the other too. */
  onOpenEdit?: () => void;
  /** The in-progress nested "new" or "edit" draft this field's own
   * `openedFrom` spawned, if any -- found by the caller (each dialog knows
   * its own `stack`), not this component. */
  nestedDraft?: DraftEntry;
  onReopenNested?: () => void;
  onCancelNested?: () => void;
}

/** A single reference field -- Family's Father/Mother, Event's Place,
 * Citation's Source -- generalized from what were three separate
 * implementations (ParentSlot, ReferenceField) into one. Three states:
 * a nested draft in progress (new or edit), an existing pick, or empty
 * (SearchOrCreate). */
export function RefSlot({
  label, required, handle, pickedLabel, onRemovePicked, onOpenEdit, nestedDraft, onReopenNested, onCancelNested,
  ...searchOrCreate
}: RefSlotProps) {
  if (nestedDraft) {
    return (
      <Stack gap={4}>
        <Text size="sm" fw={500}>{label}</Text>
        <OccupiedRefRow
          label={nestedDraftLabel(nestedDraft)}
          isNew={nestedDraft.mode === "new"}
          onEdit={onReopenNested}
          onRemove={() => onCancelNested?.()}
          removeLabel={nestedDraft.mode === "new" ? "Remove" : "Cancel edit"}
        />
      </Stack>
    );
  }

  if (handle && pickedLabel) {
    return (
      <Stack gap={4}>
        <Text size="sm" fw={500}>{label}</Text>
        <OccupiedRefRow label={pickedLabel} isNew={false} onEdit={onOpenEdit} onRemove={onRemovePicked} removeLabel="Remove" />
      </Stack>
    );
  }

  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>{label}{required ? " (required)" : ""}</Text>
      <SearchOrCreate {...searchOrCreate} />
    </Stack>
  );
}

/** Active "new"-mode drafts opened from `parentHandle`'s own list fields
 * (any `openedFrom.field` starting with `fieldPrefix`), keyed by draft
 * handle -- which, for a not-yet-saved item, *is* the list entry's own ref
 * (draftStack's openDraft writes it there directly, same mechanism a
 * single reference field's "+ New X" already uses). Generalizes what was
 * FamilyEditDialog's own `childDraftsByHandle` into something any
 * list-of-references field can compute the same way. */
export function newDraftsByHandle(
  stack: DraftEntry[], parentHandle: string, targetType: DraftType, fieldPrefix: string
): Map<string, DraftEntry> {
  return new Map(
    stack
      .filter(
        (d) =>
          d.type === targetType && d.mode === "new" && d.active &&
          d.openedFrom?.handle === parentHandle && d.openedFrom.field.startsWith(fieldPrefix)
      )
      .map((d) => [d.handle, d] as const)
  );
}

/** The in-progress "edit" draft (if any) for one already-existing list
 * entry, found by the deterministic field name `${editFieldPrefix}${refHandle}`
 * -- no minting needed, unlike a "new" draft's field (see
 * FamilyEditDialog.tsx's EDIT_CHILD_FIELD_PREFIX for why editing an
 * existing item never needs one: openEditDraft doesn't write back to the
 * parent's data the way openDraft does, so the same field name is safe to
 * reuse on every click). */
export function findEditDraft(
  stack: DraftEntry[], parentHandle: string, editFieldPrefix: string, refHandle: string
): DraftEntry | undefined {
  return stack.find(
    (d) =>
      d.active && d.mode === "edit" && d.openedFrom?.handle === parentHandle &&
      d.openedFrom.field === `${editFieldPrefix}${refHandle}`
  );
}

/** Handles of cancelled "new"-mode drafts opened from `parentHandle`'s list
 * fields starting with `fieldPrefix` -- still present in the list (a
 * cancelled draft is marked inactive, never removed from `stack`, so it
 * needs to be filtered back out of whatever list field pointed at it; see
 * draftStack.ts's DraftEntry.active doc comment). */
export function cancelledNewDraftHandles(
  stack: DraftEntry[], parentHandle: string, targetType: DraftType, fieldPrefix: string
): string[] {
  return stack
    .filter(
      (d) =>
        d.type === targetType && d.mode === "new" && !d.active &&
        d.openedFrom?.handle === parentHandle && d.openedFrom.field.startsWith(fieldPrefix)
    )
    .map((d) => d.handle);
}

/** The common "+ New X" action every plain-handle refList field performs
 * the same way -- mint a synthetic field name, open a "new" nested draft
 * there, and append its handle (openDraft's own synchronous return value)
 * to the list -- written once here rather than three times over
 * (FamilyEditDialog.tsx, PersonEditDialog.tsx, ObjectEditDialog.tsx's own
 * "refList" field kind all need exactly this). Returns the patch rather
 * than calling onChange itself, so a caller with something else to merge
 * into the same tick still only calls onChange once. */
export function openNewListItemPatch(
  onOpenDraft: (type: DraftType, field: string) => string,
  targetType: DraftType,
  fieldPrefix: string,
  listKey: string,
  currentRefs: string[]
): Record<string, unknown> {
  const field = `${fieldPrefix}${createHandle()}`;
  const handle = onOpenDraft(targetType, field);
  return { [field]: undefined, [listKey]: [...currentRefs, handle] };
}

interface RefListFieldProps {
  label: string;
  /** Plain handles currently in the list -- the caller unwraps whatever
   * wire shape the underlying field actually uses (a bare string for
   * note_list/citation_list/tag_list; MediaListField/AssociationsField
   * below handle their own wrapped-ref shapes separately rather than
   * going through this component at all). */
  refs: string[];
  /** The order to show `refs` in, when it isn't the stored order (Tags:
   * priority order, see useTagOrder). Display only -- adds and removes
   * still work on `refs` as stored. */
  displayOrder?: (refs: string[]) => string[];
  /** Moves the entry at `from` to `to` (indexes into `refs`): gives each
   * row a drag grip (SortableList), for lists whose order matters in
   * Gramps (Notes, Citations). Ignored with `displayOrder`, whose rows
   * aren't in stored order. */
  onMove?: (from: number, to: number) => void;
  labels: Record<string, string>;
  newDraftsByHandle: Map<string, DraftEntry>;
  findEditDraft: (refHandle: string) => DraftEntry | undefined;
  onAddExisting: (item: QueryItem) => void;
  onAddNew: () => void;
  onRemoveExisting: (handle: string) => void;
  onOpenEditDraft: (refHandle: string) => void;
  onReopenDraft: (draftHandle: string) => void;
  onCancelDraft: (draftHandle: string) => void;
  view: ViewConfig;
  searchField: string;
  buildExpr?: (term: string) => string | null;
  renderLabel?: (item: QueryItem) => string;
  placeholder?: string;
  createLabel: string;
}

/** A whole list of references -- Person's Notes/Citations/Tags today, the
 * generalized shape of what was FamilyEditDialog's own Person-and-child_ref_
 * list-specific ChildrenField. Each row is the same OccupiedRefRow every
 * single-slot field already uses; "add another" is the same SearchOrCreate.
 * Deliberately has no extra-per-entry-field slot (a ChildRef's frel/mrel, a
 * PersonRef's rel) -- none of Notes/Citations/Tags carry one, so
 * AssociationsField stays its own small component rather than this one
 * growing an unused prop for everyone else. */
export function RefListField({
  label, refs, labels, newDraftsByHandle: newDrafts, findEditDraft: findEdit, onAddExisting, onAddNew,
  onRemoveExisting, onOpenEditDraft, onReopenDraft, onCancelDraft, view, searchField, buildExpr, renderLabel,
  placeholder, createLabel, displayOrder, onMove,
}: RefListFieldProps) {
  const pickedHandles = new Set(refs);
  const shown = displayOrder ? displayOrder(refs) : refs;

  function row(refHandle: string, grip?: ReactNode) {
    const nestedDraft = newDrafts.get(refHandle) ?? findEdit(refHandle);
    if (nestedDraft) {
      return (
        <OccupiedRefRow
          key={refHandle}
          label={nestedDraftLabel(nestedDraft)}
          isNew={nestedDraft.mode === "new"}
          onEdit={() => onReopenDraft(nestedDraft.handle)}
          onRemove={() => onCancelDraft(nestedDraft.handle)}
          removeLabel={nestedDraft.mode === "new" ? "Remove" : "Cancel edit"}
          grip={grip}
        />
      );
    }
    return (
      <OccupiedRefRow
        key={refHandle}
        label={labels[refHandle] ?? refHandle}
        isNew={false}
        onEdit={() => onOpenEditDraft(refHandle)}
        onRemove={() => onRemoveExisting(refHandle)}
        removeLabel="Remove"
        grip={grip}
      />
    );
  }

  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>{label}</Text>
      {refs.length === 0 && <Text size="xs" c="dimmed">No {label.toLowerCase()}</Text>}
      {onMove && !displayOrder ? (
        <SortableList keys={refs} onMove={onMove} gap={4} renderItem={(i, grip) => row(refs[i], grip)} />
      ) : (
        shown.map((refHandle) => row(refHandle))
      )}
      <SearchOrCreate
        view={view}
        searchField={searchField}
        buildExpr={buildExpr}
        renderLabel={renderLabel}
        placeholder={placeholder}
        onPick={(item) => {
          if (!pickedHandles.has(item.handle)) onAddExisting(item);
        }}
        onOpenNew={onAddNew}
        createLabel={createLabel}
      />
    </Stack>
  );
}

/** A copy of `list` with the item at `from` moved to `to` -- MediaListField's
 * onMove for an editor's draft list (whole entries, so a MediaRef keeps its
 * region/citations). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

interface MediaListFieldProps {
  label: string;
  refs: string[];
  labels: Record<string, string>;
  onAddExisting: (item: QueryItem) => void;
  /** Called once a freshly-chosen file has actually been uploaded and has a
   * real handle -- unlike every other list field's "+ New X", there's no
   * nested draft here to defer: a file has to actually be stored to get a
   * handle at all, so this happens immediately on selection rather than
   * waiting for the *Person*'s own Save. Only the attach step (appending
   * the handle to media_list) stays deferred like everything else -- if
   * the Person dialog is later cancelled, the upload itself doesn't roll
   * back (a known limitation shared with every other media upload path in
   * this app; nothing before this field could create Media at all). */
  onAdded: (handle: string, label: string) => void;
  onRemove: (handle: string) => void;
  /** Moves the entry at `from` to `to` (indexes into `refs`). The first
   * one is the record's own picture, so order matters here. */
  onMove: (from: number, to: number) => void;
  /** Says what the first entry is used for, shown with more than one; ""
   * hides it (a caller with its own hint nearby). */
  orderHint?: string;
}

/** Person's (and, from phase 4 on, every other type's) Media field. Rows
 * are always in the plain "existing pick" shape -- once uploaded, a Media
 * object is just as real as one picked via search, and there's no Media
 * edit dialog anywhere in this app (EDITABLE_TYPES excludes it -- path/
 * checksum are server-derived from the binary upload, not blank-form
 * fields) for a &#9998; button to open. "+ New Media" swaps SearchOrCreate's
 * usual nested-dialog trigger for a plain file picker, since a file is
 * the thing being created here, not a form. */
export function MediaListField({ label, refs, labels, onAddExisting, onAdded, onRemove, onMove, orderHint }: MediaListFieldProps) {
  const [searching, setSearching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickedHandles = new Set(refs);

  async function handleFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const prepared = await prepareImageUploads([file]);
      if (!prepared) return;
      const token = await getToken();
      const handle = await uploadMediaFile(token, prepared[0]);
      onAdded(handle, file.name);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>{label}</Text>
      {refs.length === 0 && <Text size="xs" c="dimmed">{t("No media")}</Text>}
      <SortableList
        keys={refs}
        onMove={onMove}
        gap={4}
        renderItem={(i, grip) => (
          <OccupiedRefRow
            label={labels[refs[i]] ?? refs[i]}
            isNew={false}
            onRemove={() => onRemove(refs[i])}
            removeLabel="Remove"
            grip={grip}
          />
        )}
      />
      {refs.length > 1 && orderHint !== "" && (
        <Text size="xs" c="dimmed">{orderHint ?? t("The first one is the picture shown for this record.")}</Text>
      )}
      {searching ? (
        <RecordPicker
          view={MEDIA_VIEW}
          searchField="gramps_id"
          buildExpr={MEDIA_VIEW.simpleSearch?.buildExpr}
          renderLabel={(item) => pickerResultLabel("media", item)}
          placeholder={MEDIA_VIEW.simpleSearch?.placeholder ?? "Search…"}
          onPick={(item) => {
            setSearching(false);
            if (!pickedHandles.has(item.handle)) onAddExisting(item);
          }}
        />
      ) : (
        <Group gap="xs">
          <Button variant="default" size="xs" onClick={() => setSearching(true)}>
            {t("Select existing…")}
          </Button>
          <FileButton onChange={handleFile}>
            {(props) => (
              <Button variant="default" size="xs" loading={uploading} {...props}>
                {t("+ New Media")}
              </Button>
            )}
          </FileButton>
        </Group>
      )}
      {error && <Text size="xs" c="red">{error}</Text>}
    </Stack>
  );
}

/** One EventRef -- `event_ref_list`'s own shape, shared verbatim by Person
 * and Family (both mix in Gramps' EventBase). */
export interface EventRefLite {
  _class: "EventRef";
  ref: string;
  role?: string;
}

interface EventsFieldProps {
  refs: EventRefLite[];
  labels: Record<string, string>;
  newDraftsByHandle: Map<string, DraftEntry>;
  findEditDraft: (refHandle: string) => DraftEntry | undefined;
  onAdd: (item: QueryItem, role: string) => void;
  onAddNew: (role: string) => void;
  onRemove: (handle: string) => void;
  onRoleChange: (handle: string, role: string) => void;
  /** Role a newly added link starts with: "Primary" for a Person, "Family"
   * for a Family (Gramps' own EditPerson/EditFamily defaults). */
  defaultRole: string;
  onOpenEditDraft: (refHandle: string) => void;
  onReopenDraft: (draftHandle: string) => void;
  onCancelDraft: (draftHandle: string) => void;
}

/** One row's Role select. A custom role already stored on the ref (not one
 * of the built-ins) is kept as an option so it still shows. */
function EventRoleSelect({ role, onChange }: { role: string; onChange: (role: string) => void }) {
  const values = EVENT_ROLE_OPTIONS.includes(role) ? EVENT_ROLE_OPTIONS : [...EVENT_ROLE_OPTIONS, role];
  return (
    <Select
      aria-label={t("Role")}
      data={values.map((v) => ({ value: v, label: t(v) }))}
      value={role}
      onChange={(next) => { if (next) onChange(next); }}
      allowDeselect={false}
      size="xs"
      w={120}
      style={{ flexShrink: 0 }}
      comboboxProps={{ withinPortal: true }}
    />
  );
}

/** Person/Family's own Events -- unlike Notes/Citations/Tags, an EventRef
 * carries its own `role` (Primary/Witness/...). A new link starts with
 * `defaultRole` and each row has its own Role select to change it after
 * adding, rather than a Role chosen up front: almost every event added
 * here is the person's (or family's) own, and choosing a role before
 * "+ New Event" read as a step about the event itself. Genealogically most
 * Events are made fresh for one Person/Family rather than picked from a
 * shared pool, but nothing stops two people from sharing one (a census
 * record, a joint anniversary) -- so this still gets the full "select
 * existing or create new" anatomy like everything else, not a create-only
 * shortcut. Reused as-is by both PersonEditDialog.tsx (which also filters
 * out its own birth/death indices before this ever sees them) and
 * FamilyEditDialog.tsx (no such filtering -- Family has no birth/death
 * concept). */
export function EventsField({
  refs, labels, newDraftsByHandle: newDrafts, findEditDraft: findEdit, onAdd, onAddNew, onRemove, onRoleChange,
  defaultRole, onOpenEditDraft, onReopenDraft, onCancelDraft,
}: EventsFieldProps) {
  const pickedHandles = new Set(refs.map((r) => r.ref));

  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>{t("Events")}</Text>
      {refs.length === 0 && <Text size="xs" c="dimmed">{t("No events")}</Text>}
      {refs.map((ref) => {
        const nestedDraft = newDrafts.get(ref.ref) ?? findEdit(ref.ref);
        const roleSelect = (
          <EventRoleSelect role={ref.role || defaultRole} onChange={(r) => onRoleChange(ref.ref, r)} />
        );
        if (nestedDraft) {
          return (
            <OccupiedRefRow
              key={ref.ref}
              label={nestedDraftLabel(nestedDraft)}
              extra={roleSelect}
              isNew={nestedDraft.mode === "new"}
              onEdit={() => onReopenDraft(nestedDraft.handle)}
              onRemove={() => onCancelDraft(nestedDraft.handle)}
              removeLabel={nestedDraft.mode === "new" ? "Remove" : "Cancel edit"}
            />
          );
        }
        const label = labels[ref.ref] ?? ref.ref;
        return (
          <OccupiedRefRow
            key={ref.ref}
            label={label}
            extra={roleSelect}
            isNew={false}
            onEdit={() => onOpenEditDraft(ref.ref)}
            onRemove={() => onRemove(ref.ref)}
            removeLabel="Remove"
          />
        );
      })}
      <Stack gap={4}>
        <SearchOrCreate
          view={EVENT_VIEW}
          searchField="gramps_id"
          buildExpr={EVENT_VIEW.simpleSearch?.buildExpr}
          renderLabel={(item) => pickerResultLabel("event", item)}
          placeholder={EVENT_VIEW.simpleSearch?.placeholder}
          onPick={(item) => {
            if (!pickedHandles.has(item.handle)) onAdd(item, defaultRole);
          }}
          onOpenNew={() => onAddNew(defaultRole)}
          createLabel="Event"
        />
      </Stack>
    </Stack>
  );
}
