import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button, Checkbox, CloseButton, Divider, Group, Modal, NumberInput, ScrollArea,
  SegmentedControl, Stack, Text, Textarea, TextInput, Tooltip,
} from "@mantine/core";
import {
  gqlFilterPresets, type GqlFilterCategory, type GqlFilterNamespace, type GqlFilterPreset,
} from "../data/gqlFilterPresets";
import { FilterCombineError } from "../store/goqlFilterCombiner";
import {
  addConditionRow, addGroup, combineFilterTree, countConditions, createEmptyTree, moveNode,
  removeNode, setConnector, toggleNegate, updateRowValues,
  type FilterConditionRow, type FilterConnector, type FilterGroup, type FilterTree, type FilterTreeNode,
} from "../store/goqlFilterTree";
import { formatWhereExpr } from "../store/formatWhereExpr";
import { getFilterPickerState, setFilterPickerState } from "../store/filterPickerState";
import { useViewStore } from "../hooks/useViewStore";
import { getViewStore } from "../store/registry";
import { t } from "../i18n/i18n";

const CATEGORIES: GqlFilterCategory[] = ["Dates", "Properties", "Associations", "Tags", "Privacy"];

type Preview = { ok: true; whereExpr: string } | { ok: false; message: string } | null;

/** Applies one tree-mutation helper (goqlFilterTree.ts) and commits the
 * result -- every control below (a checkbox, a move/remove button, a
 * picked preset) goes through this same shape, never touching `tree`
 * directly. */
type Mutate = (fn: (tree: FilterTree) => FilterTree) => void;

interface FilterPickerDialogProps {
  opened: boolean;
  onClose: () => void;
  viewKey: string;
  /** For the title ("Filters — People") -- ViewConfig.label. */
  viewLabel: string;
  namespace: GqlFilterNamespace;
}

/** The "Filters" trigger's dialog: a direct, recursive editor for a
 * `FilterTree` (goqlFilterTree.ts) -- AND/OR groups, inline NOT on any row
 * or group, and nesting, all scoped to one namespace (Person presets never
 * show up while editing Family's list, see project_goql_filter_system_design
 * memory).
 *
 * One dialog, not "a simple picker plus a separate arrange screen": a flat
 * list of checked presets *is* a `FilterTree` with no nesting and no
 * negation, so the common case is just what this renders before anyone
 * uses the extra power. "+ Add condition" expands its search list inline
 * (never a `Popover`) -- AttachControl.tsx's own doc comment covers why a
 * scrollable list of clickable rows misbehaves inside a Popover's
 * outside-click handling, and this is already a Modal, so a second
 * floating layer nested inside it would hit the same problem again.
 *
 * Applies through ViewStore.setPickerFilter()/clearPickerFilter() -- a
 * slot (`pickerExpr`) kept fully independent of FilterBar's own
 * `whereExpr`, so applying here ANDs with (never replaces) whatever's
 * currently typed in the search box, and vice versa. See
 * ViewSnapshot.pickerExpr's doc comment in viewStore.ts.
 */
