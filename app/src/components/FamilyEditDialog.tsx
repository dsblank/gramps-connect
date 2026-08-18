import { useEffect, useRef, useState } from "react";
import {
  Alert, Anchor, Button, Card, Collapse, Group, Loader, Modal, Select, Stack, Switch, Text, TextInput,
} from "@mantine/core";
import { getToken } from "../auth/auth";
import { createHandle } from "../store/objectsApi";
import { CircleGlyphButton } from "./CircleGlyphButton";
import { AttributeListField, type Attribute } from "./EmbeddedListFields";
import { fetchPage, type QueryItem } from "../store/api";
import { buildPersonSearchExpr } from "../store/personSearch";
import { PERSON_VIEW } from "../store/views";
import { withGrampsId } from "./related/summary";
import { CHILD_REL_OPTIONS } from "./related/RefEditDialog";
import type { DraftEntry } from "../store/draftStack";

// FamilyRelType's built-in values (gramps/gen/lib/familyreltype.py) as plain
// English strings -- gramps-web-api's fix_object_dict() turns a `type`
// string back into the full GrampsType struct server-side, same as
// ./gramps-web/'s grampsjs-form-select-type already sends.
const REL_TYPE_OPTIONS = ["Married", "Unmarried", "Civil Union", "Unknown"];

type ParentField = "father_handle" | "mother_handle";

// Synthetic per-child `openedFrom.field` names for a new-person child draft
// -- see handleAddNewChildPerson's own doc comment for why these exist at
// all (draftStack's openedFrom is a single-field mechanism; a list needs
// one synthetic field per entry, cleaned up as each is used).
const NEW_CHILD_FIELD_PREFIX = "__newChild_";

function personLabel(item: QueryItem): string {
  const given = (item.given_name as string | undefined) ?? "";
  const surname = (item.surname as string | undefined) ?? "";
  const name = [given, surname].filter(Boolean).join(" ") || "(unnamed)";
  return withGrampsId(item.gramps_id as string | undefined, name);
}

// Capped rather than raised when a search is too broad: a picker that can
// return hundreds of matches needs a narrower query, not a longer dropdown.
const RESULT_LIMIT = 20;

/** Search box for "Select existing" -- the picker's own results list, using
 * the same buildPersonSearchExpr as FilterBar's Person-view simple search. */
