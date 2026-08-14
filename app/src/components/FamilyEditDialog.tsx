import { useEffect, useState } from "react";
import {
  Alert, Anchor, Button, Card, Collapse, Group, Loader, Modal, Select, Stack, Switch, Text, TextInput,
} from "@mantine/core";
import { getToken } from "../auth/auth";
import { fetchPage, type QueryItem } from "../store/api";
import { PERSON_VIEW } from "../store/views";
import type { DraftEntry } from "../store/draftStack";

// FamilyRelType's built-in values (gramps/gen/lib/familyreltype.py) as plain
// English strings -- gramps-web-api's fix_object_dict() turns a `type`
// string back into the full GrampsType struct server-side, same as
// ./gramps-web/'s grampsjs-form-select-type already sends.
const REL_TYPE_OPTIONS = ["Married", "Unmarried", "Civil Union", "Unknown"];

type ParentField = "father_handle" | "mother_handle";

function personLabel(item: QueryItem): string {
  const given = (item.given_name as string | undefined) ?? "";
  const surname = (item.surname as string | undefined) ?? "";
  return [given, surname].filter(Boolean).join(" ") || "(unnamed)";
}

/** Builds PERSON_VIEW's where_expr from free text:
 * - any whitespace/comma-separated word that exactly matches a Gramps ID
 *   (e.g. "I2157") matches directly, regardless of what else is present
 *   -- lets an ID pasted alongside a name still hit.
 * - a comma splits the name-shaped part as "Surname, Given" -- the
 *   conventional Last, First order (e.g. "Smith, Lisa" -> surname prefix
 *   "Smith", given prefix "Lisa"), each side kept whole rather than
 *   further split, since either can itself be multiple words ("Van Der
 *   Berg, Lisa Marie").
 * - without a comma, a single word is checked against *both* given_name
 *   and surname (a bare "Smith" shouldn't require knowing which field
 *   it's in); two or more words take the *last* as a surname prefix and
 *   everything before it, joined, as a given-name prefix -- Gramps'
 *   given_name field can itself hold more than one word (e.g. "Mary
 *   Jane"), so "John Q Public" matches given_name~="John Q" and
 *   surname~="Public" rather than just the first word.
 * Quote/backslash characters are stripped rather than escaped, since a
 * where_expr is a parsed expression, not a value to sanitize into. */
function buildPersonSearchExpr(query: string): string | null {
  const sanitize = (s: string) => s.replace(/['\\]/g, "").trim();
  const trimmed = query.trim();
  if (trimmed.length < 2) return null;

  const idWords = trimmed.split(/[\s,]+/).map(sanitize).filter(Boolean);
  const idClause = `gramps_id in [${idWords.map((w) => `'${w}'`).join(", ")}]`;

  let nameClause: string;
  const commaIndex = trimmed.indexOf(",");
  if (commaIndex >= 0) {
    const surname = sanitize(trimmed.slice(0, commaIndex));
    const given = sanitize(trimmed.slice(commaIndex + 1));
    nameClause = `like(given_name, '${given}%') and like(surname, '${surname}%')`;
  } else {
    const words = trimmed.split(/\s+/).map(sanitize).filter(Boolean);
    if (words.length === 1) {
      nameClause = `like(given_name, '${words[0]}%') or like(surname, '${words[0]}%')`;
    } else {
      const surname = words[words.length - 1];
      const given = words.slice(0, -1).join(" ");
      nameClause = `like(given_name, '${given}%') and like(surname, '${surname}%')`;
    }
  }

  return `(${idClause}) or (${nameClause})`;
}

// Capped rather than raised when a search is too broad: a picker that can
// return hundreds of matches needs a narrower query, not a longer dropdown.
const RESULT_LIMIT = 20;

/** Search box for "Select existing" -- the only person-picker in the app so
 * far (see the plan's "out of scope" note: generalizing this is a follow-up
 * once a second consumer needs one). */
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

interface ParentSlotProps {
  label: string;
  field: ParentField;
  handle: string | null;
  /** The stack draft this handle points at, if it's a not-yet-saved "New
   * Person" (rather than an existing person picked by search). */
  childDraft: DraftEntry | undefined;
  isChildOpen: boolean;
  pickedLabel: string | null;
  /** False while editing an existing Family -- mixed create+edit is
   * deferred (see the plan), so an edit draft can only reference
   * already-existing people, not spawn a brand-new nested draft. */
  allowNewPerson: boolean;
  onOpenNewPerson: () => void;
  onPickExisting: (item: QueryItem) => void;
  onRemoveChildDraft: () => void;
  onRemovePicked: () => void;
  onReopenChildDraft: () => void;
}

function ParentSlot({
  label, field: _field, handle, childDraft, isChildOpen, pickedLabel, allowNewPerson,
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
          <Anchor component="button" type="button" size="sm" c="red" onClick={onRemoveChildDraft}>
            Remove
          </Anchor>
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
          <Anchor component="button" type="button" size="sm" c="red" onClick={onRemovePicked}>
            Remove
          </Anchor>
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
          {allowNewPerson && (
            <Button variant="default" size="xs" onClick={onOpenNewPerson}>
              + New Person
            </Button>
          )}
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
  onOpenPersonDraft: (field: ParentField) => void;
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
 * existing Person (picked via PersonSearch) or, only while creating a new
 * Family, spawn its own "New Person" dialog in the stack (draftStack.ts's
 * openDraft with openedFrom) -- see the plan's Save flow for why Cancel
 * here cascades to any such child drafts but Done on a child draft
 * doesn't, and why editing an existing Family can't spawn one at all
 * (mixed create+edit is deferred). */
export function FamilyEditDialog({
  draft, opened, stack, openHandles, onChange, onOpenPersonDraft, onShowDraft, onCloseDraft, onCancel,
  primaryLabel, onPrimary, saving, error,
}: FamilyEditDialogProps) {
  const [pickedLabels, setPickedLabels] = useState<Record<string, string>>({});
  const [showDetails, setShowDetails] = useState(false);

  // A freshly-opened edit draft's father_handle/mother_handle come straight
  // off the server GET -- pickedLabels (only ever populated by an in-session
  // PersonSearch pick) has no entry for either yet, which without this
  // effect left ParentSlot showing "Select existing..." for an *already
  // set* parent (falls through to the no-handle branch below, since that
  // branch keys on pickedLabel being present, not on `handle` alone) --
  // indistinguishable from an actually-empty slot, and one edit away from
  // silently overwriting the wrong parent. Fetches a label for whichever of
  // the two isn't already known, once.
  useEffect(() => {
    if (draft.mode !== "edit" || draft.status !== "ready") return;
    const handles = [draft.data.father_handle, draft.data.mother_handle].filter(
      (h): h is string => typeof h === "string" && h.length > 0 && !(h in pickedLabels)
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
  }, [draft.mode, draft.status, draft.data.father_handle, draft.data.mother_handle]);

  function findChildDraft(field: ParentField): DraftEntry | undefined {
    return stack.find((d) => d.active && d.openedFrom?.handle === draft.handle && d.openedFrom.field === field);
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
      allowNewPerson: draft.mode === "new",
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
        <ParentSlot {...slotProps("father_handle", "Father")} />
        <ParentSlot {...slotProps("mother_handle", "Mother")} />

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
          <Switch
            label="Private"
            checked={Boolean(draft.data.private)}
            onChange={(e) => onChange({ private: e.currentTarget.checked })}
          />
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