export function FilterPickerDialog({
  opened, onClose, viewKey, viewLabel, namespace,
}: FilterPickerDialogProps) {
  const snapshot = useViewStore(viewKey);
  const [tree, setTreeState] = useState<FilterTree>(
    () => getFilterPickerState(viewKey, namespace).tree,
  );
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  function setTree(next: FilterTree) {
    setTreeState(next);
    setFilterPickerState(viewKey, next);
  }
  const mutate: Mutate = (fn) => setTree(fn(tree));

  // Mirrors FilterBar.tsx's own external-clear effect: a person-link
  // navigation (ViewStore.navigateToHandle) or clearPickerFilter() called
  // from elsewhere can drop pickerExpr out from under this dialog while
  // it's mounted but closed -- without this, reopening it would still
  // show the stale tree, and clicking Apply unchanged would silently
  // resurrect a filter that was just dropped. Skips its very first run:
  // mounting with a restored (possibly non-empty) tree but a snapshot
  // that legitimately starts at pickerExpr === null is the ordinary case,
  // not an external clear.
  const skipNextPickerExprClear = useRef(true);
  useEffect(() => {
    if (skipNextPickerExprClear.current) {
      skipNextPickerExprClear.current = false;
      return;
    }
    if (snapshot.pickerExpr !== null) return;
    setTree(createEmptyTree(namespace));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.pickerExpr]);

  // Recomputed on every edit -- cheap (a handful of string-only presets) --
  // so the preview (and the Apply button's disabled state) reflect a bad/
  // missing param value immediately, not only once Apply is clicked.
  const preview: Preview = useMemo(() => {
    if (countConditions(tree) === 0) return null;
    try {
      const combined = combineFilterTree(tree, gqlFilterPresets);
      return { ok: true, whereExpr: combined.whereExpr };
    } catch (err) {
      return { ok: false, message: err instanceof FilterCombineError ? err.message : String(err) };
    }
  }, [tree]);

  async function handleApply() {
    setError(null);
    const store = getViewStore(viewKey);
    setApplying(true);
    try {
      if (preview === null) {
        await store.clearPickerFilter();
      } else if (preview.ok) {
        await store.setPickerFilter(preview.whereExpr);
      } else {
        return; // Apply is disabled in this state; nothing to do.
      }
      onClose();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setApplying(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={`${t("Filters")} — ${t(viewLabel)}`}
      size="lg"
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <Stack gap="md">
        <FilterTreeNodeView node={tree.root} isRoot namespace={namespace} mutate={mutate} />

        <Divider />

        {preview && (
          <Stack gap={4}>
            <Text size="xs" c="dimmed">{t("GOQL:")}</Text>
            {preview.ok ? (
              <Textarea
                readOnly
                autosize
                minRows={2}
                maxRows={10}
                ff="monospace"
                size="xs"
                value={formatWhereExpr(preview.whereExpr)}
              />
            ) : (
              <Text size="xs" c="red">{preview.message}</Text>
            )}
          </Stack>
        )}
        {error && <Text size="xs" c="red">{error}</Text>}

        <Group justify="space-between">
          <Button
            variant="subtle"
            color="gray"
            disabled={countConditions(tree) === 0}
            onClick={() => setTree(createEmptyTree(namespace))}
          >
            {t("Clear all")}
          </Button>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>{t("Cancel")}</Button>
            <Button onClick={handleApply} loading={applying} disabled={preview?.ok === false}>
              {t("Apply")}{countConditions(tree) > 0 ? ` (${countConditions(tree)})` : ""}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

function FilterTreeNodeView({
  node, isRoot = false, namespace, mutate,
}: {
  node: FilterTreeNode;
  isRoot?: boolean;
  namespace: GqlFilterNamespace;
  mutate: Mutate;
}) {
  if (node.kind === "group") {
    return <GroupView group={node} isRoot={isRoot} namespace={namespace} mutate={mutate} />;
  }
  return <RowView row={node} namespace={namespace} mutate={mutate} />;
}

function GroupView({
  group, isRoot, namespace, mutate,
}: {
  group: FilterGroup;
  isRoot: boolean;
  namespace: GqlFilterNamespace;
  mutate: Mutate;
}) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <Stack
      gap={6}
      pl={isRoot ? 0 : 12}
      style={isRoot ? undefined : { borderLeft: "2px solid var(--mantine-color-default-border)" }}
    >
      <Group gap="xs" wrap="wrap">
        <SegmentedControl
          size="xs"
          value={group.connector}
          onChange={(value) => mutate((t) => setConnector(t, group.id, value as FilterConnector))}
          data={[
            { label: t("AND"), value: "and" },
            { label: t("OR"), value: "or" },
          ]}
        />
        <Checkbox
          size="xs"
          label={t("NOT")}
          checked={group.negate}
          onChange={() => mutate((t) => toggleNegate(t, group.id))}
        />
        {!isRoot && (
          <Group gap={2}>
            <Button size="xs" variant="subtle" px={6} onClick={() => mutate((t) => moveNode(t, group.id, "up"))} aria-label={t("Move up")}>
              ↑
            </Button>
            <Button size="xs" variant="subtle" px={6} onClick={() => mutate((t) => moveNode(t, group.id, "down"))} aria-label={t("Move down")}>
              ↓
            </Button>
            <CloseButton size="sm" onClick={() => mutate((t) => removeNode(t, group.id))} aria-label={t("Remove group")} />
          </Group>
        )}
      </Group>

      <Stack gap={6} pl={12}>
        {group.children.length === 0 && (
          <Text size="xs" c="dimmed">{t("No conditions yet -- add one below.")}</Text>
        )}
        {group.children.map((child) => (
          <FilterTreeNodeView key={child.id} node={child} namespace={namespace} mutate={mutate} />
        ))}

        {addOpen ? (
          <PresetSearchList
            namespace={namespace}
            onPick={(preset) => {
              mutate((t) => addConditionRow(t, group.id, preset.id));
              setAddOpen(false);
            }}
            onCancel={() => setAddOpen(false)}
          />
        ) : (
          <Group gap="xs">
            <Button size="xs" variant="subtle" onClick={() => setAddOpen(true)}>{t("+ Add condition")}</Button>
            <Button size="xs" variant="subtle" onClick={() => mutate((t) => addGroup(t, group.id))}>{t("+ Add group")}</Button>
          </Group>
        )}
      </Stack>
    </Stack>
  );
}

/** A drag-handle glyph -- purely decorative for now (there's no actual
 * drag-and-drop yet, only the up/down move buttons), but marks each
 * condition row as a reorderable item at a glance and gives future
 * drag-and-drop an obvious place to attach to without moving anything
 * else in the row. Not a button: `aria-hidden` and no `onClick`, so it's
 * invisible to a screen reader/keyboard user, who already has the
 * up/down buttons for the same job. */
function Grabber() {
  return (
    <Text size="sm" c="dimmed" aria-hidden="true" style={{ cursor: "grab", userSelect: "none" }}>
      ⠿
    </Text>
  );
}

function RowView({
  row, namespace, mutate,
}: {
  row: FilterConditionRow;
  namespace: GqlFilterNamespace;
  mutate: Mutate;
}) {
  const preset = useMemo(
    () => gqlFilterPresets.find((p) => p.id === row.presetId && p.namespace === namespace),
    [row.presetId, namespace],
  );

  if (!preset) {
    // A stale id (catalog changed since this tree was built) -- surfaced
    // rather than silently dropped, but the only thing to do with it is
    // remove it.
    return (
      <Group gap="xs" wrap="nowrap">
        <Grabber />
        <Text size="sm" c="red">{t("Unknown filter")}: {row.presetId}</Text>
        <CloseButton size="sm" onClick={() => mutate((t) => removeNode(t, row.id))} aria-label={t("Remove")} />
      </Group>
    );
  }

  return (
    <Group gap="xs" wrap="nowrap" align="flex-start">
      {/* Grabber centered against the label's own Stack (not the whole
       * row, which also has the taller Checkbox/move/remove buttons) --
       * comparing it to its one immediate peer, rather than guessing a
       * pixel offset against font metrics, is what actually keeps it
       * lined up with the label text regardless of row height. */}
      <Group gap="xs" wrap="nowrap" align="center" style={{ flex: 1 }}>
        <Grabber />
        <Stack gap={4} style={{ flex: 1 }}>
          <Text size="sm">{t(preset.label)}</Text>
          {preset.params && preset.params.length > 0 && (
            <Group gap="xs">
              {preset.params.map((param) => (
                <NumberInput
                  key={param.name}
                  size="xs"
                  w={100}
                  placeholder={t(param.label)}
                  hideControls
                  value={row.values?.[param.name] ?? ""}
                  onChange={(v) =>
                    mutate((t) =>
                      updateRowValues(t, row.id, { ...row.values, [param.name]: v === "" ? "" : String(v) }),
                    )
                  }
                />
              ))}
            </Group>
          )}
        </Stack>
      </Group>
      <Checkbox
        size="xs"
        label={t("NOT")}
        checked={row.negate}
        onChange={() => mutate((t) => toggleNegate(t, row.id))}
      />
      <Group gap={2}>
        <Button size="xs" variant="subtle" px={6} onClick={() => mutate((t) => moveNode(t, row.id, "up"))} aria-label={t("Move up")}>
          ↑
        </Button>
        <Button size="xs" variant="subtle" px={6} onClick={() => mutate((t) => moveNode(t, row.id, "down"))} aria-label={t("Move down")}>
          ↓
        </Button>
        <CloseButton size="sm" onClick={() => mutate((t) => removeNode(t, row.id))} aria-label={t("Remove")} />
      </Group>
    </Group>
  );
}

/** The "+ Add condition" inline (never floating) search list -- a search
 * box plus this namespace's presets grouped by category, same grouping
 * `gqlFilterPresets.ts` defines. Clicking a supported preset calls
 * `onPick` once and the caller is responsible for closing this back up;
 * an unsupported preset (adopted/has-addresses today) is shown, disabled,
 * with its `notes` as a tooltip -- visible so it's discoverable, not
 * pickable. */
function PresetSearchList({
  namespace, onPick, onCancel,
}: {
  namespace: GqlFilterNamespace;
  onPick: (preset: GqlFilterPreset) => void;
  onCancel: () => void;
}) {
  const [search, setSearch] = useState("");
  const presets = useMemo(
    () => gqlFilterPresets.filter((p) => p.namespace === namespace),
    [namespace],
  );
  const bySearch = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return presets;
    return presets.filter((p) => p.label.toLowerCase().includes(q));
  }, [presets, search]);
  const noMatches = bySearch.length === 0;

  return (
    <Stack
      gap="xs"
      p="xs"
      style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: "var(--mantine-radius-sm)" }}
    >
      <Group gap="xs" wrap="nowrap">
        <TextInput
          size="xs"
          style={{ flex: 1 }}
          placeholder={t("Search filters…")}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          autoFocus
        />
        <CloseButton size="sm" onClick={onCancel} aria-label={t("Cancel")} />
      </Group>
      <ScrollArea.Autosize mah={220}>
        <Stack gap="sm">
          {CATEGORIES.map((category) => {
            const inCategory = bySearch.filter((p) => p.category === category);
            if (inCategory.length === 0) return null;
            return (
              <Stack key={category} gap={2}>
                <Text size="xs" fw={600} c="dimmed">{t(category)}</Text>
                {inCategory.map((preset) => <PresetOption key={preset.id} preset={preset} onPick={onPick} />)}
              </Stack>
            );
          })}
          {noMatches && <Text size="xs" c="dimmed">{t("No filters match your search.")}</Text>}
        </Stack>
      </ScrollArea.Autosize>
    </Stack>
  );
}

function PresetOption({ preset, onPick }: { preset: GqlFilterPreset; onPick: (preset: GqlFilterPreset) => void }) {
  const option = (
    <Button
      size="xs"
      variant="subtle"
      justify="flex-start"
      fullWidth
      disabled={!preset.supported}
      onClick={() => onPick(preset)}
    >
      {t(preset.label)}
    </Button>
  );
  if (preset.supported) return option;
  return (
    <Tooltip label={preset.notes ?? t("Not available yet")} multiline w={280} withArrow>
      <div>{option}</div>
    </Tooltip>
  );
}