function PersonSearch({ onPick }: { onPick: (item: QueryItem) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QueryItem[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const whereExpr = buildPersonSearchExpr(query);
    if (!whereExpr) {
      setResults([]);
      setTotalCount(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const token = await getToken();
      const { page, totalCount: count } = await fetchPage(
        PERSON_VIEW, token, null, true, whereExpr, PERSON_VIEW.orderBy, RESULT_LIMIT
      );
      if (!cancelled) {
        setResults(page.items);
        setTotalCount(count);
      }
    })()
      .catch(() => {
        if (!cancelled) {
          setResults([]);
          setTotalCount(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  return (
    <Stack gap="xs">
      <TextInput
        placeholder="Search by name…"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        rightSection={loading ? <Loader size="xs" /> : null}
        autoFocus
      />
      {results.length > 0 && (
        <Card withBorder padding="xs">
          <Stack gap={4}>
            {results.map((item) => (
              <Anchor key={item.handle} component="button" type="button" size="sm" onClick={() => onPick(item)}>
                {personLabel(item)}
              </Anchor>
            ))}
          </Stack>
        </Card>
      )}
      {totalCount !== null && totalCount > results.length && (
        <Text size="xs" c="dimmed">
          Showing {results.length} of {totalCount} — refine your search to narrow this down.
        </Text>
      )}
    </Stack>
  );
}

interface ChildRefLite {
  _class: "ChildRef";
  ref: string;
  frel?: string;
  mrel?: string;
}

interface ChildrenFieldProps {
  refs: ChildRefLite[];
  labels: Record<string, string>;
  onAdd: (item: QueryItem, frel: string, mrel: string) => void;
  onRemove: (handle: string) => void;
  /** Active "new"-mode Person drafts opened from this Family's children
   * (see FamilyEditDialog's handleAddNewChildPerson) -- keyed by handle, so
   * a child row whose Person hasn't been saved yet renders like ParentSlot's
   * own childDraft branch (live draft name, reopen, remove-the-draft)
   * instead of a plain label + remove-the-reference. */
  childDraftsByHandle: Map<string, DraftEntry>;
  openHandles: string[];
  onAddNewPerson: (frel: string, mrel: string) => void;
  onReopenChildDraft: (handle: string) => void;
  onRemoveChildDraft: (handle: string) => void;
}

/** Family.child_ref_list -- add an existing Person (search) or a brand-new
 * one (nested "New Person" draft, same pattern as the parent slots' own
 * "+ New Person" -- see FamilyEditDialog's handleAddNewChildPerson for how
 * a *list* of these coexists with draftStack's single-field `openedFrom`,
 * which father_handle/mother_handle use directly since they're each just
 * one field). frel/mrel (relationship to father/mother) are set *before*
 * adding -- the two Selects below, defaulting to Gramps' own default
 * ("Birth") -- rather than only afterward via a child row's own "✎ Edit"
 * (RefEditDialog, still there for changing one later). Not shown per
 * existing-child row here, same MVP scope as the parent slots not showing
 * every ChildRef field either. */
function ChildrenField({
  refs, labels, onAdd, onRemove, childDraftsByHandle, openHandles,
  onAddNewPerson, onReopenChildDraft, onRemoveChildDraft,
}: ChildrenFieldProps) {
  const [searching, setSearching] = useState(false);
  const [frel, setFrel] = useState("Birth");
  const [mrel, setMrel] = useState("Birth");
  const pickedHandles = new Set(refs.map((r) => r.ref));

  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>Children</Text>
      {refs.length === 0 && <Text size="xs" c="dimmed">No children</Text>}
      {refs.map((ref) => {
        const childDraft = childDraftsByHandle.get(ref.ref);
        if (childDraft) {
          const name = (childDraft.data.primary_name ?? {}) as {
            first_name?: string;
            surname_list?: { surname?: string }[];
          };
          const draftLabel = [name.first_name, name.surname_list?.[0]?.surname].filter(Boolean).join(" ") || "(unnamed)";
          const isOpen = openHandles.includes(childDraft.handle);
          return (
            <Group key={ref.ref} gap="xs">
              <Anchor component="button" type="button" size="sm" onClick={() => onReopenChildDraft(childDraft.handle)}>
                New Person: {draftLabel}
              </Anchor>
              {!isOpen && <Text size="xs" c="dimmed">(hidden -- click name to edit)</Text>}
              <CircleGlyphButton glyph="−" label="Remove" onClick={() => onRemoveChildDraft(childDraft.handle)} size={16} />
            </Group>
          );
        }
        return (
          <Group key={ref.ref} gap="xs">
            <Text size="sm">{labels[ref.ref] ?? ref.ref}</Text>
            <CircleGlyphButton glyph="−" label="Remove child" onClick={() => onRemove(ref.ref)} size={16} />
          </Group>
        );
      })}
      {searching ? (
        <PersonSearch
          onPick={(item) => {
            setSearching(false);
            if (!pickedHandles.has(item.handle)) onAdd(item, frel, mrel);
          }}
        />
      ) : (
        <Stack gap={4}>
          <Group gap="xs">
            <Select
              label="Relationship to father"
              data={CHILD_REL_OPTIONS}
              value={frel}
              onChange={(next) => setFrel(next ?? "Birth")}
              allowDeselect={false}
              size="xs"
              w={150}
              comboboxProps={{ withinPortal: true }}
            />
            <Select
              label="Relationship to mother"
              data={CHILD_REL_OPTIONS}
              value={mrel}
              onChange={(next) => setMrel(next ?? "Birth")}
              allowDeselect={false}
              size="xs"
              w={150}
              comboboxProps={{ withinPortal: true }}
            />
          </Group>
          <Group gap="xs">
            <CircleGlyphButton glyph="+" label="Add child" textLabel="Add child" onClick={() => setSearching(true)} />
            <Button variant="default" size="xs" onClick={() => onAddNewPerson(frel, mrel)}>
              + New Person
            </Button>
          </Group>
        </Stack>
      )}
    </Stack>
  );
}

interface ParentSlotProps {
  label: string;
  field: ParentField;
  handle: string | null;
  /** The stack draft this handle points at, if it's a not-yet-saved "New
   * Person" (rather than an existing person picked by search). */
  childDraft: DraftEntry | undefined;
  isChildOpen: boolean;
  pickedLabel: string | null;
  onOpenNewPerson: () => void;
  onPickExisting: (item: QueryItem) => void;
  onRemoveChildDraft: () => void;
  onRemovePicked: () => void;
  onReopenChildDraft: () => void;
}

function ParentSlot({
  label, field: _field, handle, childDraft, isChildOpen, pickedLabel,
  onOpenNewPerson, onPickExisting, onRemoveChildDraft, onRemovePicked, onReopenChildDraft,
}: ParentSlotProps) {
  const [searching, setSearching] = useState(false);

  if (childDraft) {
    const name = (childDraft.data.primary_name ?? {}) as {
      first_name?: string;
      surname_list?: { surname?: string }[];
    };
    const draftLabel = [name.first_name, name.surname_list?.[0]?.surname].filter(Boolean).join(" ") || "(unnamed)";
    return (
      <Stack gap={4}>
        <Text size="sm" fw={500}>{label}</Text>
        <Group gap="xs">
          <Anchor component="button" type="button" size="sm" onClick={onReopenChildDraft}>
            New Person: {draftLabel}
          </Anchor>
          {!isChildOpen && (
            <Text size="xs" c="dimmed">(hidden -- click name to edit)</Text>
          )}
          <CircleGlyphButton glyph="−" label="Remove" onClick={onRemoveChildDraft} size={16} />
        </Group>
      </Stack>
    );
  }

  if (handle && pickedLabel) {
    return (
      <Stack gap={4}>
        <Text size="sm" fw={500}>{label}</Text>
        <Group gap="xs">
          <Text size="sm">{pickedLabel}</Text>
          <CircleGlyphButton glyph="−" label="Remove" onClick={onRemovePicked} size={16} />
        </Group>
      </Stack>
    );
  }

  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>{label}</Text>
      {searching ? (
        <PersonSearch
          onPick={(item) => {
            setSearching(false);
            onPickExisting(item);
          }}
        />
      ) : (
        <Group gap="xs">
          <Button variant="default" size="xs" onClick={() => setSearching(true)}>
            Select existing…
          </Button>
          <Button variant="default" size="xs" onClick={onOpenNewPerson}>
            + New Person
          </Button>
        </Group>
      )}
    </Stack>
  );
}

interface FamilyEditDialogProps {
  draft: DraftEntry;
  opened: boolean;
  stack: DraftEntry[];
  openHandles: string[];
  onChange: (patch: Record<string, unknown>) => void;
  /** Returns the newly-created draft's handle (openDraft's own return
   * value, threaded straight through -- see EditDialogs.tsx's wiring). A
   * plain `string` field rather than `ParentField`: ChildrenField's own
   * "+ New Person" needs a fresh, unique field name per child (see
   * NEW_CHILD_FIELD_PREFIX below), not one of the two fixed parent slots. */
  onOpenPersonDraft: (field: string) => string;
  onShowDraft: (handle: string) => void;
  onCloseDraft: (handle: string) => void;
  onCancel: () => void;
  primaryLabel: string;
  onPrimary: () => void;
  saving: boolean;
  error: string | null;
}

/** The "New Family"/"Edit Family" dialog, depending on `draft.mode` --
 * quick fields (father, mother, relationship type) plus a "> Details"
 * disclosure (currently just privacy). Each parent slot can point at an
 * existing Person (picked via PersonSearch) or spawn its own "New Person"
 * dialog in the stack (draftStack.ts's openDraft with openedFrom), whether
 * this Family draft itself is "new" or "edit" -- see the plan's Save flow
 * for why Cancel here cascades to any such child drafts but Done on a
 * child draft doesn't. Mixing an "edit" Family with a nested "new" Person
 * works because saveAll() always POSTs every active "new" draft (in
 * dependency order) before it PUTs any "edit" draft, so the new parent/
 * child already exists by the time the Family's own PUT references its
 * handle. Children get the same "+ New Person" option
 * (handleAddNewChildPerson below), wired differently: draftStack's
 * openedFrom only ever writes *one* field (`{[field]: handle}`), which is
 * exactly what father_handle/mother_handle need and exactly not what a
 * *list* like child_ref_list needs. Each "+ New Person" click here mints
 * its own one-off synthetic field name (NEW_CHILD_FIELD_PREFIX + a random
 * suffix) purely so openDraft has something to write to and
 * orderedForSave/closeDraft have a handle->parent link to follow -- the
 * synthetic field's *value* is never read; the real bookkeeping is the
 * ChildRef this appends to child_ref_list immediately (using the handle
 * openDraft already returns synchronously) and the cleanup effect below,
 * which prunes that ChildRef back out if the nested Person draft is later
 * cancelled. */
export function FamilyEditDialog({
  draft, opened, stack, openHandles, onChange, onOpenPersonDraft, onShowDraft, onCloseDraft, onCancel,
  primaryLabel, onPrimary, saving, error,
}: FamilyEditDialogProps) {
  const [pickedLabels, setPickedLabels] = useState<Record<string, string>>({});
  const [showDetails, setShowDetails] = useState(false);

  // This dialog stays mounted (same `key={draft.handle}`) across a Cancel
  // and a later re-Edit of the *same* Family -- draftStack.ts's
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

  const childRefs = ((draft.data.child_ref_list as ChildRefLite[] | undefined) ?? []);

  // A freshly-opened edit draft's father_handle/mother_handle/child_ref_list
  // come straight off the server GET -- pickedLabels (only ever populated by
  // an in-session PersonSearch pick) has no entry for any of them yet, which
  // without this effect left ParentSlot showing "Select existing..." for an
  // *already set* parent (falls through to the no-handle branch below, since
  // that branch keys on pickedLabel being present, not on `handle` alone) --
  // indistinguishable from an actually-empty slot, and one edit away from
  // silently overwriting the wrong parent -- and left every existing child
  // showing its bare handle instead of a name. Fetches a label for whichever
  // of these isn't already known, once.
  useEffect(() => {
    if (draft.mode !== "edit" || draft.status !== "ready") return;
    const childHandles = ((draft.data.child_ref_list as ChildRefLite[] | undefined) ?? []).map((r) => r.ref);
    // Nested "+ New Person" drafts (father/mother/child) point at a handle
    // that only exists client-side until saveAll() -- fetching a label for
    // one would just waste a request (ParentSlot/ChildrenField already
    // render those from the draft itself, never from pickedLabels).
    const draftHandles = new Set(
      stack.filter((d) => d.active && d.openedFrom?.handle === draft.handle).map((d) => d.handle)
    );
    const handles = [draft.data.father_handle, draft.data.mother_handle, ...childHandles].filter(
      (h): h is string => typeof h === "string" && h.length > 0 && !(h in pickedLabels) && !draftHandles.has(h)
    );
    if (handles.length === 0) return;
    (async () => {
      const token = await getToken();
      for (const h of handles) {
        const { page } = await fetchPage(PERSON_VIEW, token, null, false, `handle == "${h}"`);
        const item = page.items[0];
        if (item) setPickedLabels((prev) => ({ ...prev, [h]: personLabel(item) }));
      }
    })();
    // pickedLabels deliberately excluded -- see the comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    draft.mode, draft.status, draft.handle, draft.data.father_handle, draft.data.mother_handle,
    draft.data.child_ref_list, stack,
  ]);

  // Two related bits of cleanup for the "+ New Person" child mechanism
  // (handleAddNewChildPerson's own doc comment explains the synthetic
  // fields this reacts to):
  //  1. Prunes child_ref_list once a pending child's own nested draft gets
  //     cancelled (its own dialog's Cancel, or this dialog's remove
  //     control -- both funnel through draftStack's closeDraft, which just
  //     marks the draft inactive; this is what turns that into "the
  //     ChildRef pointing at it disappears too").
  //  2. Strips any stray "__newChild_..." key back out of this Family
  //     draft's own data: handleAddNewChildPerson already neutralizes the
  //     one openDraft just wrote (to `undefined`, dropped by
  //     JSON.stringify), but closeDraft's own cascade writes `null` there
  //     on cancellation -- JSON.stringify does *not* drop `null` -- so
  //     without this, a cancelled child would leave a meaningless key in
  //     whatever gets sent to the server.
  // Both guarded so this settles after one run rather than looping: once
  // there's nothing left to prune or strip, the effect is a no-op on every
  // subsequent render.
  useEffect(() => {
    const familyData = draft.data as Record<string, unknown>;
    const strayFields = Object.keys(familyData).filter(
      (k) => k.startsWith(NEW_CHILD_FIELD_PREFIX) && familyData[k] !== undefined
    );
    const cancelledHandles = stack
      .filter(
        (d) =>
          d.type === "person" && d.mode === "new" && !d.active &&
          d.openedFrom?.handle === draft.handle && d.openedFrom.field.startsWith(NEW_CHILD_FIELD_PREFIX)
      )
      .map((d) => d.handle);
    const currentRefs = (familyData.child_ref_list as ChildRefLite[] | undefined) ?? [];
    const needsPruning = cancelledHandles.length > 0 && currentRefs.some((r) => cancelledHandles.includes(r.ref));
    if (strayFields.length === 0 && !needsPruning) return;
    const patch: Record<string, unknown> = {};
    for (const field of strayFields) patch[field] = undefined;
    if (needsPruning) patch.child_ref_list = currentRefs.filter((r) => !cancelledHandles.includes(r.ref));
    onChange(patch);
  }, [stack, draft.handle, draft.data, onChange]);

  function findChildDraft(field: ParentField): DraftEntry | undefined {
    return stack.find((d) => d.active && d.openedFrom?.handle === draft.handle && d.openedFrom.field === field);
  }

  // Active new-person drafts opened from one of *this* Family's children
  // (as opposed to its father/mother slots), keyed by handle -- what
  // ChildrenField uses to tell a not-yet-saved child apart from an
  // existing one it just needs a label for.
  const childDraftsByHandle = new Map(
    stack
      .filter(
        (d) =>
          d.type === "person" && d.mode === "new" && d.active &&
          d.openedFrom?.handle === draft.handle && d.openedFrom.field.startsWith(NEW_CHILD_FIELD_PREFIX)
      )
      .map((d) => [d.handle, d] as const)
  );

  function handleAddNewChildPerson(frel: string, mrel: string) {
    const field = `${NEW_CHILD_FIELD_PREFIX}${createHandle()}`;
    const handle = onOpenPersonDraft(field);
    // openDraft's own effect just wrote {[field]: handle} onto this Family
    // draft's data (its normal single-field behavior) -- undefined here
    // instead of using that value directly (already have `handle`, straight
    // from openDraft's return) because a stray "__newChild_..." key would
    // otherwise ride along in the Family's own create/update payload.
    // JSON.stringify drops undefined-valued keys, so this is enough to keep
    // it out of what actually reaches the server.
    onChange({
      [field]: undefined,
      child_ref_list: [...childRefs, { _class: "ChildRef", ref: handle, frel, mrel }],
    });
  }

  const title = draft.mode === "edit" ? "Edit Family" : "New Family";

  if (draft.status === "loading") {
    return (
      <Modal opened={opened} onClose={onCancel} title={title} size="lg" stackId={draft.handle}>
        <Group justify="center" py="md">
          <Loader size="sm" />
        </Group>
      </Modal>
    );
  }
  if (draft.status === "error") {
    return (
      <Modal opened={opened} onClose={onCancel} title={title} size="lg" stackId={draft.handle}>
        <Stack gap="md">
          <Alert color="red" title="Could not load">{draft.loadError}</Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={onCancel}>Close</Button>
          </Group>
        </Stack>
      </Modal>
    );
  }

  function slotProps(field: ParentField, label: string) {
    const handle = (draft.data[field] as string | null) ?? null;
    const childDraft = findChildDraft(field);
    return {
      label,
      field,
      handle,
      childDraft,
      isChildOpen: childDraft ? openHandles.includes(childDraft.handle) : false,
      pickedLabel: handle ? (pickedLabels[handle] ?? null) : null,
      onOpenNewPerson: () => onOpenPersonDraft(field),
      onPickExisting: (item: QueryItem) => {
        setPickedLabels((prev) => ({ ...prev, [item.handle]: personLabel(item) }));
        onChange({ [field]: item.handle });
      },
      onRemoveChildDraft: () => childDraft && onCloseDraft(childDraft.handle),
      onRemovePicked: () => onChange({ [field]: null }),
      onReopenChildDraft: () => childDraft && onShowDraft(childDraft.handle),
    };
  }

  return (
    <Modal opened={opened} onClose={onCancel} title={title} size="lg" stackId={draft.handle}>
      <Stack gap="lg">
        <TextInput
          label="Gramps ID"
          placeholder="auto-assigned"
          value={(draft.data.gramps_id as string | undefined) ?? ""}
          onChange={(e) => onChange({ gramps_id: e.currentTarget.value })}
        />
        <ParentSlot {...slotProps("father_handle", "Father")} />
        <ParentSlot {...slotProps("mother_handle", "Mother")} />

        <ChildrenField
          refs={childRefs}
          labels={pickedLabels}
          onAdd={(item, frel, mrel) => {
            setPickedLabels((prev) => ({ ...prev, [item.handle]: personLabel(item) }));
            onChange({
              child_ref_list: [...childRefs, { _class: "ChildRef", ref: item.handle, frel, mrel }],
            });
          }}
          onRemove={(handle) => onChange({ child_ref_list: childRefs.filter((r) => r.ref !== handle) })}
          childDraftsByHandle={childDraftsByHandle}
          openHandles={openHandles}
          onAddNewPerson={handleAddNewChildPerson}
          onReopenChildDraft={onShowDraft}
          onRemoveChildDraft={onCloseDraft}
        />

        <Select
          label="Relationship type"
          data={REL_TYPE_OPTIONS}
          value={(draft.data.type as string) ?? "Married"}
          onChange={(next) => onChange({ type: next ?? "Married" })}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
        />

        <Anchor component="button" type="button" size="sm" onClick={() => setShowDetails((v) => !v)}>
          {showDetails ? "▾" : "▸"} Details
        </Anchor>
        <Collapse in={showDetails}>
          <Stack gap="md">
            <Switch
              label="Private"
              checked={Boolean(draft.data.private)}
              onChange={(e) => onChange({ private: e.currentTarget.checked })}
            />
            <AttributeListField
              items={(draft.data.attribute_list as Attribute[] | undefined) ?? []}
              onChange={(items) => onChange({ attribute_list: items })}
            />
          </Stack>
        </Collapse>

        {error && (
          <Alert color="red" title="Could not save">
            {error}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onPrimary} loading={saving}>
            {primaryLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
