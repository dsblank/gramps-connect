import { useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedValue } from "@mantine/hooks";
import {
  Button, Checkbox, CloseButton, Divider, Group, Modal, NumberInput, ScrollArea, Select,
  SegmentedControl, Stack, Text, Textarea, TextInput, Tooltip,
} from "@mantine/core";
import {
  gqlFilterPresets, type GqlFilterCategory, type GqlFilterNamespace, type GqlFilterParam, type GqlFilterPreset,
} from "../data/gqlFilterPresets";
import { FilterCombineError } from "../store/goqlFilterCombiner";
import {
  addRuleGroup, addRuleRow, combineFilterTree, countRules, createEmptyTree,
  removeNode, setConnector, toggleNegate, updateRowValues,
  type FilterConnector, type FilterRuleGroup, type FilterRuleRow, type FilterTree, type FilterTreeNode,
} from "../store/goqlFilterTree";
import { formatWhereExpr } from "../store/formatWhereExpr";
import { setFilterPickerState } from "../store/filterPickerState";
import {
  customRuleAsPreset, refreshCustomRules, removeCustomRule, saveCustomRuleManifest,
  setCachedCustomRules, uploadCustomRule, validateWhereExpr, type CustomRule,
} from "../store/customRuleMedia";
import {
  fetchSavedFilters, removeSavedFilter, saveSavedFilterManifest, uploadSavedFilter, type SavedFilter,
} from "../store/savedFilterMedia";
import { confirmDialog } from "../store/confirmDialog";
import { getSearchHelp } from "../store/searchHelp";
import { viewForNamespace } from "../store/views";
import { useViewStore } from "../hooks/useViewStore";
import { getViewStore } from "../store/registry";
import { t } from "../i18n/i18n";
import { InfoButton } from "./InfoButton";
import { SearchHelpDialog } from "./SearchHelpDialog";

const CATEGORIES: GqlFilterCategory[] = ["Dates", "Properties", "Associations", "Tags", "Privacy", "Custom"];

/** "Load a saved filter…"'s own explicit "nothing loaded" entry -- lets
 * that choice be made right there, rather than only reachable via the
 * bottom "Clear" button. Not a real Media handle, so it can't collide
 * with one. */
const EMPTY_SAVED_FILTER_VALUE = "__empty__";

type Preview = { ok: true; whereExpr: string } | { ok: false; message: string } | null;

/** Applies one tree-mutation helper (goqlFilterTree.ts) and commits the
 * result -- every control in the tree editor below (a checkbox, a move/
 * remove button, a picked preset) goes through this same shape, never
 * touching `tree` directly. */
type Mutate = (fn: (tree: FilterTree) => FilterTree) => void;

interface FilterPickerDialogProps {
  opened: boolean;
  onClose: () => void;
  viewKey: string;
  /** For the title ("Filters — People") -- ViewConfig.label. */
  viewLabel: string;
  namespace: GqlFilterNamespace;
}

/** The "Filters" trigger's dialog: one continuous, always-editable
 * `FilterTree` editor (AND/OR rule groups, inline NOT on any rule or
 * rule group, nesting), plus loading/saving it as a named Saved Filter.
 *
 * This went through several rounds that split it into separate "modes"
 * (a quick single-rule picker kept apart from the tree editor, kept
 * apart from a Saved Filter loader) before settling back here, on
 * review: the split picker reimplemented a worse version of what
 * "+ Add rule" already did (it never rendered a parameterized preset's
 * value inputs, so a rule like "Birth year between" could be picked but
 * never made valid), and kept Saved-Filter editing from working without
 * a bolted-on bridge between panels. One editor, with Save/Load above
 * it, avoids both: there's only one place a rule is ever added, so
 * `RowView`'s param inputs are always reachable, and loading a filter
 * just means the editor now shows it -- editing it directly and clicking
 * "Update" needs no separate step. See project_saved_filters_persistence_plan.md.
 *
 * `savedFilterHandle`/`savedFilterName` track which Saved Filter (if
 * any) is currently loaded. Loading sets them; an ordinary tree edit
 * (`mutate`) deliberately leaves them alone, so editing a loaded filter
 * and clicking "Update" is direct, not a special mode. Only an explicit
 * action breaks the link: loading something else, picking "— Empty —",
 * "Clear", or deleting the loaded filter.
 *
 * Every rule a tree can reference is a *primitive* -- either a built-in
 * GqlFilterPreset (gqlFilterPresets.ts, constant across installs) or a
 * user-authored, persisted Custom Rule (customRuleMedia.ts). Both are
 * adapted into the same GqlFilterPreset shape (customRuleAsPreset()) and
 * merged into one `presets` array -- goqlFilterTree.ts/
 * goqlFilterCombiner.ts never need to know two sources exist. Custom
 * Rules are authored/edited/deleted from their own dedicated
 * `ManageCustomRulesDialog` (below, opened via "Custom rules…") -- the
 * one place raw GOQL entry is allowed at all in this feature, and the
 * *only* place a Custom Rule is created or changed; "+ Add rule" inside
 * the tree editor is a pure picker, nothing more.
 *
 * "+ Add rule" expands its search list inline (never a `Popover`) --
 * AttachControl.tsx's own doc comment covers why a scrollable list of
 * clickable rows misbehaves inside a Popover's outside-click handling,
 * and this is already a Modal, so a second floating layer nested inside
 * it would hit the same problem again. A freshly-empty rule group (the
 * root when the dialog opens with nothing built yet, or one just nested
 * via "+ Add rule group") starts with that list already expanded
 * (`RuleGroupView`'s own `addOpen` default) -- applying a single rule
 * needs no extra click to get there. "Save…"/"Copy…" and the Custom
 * Rules manager, by contrast, each open their own stacked `<Modal>`
 * (`SaveFilterDialog`/`ManageCustomRulesDialog` below).
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

  const [tree, setTreeState] = useState<FilterTree>(() => createEmptyTree(namespace));
  function setTree(next: FilterTree) {
    setTreeState(next);
  }
  const mutate: Mutate = (fn) => setTree(fn(tree));

  // Which (if any) Saved Filter `tree` is currently loaded from -- see
  // this component's own doc comment for why an ordinary edit leaves
  // this alone rather than clearing it.
  const [savedFilterHandle, setSavedFilterHandle] = useState<string | undefined>(undefined);
  const [savedFilterName, setSavedFilterName] = useState<string | undefined>(undefined);

  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [manageRulesOpen, setManageRulesOpen] = useState(false);
  // True while handleSelectSavedFilter's own confirmDialog() is pending
  // -- that confirm is a single, app-wide Modal (ConfirmDialogHost.tsx),
  // mounted entirely outside this component, so there's no other way for
  // this Modal to know one is open. Same reasoning as
  // saveDialogOpen/manageRulesOpen's own closeOnEscape guard below:
  // without it, Escape while the confirm is up would close both it and
  // this whole Filters dialog in the same keypress.
  const [confirmPending, setConfirmPending] = useState(false);

  const [customRules, setCustomRules] = useState<CustomRule[]>([]);
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);

  // Refetched every time the dialog opens (not just once on mount) -- a
  // Custom Rule or Saved Filter another tab/session created since this
  // one last opened it should show up without a full page reload.
  useEffect(() => {
    if (!opened) return;
    refreshCustomRules().then(setCustomRules).catch((err) => console.error("[filters] failed to load custom rules", err));
    fetchSavedFilters().then(setSavedFilters).catch((err) => console.error("[filters] failed to load saved filters", err));
  }, [opened]);

  // Built-in presets (constant) plus every Custom Rule, adapted into the
  // same shape -- see this component's own doc comment. Not namespace-
  // filtered here; RowView/PresetSearchList each already do their own
  // namespace filtering, and combineFilterTree only ever resolves the
  // ids a tree actually references.
  const presets = useMemo(
    () => [...gqlFilterPresets, ...customRules.map(customRuleAsPreset)],
    [customRules],
  );

  const savedFiltersForNamespace = useMemo(
    () => savedFilters.filter((f) => f.namespace === namespace),
    [savedFilters, namespace],
  );

  // Reported out for ListHeader.tsx's own badge/clear-button/summary --
  // see filterPickerState.ts's own doc comment for why this is the only
  // thing shared across components.
  useEffect(() => {
    setFilterPickerState(viewKey, tree);
  }, [viewKey, tree]);

  // Mirrors FilterBar.tsx's own external-clear effect: a person-link
  // navigation (ViewStore.navigateToHandle) or clearPickerFilter() called
  // from elsewhere (e.g. ListHeader.tsx's own "×") can drop pickerExpr out
  // from under this dialog while it's mounted but closed -- without this,
  // reopening it would still show the stale tree, and clicking Apply
  // unchanged would silently resurrect a filter that was just dropped.
  // Skips its very first run: mounting with a restored (possibly non-
  // empty) tree but a snapshot that legitimately starts at
  // pickerExpr === null is the ordinary case, not an external clear.
  const skipNextPickerExprClear = useRef(true);
  useEffect(() => {
    if (skipNextPickerExprClear.current) {
      skipNextPickerExprClear.current = false;
      return;
    }
    if (snapshot.pickerExpr !== null) return;
    setTree(createEmptyTree(namespace));
    setSavedFilterHandle(undefined);
    setSavedFilterName(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.pickerExpr]);

  // Whether `tree` has actually changed since it was loaded from
  // `savedFilterHandle` -- gates the "Save" button below (nothing to
  // save if it's unchanged). Plain JSON comparison: both sides are the
  // exact same JSON-shaped object this feature already round-trips
  // through Media file content, so this is exact, not approximate.
  const loadedFilterTree = savedFilterHandle
    ? savedFiltersForNamespace.find((f) => f.handle === savedFilterHandle)?.tree
    : undefined;
  const isDirty = loadedFilterTree ? JSON.stringify(tree) !== JSON.stringify(loadedFilterTree) : false;

  // Recomputed on every edit -- cheap (a handful of string-only presets) --
  // so the preview (and the Apply button's disabled state) reflect a bad/
  // missing param value immediately, not only once Apply is clicked.
  const preview: Preview = useMemo(() => {
    if (countRules(tree) === 0) return null;
    try {
      const combined = combineFilterTree(tree, presets);
      return { ok: true, whereExpr: combined.whereExpr };
    } catch (err) {
      return { ok: false, message: err instanceof FilterCombineError ? err.message : String(err) };
    }
  }, [tree, presets]);

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

  // Resets the tree to empty and drops the loaded-filter link -- used by
  // both the bottom "Clear" button and the Load dropdown's own
  // "— Empty —" entry.
  function handleClear() {
    setTree(createEmptyTree(namespace));
    setSavedFilterHandle(undefined);
    setSavedFilterName(undefined);
  }

  function handleLoadSavedFilter(filter: SavedFilter) {
    setTree(filter.tree);
    setSavedFilterHandle(filter.handle);
    setSavedFilterName(filter.name);
  }

  // The "Load a saved filter…" Select's own onChange -- confirms first
  // when the current tree is dirty, since switching (to a different
  // filter, or to "— Empty —") would otherwise discard those edits with
  // no warning at all, unlike the bottom "Clear" button (whose label
  // already says what it does). Cancelling leaves everything untouched;
  // the Select is a controlled component bound to `savedFilterHandle`,
  // so its displayed value snaps back to the still-current one on its
  // own -- nothing extra needed to "undo" the pick.
  async function handleSelectSavedFilter(value: string | null) {
    const found = value && value !== EMPTY_SAVED_FILTER_VALUE
      ? savedFiltersForNamespace.find((f) => f.handle === value)
      : undefined;
    if (isDirty) {
      setConfirmPending(true);
      const ok = await confirmDialog(
        `${t("Discard your unsaved changes to")} "${savedFilterName}"?`,
        t("Discard"),
      );
      setConfirmPending(false);
      if (!ok) return;
    }
    if (found) {
      handleLoadSavedFilter(found);
    } else {
      handleClear();
    }
  }

  // Saves the current tree as a new Saved Filter and loads it -- used
  // for both "Save…" (nothing loaded) and "Copy…" (something loaded;
  // keeps the original untouched under its own handle).
  async function handleSaveAsNew(name: string) {
    const filter: SavedFilter = { id: crypto.randomUUID(), name, namespace, tree };
    const handle = await uploadSavedFilter(filter);
    setSavedFilters((prev) => [...prev, { ...filter, handle }]);
    setSavedFilterHandle(handle);
    setSavedFilterName(name);
    setSaveDialogOpen(false);
  }

  // Overwrites the loaded Saved Filter in place with the tree's current
  // content, keeping its existing name (no rename via Update -- "Copy…"
  // under a different name covers that).
  async function handleUpdate() {
    if (!savedFilterHandle) return;
    setError(null);
    try {
      const existing = savedFiltersForNamespace.find((f) => f.handle === savedFilterHandle);
      const filter: SavedFilter = { id: existing?.id ?? crypto.randomUUID(), name: savedFilterName ?? "", namespace, tree };
      await saveSavedFilterManifest(savedFilterHandle, filter);
      setSavedFilters((prev) => prev.map((f) => (f.handle === savedFilterHandle ? { ...filter, handle: savedFilterHandle } : f)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeleteSavedFilter(handle: string) {
    setError(null);
    try {
      await removeSavedFilter(handle);
      setSavedFilters((prev) => prev.filter((f) => f.handle !== handle));
      if (savedFilterHandle === handle) {
        // The tree itself is left alone -- deleting the *saved* copy
        // doesn't discard what's currently in the editor, it just
        // severs the "Update" link (falls back to plain "Save…").
        setSavedFilterHandle(undefined);
        setSavedFilterName(undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCreateCustomRule(
    name: string, whereExpr: string, params: GqlFilterParam[] | undefined,
  ): Promise<void> {
    const rule: CustomRule = { id: crypto.randomUUID(), name, namespace, whereExpr, params };
    const handle = await uploadCustomRule(rule);
    setCustomRules((prev) => {
      const next = [...prev, { ...rule, handle }];
      setCachedCustomRules(next);
      return next;
    });
  }

  async function handleUpdateCustomRule(
    handle: string, name: string, whereExpr: string, params: GqlFilterParam[] | undefined,
  ): Promise<void> {
    const existing = customRules.find((c) => c.handle === handle);
    const rule: CustomRule = { id: existing?.id ?? crypto.randomUUID(), name, namespace, whereExpr, params };
    await saveCustomRuleManifest(handle, rule);
    setCustomRules((prev) => {
      const next = prev.map((c) => (c.handle === handle ? { ...rule, handle } : c));
      setCachedCustomRules(next);
      return next;
    });
  }

  async function handleDeleteCustomRule(handle: string) {
    setError(null);
    try {
      await removeCustomRule(handle);
      setCustomRules((prev) => {
        const next = prev.filter((c) => c.handle !== handle);
        setCachedCustomRules(next);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={`${t("Filters")} — ${t(viewLabel)}`}
      size="lg"
      scrollAreaComponent={ScrollArea.Autosize}
      // Suppressed while any nested dialog is open -- SaveFilterDialog/
      // ManageCustomRulesDialog (both live outside a real Modal.Stack,
      // manual zIndex nesting instead, see this component's own doc
      // comment) or the single app-wide confirmDialog() Modal
      // (ConfirmDialogHost.tsx, mounted in App.tsx, entirely outside
      // this component) -- each one's `<Modal>` binds its own
      // independent window-level Escape listener with no awareness of
      // the others. Without this, Escape while any of them is open
      // closes *both* it and this outer one in the same keypress
      // (confirmed by reading Mantine's own useModal source -- every
      // mounted+opened Modal checks the same event, and none of them
      // stop each other). Disabling this one for that keypress lets the
      // nested dialog's own (still-enabled) Escape handler close just
      // itself.
      closeOnEscape={!saveDialogOpen && !manageRulesOpen && !confirmPending}
    >
      <Stack gap="md">
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Group gap="xs">
            <Select
              size="xs"
              w={260}
              placeholder={t("Load a saved filter…")}
              data={[
                // A real, visible label -- an empty one (the earlier
                // approach, relying on `placeholder` showing through a
                // blank selected box) rendered as a blank, unclickable
                // row in the dropdown itself. This is purely this
                // Select's own display text for "nothing loaded"; its
                // `value` stays EMPTY_SAVED_FILTER_VALUE, a sentinel
                // that can't collide with a real Media handle, so
                // handleSelectSavedFilter() below still treats it as
                // "load nothing" -- it's never written anywhere as an
                // actual Saved Filter name (SaveFilterDialog's own
                // `initialName` is always "" for a fresh "Save…", not
                // derived from this label).
                { value: EMPTY_SAVED_FILTER_VALUE, label: t("New Filter") },
                ...savedFiltersForNamespace.map((f) => ({ value: f.handle!, label: f.name })),
              ]}
              value={savedFilterHandle ?? EMPTY_SAVED_FILTER_VALUE}
              onChange={handleSelectSavedFilter}
            />
            {savedFilterHandle && (
              <Button size="xs" variant="subtle" color="red" onClick={() => handleDeleteSavedFilter(savedFilterHandle)}>
                {t("Delete")}
              </Button>
            )}
            {/* Only signal this app-worthy while it's actually true:
             * discussed with the user rather than blocking/confirming
             * Apply on it (see project_saved_filters_persistence_plan.md
             * -- editing already survives an Apply-then-reopen within
             * the same page session, so this is a discoverability nudge,
             * not a warning about real data loss). */}
            {isDirty && <Text size="xs" c="dimmed">{t("Unsaved changes")}</Text>}
          </Group>
          <Button size="xs" variant="subtle" onClick={() => setManageRulesOpen(true)}>{t("Custom rules…")}</Button>
        </Group>

        <Divider />

        <FilterTreeNodeView node={tree.root} isRoot namespace={namespace} presets={presets} mutate={mutate} />

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
            disabled={countRules(tree) === 0}
            onClick={handleClear}
          >
            {t("Clear")}
          </Button>
          <Group gap="xs">
            {savedFilterHandle ? (
              <>
                {/* No "…" -- unlike "Save…"/"Copy…" below, this commits
                 * immediately (no naming dialog); disabled until the
                 * tree actually differs from what's loaded, since
                 * there's nothing to save otherwise. */}
                <Button size="xs" variant="default" disabled={!isDirty} onClick={handleUpdate}>
                  {t("Save")}
                </Button>
                <Button size="xs" variant="subtle" onClick={() => setSaveDialogOpen(true)}>{t("Copy…")}</Button>
              </>
            ) : (
              <Button
                size="xs"
                variant="default"
                disabled={countRules(tree) === 0}
                onClick={() => setSaveDialogOpen(true)}
              >
                {t("Save…")}
              </Button>
            )}
            {/* No "Cancel" -- this dialog writes nothing until Apply/
             * Save/Copy is explicitly clicked, so the Modal's own ×/
             * outside-click/Escape already do exactly what a Cancel
             * button would. */}
            <Button onClick={handleApply} loading={applying} disabled={preview?.ok === false}>
              {t("Apply")}{countRules(tree) > 0 ? ` (${countRules(tree)})` : ""}
            </Button>
          </Group>
        </Group>

        <SaveFilterDialog
          opened={saveDialogOpen}
          mode={savedFilterHandle ? "copy" : "save"}
          initialName={savedFilterHandle && savedFilterName ? `${savedFilterName} (copy)` : ""}
          onSave={handleSaveAsNew}
          onClose={() => setSaveDialogOpen(false)}
        />

        <ManageCustomRulesDialog
          opened={manageRulesOpen}
          namespace={namespace}
          customRules={customRules}
          onCreate={handleCreateCustomRule}
          onUpdate={handleUpdateCustomRule}
          onDelete={handleDeleteCustomRule}
          onClose={() => setManageRulesOpen(false)}
        />
      </Stack>
    </Modal>
  );
}

/** "Save…"/"Copy…"'s own dialog -- a stacked `<Modal>`. `FilterPickerDialog`
 * lives outside the app's real `Modal.Stack` (that's `EditDialogs.tsx`'s,
 * for the create/edit draft stack), so this follows
 * `MapItemEditorDialog.tsx`'s existing manual-`zIndex={1000}` nesting
 * convention instead of `stackId` (an ordinary nested Modal defaults to
 * the same base z-index as its parent and renders underneath it). Always
 * mounted with `opened` toggled, reset to blank on each open via the
 * effect below -- same convention `ManageCustomRulesDialog` uses. */
function SaveFilterDialog({
  opened, mode, initialName, onSave, onClose,
}: {
  opened: boolean;
  mode: "save" | "copy";
  /** Prefilled name on open -- `"{name} (copy)"` for "Copy…" (the
   * original filter's own name, with a suffix so a saved-as-new copy
   * doesn't default to blank next to the thing it was copied from), or
   * `""` for a first-time "Save…". */
  initialName: string;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!opened) return;
    setName(initialName);
    setSaving(false);
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      await onSave(name.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={mode === "copy" ? t("Copy filter") : t("Save filter")}
      size="sm"
      zIndex={1000}
    >
      <Stack gap="sm">
        <TextInput
          size="xs"
          label={t("Name")}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          autoFocus
        />
        {error && <Text size="xs" c="red">{error}</Text>}
        <Group gap="xs" justify="flex-end">
          <Button size="xs" variant="default" onClick={onClose}>{t("Cancel")}</Button>
          <Button size="xs" onClick={handleSave} loading={saving} disabled={!name.trim()}>
            {mode === "copy" ? t("Copy") : t("Save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** A parameter name must be a bare identifier -- it's spliced into
 * `whereExpr` as a literal `{name}` token (CustomRuleForm's own
 * PARAM_TYPE_OPTIONS/substituteParamsForValidation below, and
 * goqlFilterCombiner.ts's fillParams() once the rule is actually used),
 * so anything else could never be typed into the GOQL text as a matching
 * token anyway. */
const PARAM_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const PARAM_TYPES: GqlFilterParam["type"][] = ["string", "integer"];

/** Fills every `{param.name}` token in `expr` with a syntactically-inert
 * placeholder value of the right shape (an integer becomes `1`, a string
 * becomes `x`) so the *unparameterized* result can be checked for GOQL
 * syntax validity via the same real-query validateWhereExpr() a non-
 * parameterized Custom Rule already uses -- this can't validate that a
 * caller will supply sensible values, only that the expression's own
 * shape (parens, field names, operators) parses. Mirrors
 * goqlFilterCombiner.ts's fillParams() splice mechanics exactly (raw,
 * unquoted substitution -- any quoting a string param needs must already
 * be present in `expr` itself, same as a built-in preset's `expr`). */
function substituteParamsForValidation(expr: string, params: GqlFilterParam[]): string {
  let out = expr;
  for (const param of params) {
    if (!param.name) continue;
    out = out.split(`{${param.name}}`).join(param.type === "integer" ? "1" : "x");
  }
  return out;
}

/** Name + raw `where_expr` (+ optional named/typed parameters) form
 * shared by `ManageCustomRulesDialog`'s create ("+ New custom rule…") and
 * edit ("Edit" on an existing row) actions -- same fields either way,
 * just a different submit label/initial values/handler. This is the one
 * place a raw expression can be typed in this whole feature; see
 * `FilterPickerDialog`'s own top comment.
 *
 * A parameter (name/label/type) works exactly like a built-in preset's
 * own `GqlFilterParam` (gqlFilterPresets.ts) -- `whereExpr` references it
 * as `{name}`, and once saved it's filled in the same way (RowView's
 * inputs, goqlFilterCombiner.ts's fillParams()) whether the preset is
 * built-in or a Custom Rule; see customRuleMedia.ts's customRuleAsPreset().
 *
 * The submit button stays disabled until `whereExpr` (with every current
 * `{param.name}` token filled with a placeholder value via
 * substituteParamsForValidation()) has actually been checked against the
 * server (customRuleMedia.ts's validateWhereExpr(), a real `limit=1`
 * query against the namespace's own endpoint) and come back valid -- a
 * typo here would otherwise only surface much later, whenever this rule
 * is actually used inside a tree. Debounced (`useDebouncedValue`, 400ms)
 * so it doesn't fire on every keystroke; `checkedSubstituted` tracks
 * which exact substituted string was last confirmed valid, so typing
 * further (in either the expression or a param's name) after a
 * successful check correctly re-disables submit until the *new* text is
 * itself confirmed. Seeded from `initialWhereExpr`/`initialParams` (edit
 * mode's existing, presumably-already-valid expression) so opening
 * "Edit" on an unmodified rule doesn't force an unnecessary round trip
 * before Save re-enables. */
function CustomRuleForm({
  namespace, initialName, initialWhereExpr, initialParams, submitLabel, onSubmit, onCancel, onNestedDialogChange,
}: {
  namespace: GqlFilterNamespace;
  initialName: string;
  initialWhereExpr: string;
  initialParams: GqlFilterParam[];
  submitLabel: string;
  onSubmit: (name: string, whereExpr: string, params: GqlFilterParam[] | undefined) => Promise<void>;
  onCancel: () => void;
  /** Fired whenever this form's own GOQL-syntax help popup opens/closes
   * -- lets `ManageCustomRulesDialog`'s own `<Modal>` gate its
   * `closeOnEscape` on it, same reasoning as `FilterPickerDialog`'s own
   * `saveDialogOpen`/`manageRulesOpen` guard (see that component's doc
   * comment): without it, Escape while the help popup is open would
   * close *both* it and this Custom Rules manager in the same keypress. */
  onNestedDialogChange?: (open: boolean) => void;
}) {
  const [name, setName] = useState(initialName);
  const [whereExpr, setWhereExpr] = useState(initialWhereExpr);
  const [params, setParams] = useState<GqlFilterParam[]>(initialParams);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [helpOpen, setHelpOpenState] = useState(false);
  function setHelpOpen(open: boolean) {
    setHelpOpenState(open);
    onNestedDialogChange?.(open);
  }
  const help = getSearchHelp(viewForNamespace(namespace));

  // Trimmed, with a blank label falling back to the param's own name --
  // the shape actually persisted/submitted; `params` itself keeps
  // whatever's literally in each input so a trailing space mid-typing
  // isn't yanked out from under the user.
  const trimmedParams = params.map((p) => ({
    name: p.name.trim(),
    label: p.label.trim() || p.name.trim(),
    type: p.type,
  }));
  const paramNamesValid = trimmedParams.every((p) => PARAM_NAME_RE.test(p.name));
  const paramNamesUnique = new Set(trimmedParams.map((p) => p.name)).size === trimmedParams.length;
  const paramsValid = paramNamesValid && paramNamesUnique;

  const [checking, setChecking] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [checkedSubstituted, setCheckedSubstituted] = useState<string | null>(
    () => substituteParamsForValidation(initialWhereExpr, initialParams).trim() || null,
  );
  const substitutedExpr = paramsValid ? substituteParamsForValidation(whereExpr, trimmedParams) : "";
  const [debouncedSubstituted] = useDebouncedValue(substitutedExpr, 400);

  useEffect(() => {
    const expr = debouncedSubstituted.trim();
    if (!expr || expr === checkedSubstituted) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    setQueryError(null);
    validateWhereExpr(namespace, expr).then((result) => {
      if (cancelled) return;
      setChecking(false);
      if (result.ok) {
        setCheckedSubstituted(expr);
      } else {
        setQueryError(result.message);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSubstituted, namespace]);

  const whereExprValid =
    paramsValid && whereExpr.trim().length > 0 && substitutedExpr.trim() === checkedSubstituted;
  const canSubmit = !!name.trim() && whereExprValid;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    try {
      await onSubmit(name.trim(), whereExpr.trim(), trimmedParams.length ? trimmedParams : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  function updateParam(index: number, patch: Partial<GqlFilterParam>) {
    setParams((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  return (
    // onKeyDown here (not on each field individually) catches Escape
    // bubbling up from either one, so a single handler covers both; the
    // `data-mantine-stop-propagation` below is what actually keeps
    // Mantine's own Modal(s) from treating this same keypress as their
    // own "close" -- see FilterPickerDialog's own doc comment on why
    // that attribute (not stopPropagation()) is the only thing that
    // works against a Modal's window-level Escape listener.
    <Stack gap="xs" onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
      <TextInput
        size="xs"
        label={t("Name")}
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        autoFocus
        data-mantine-stop-propagation
      />
      <Stack gap={2}>
        <Group gap={6} wrap="nowrap">
          <Text size="xs" fw={500}>{t("Raw GOQL")}</Text>
          {help && (
            <InfoButton
              size="xs"
              label={`${t("GOQL syntax for")} ${t(namespace)}`}
              onClick={() => setHelpOpen(true)}
            />
          )}
        </Group>
        <Textarea
          size="xs"
          ff="monospace"
          autosize
          minRows={2}
          maxRows={6}
          placeholder={t('e.g. like(primary_name.surname, "Smith%")')}
          value={whereExpr}
          onChange={(e) => {
            setWhereExpr(e.currentTarget.value);
            setQueryError(null);
          }}
          data-mantine-stop-propagation
        />
      </Stack>

      <Stack gap={4}>
        <Text size="xs" fw={500}>{t("Parameters")}</Text>
        {params.map((param, i) => (
          <Group key={i} gap={4} wrap="nowrap">
            <TextInput
              size="xs"
              w={110}
              placeholder={t("Name (e.g. minAge)")}
              value={param.name}
              onChange={(e) => updateParam(i, { name: e.currentTarget.value })}
              data-mantine-stop-propagation
            />
            <TextInput
              size="xs"
              w={120}
              placeholder={t("Label (optional)")}
              value={param.label}
              onChange={(e) => updateParam(i, { label: e.currentTarget.value })}
              data-mantine-stop-propagation
            />
            <Select
              size="xs"
              w={90}
              data={PARAM_TYPES.map((type) => ({ value: type, label: type === "string" ? t("String") : t("Integer") }))}
              value={param.type}
              onChange={(v) => updateParam(i, { type: (v as GqlFilterParam["type"]) ?? "string" })}
              allowDeselect={false}
              comboboxProps={{ zIndex: 1001 }}
              data-mantine-stop-propagation
            />
            <CloseButton
              size="sm"
              onClick={() => setParams((prev) => prev.filter((_, j) => j !== i))}
              aria-label={t("Remove parameter")}
            />
          </Group>
        ))}
        <Group gap="xs">
          <Button
            size="xs"
            variant="subtle"
            onClick={() => setParams((prev) => [...prev, { name: "", label: "", type: "string" }])}
          >
            {t("+ Add parameter")}
          </Button>
          {params.length > 0 && (
            <Text size="xs" c="dimmed">{t("Reference a parameter in your GOQL as {name}.")}</Text>
          )}
        </Group>
        {!paramNamesValid && (
          <Text size="xs" c="red">
            {t("Parameter names must start with a letter/underscore and contain only letters, digits, underscores.")}
          </Text>
        )}
        {paramNamesValid && !paramNamesUnique && (
          <Text size="xs" c="red">{t("Parameter names must be unique.")}</Text>
        )}
      </Stack>

      {checking && <Text size="xs" c="dimmed">{t("Checking…")}</Text>}
      {queryError && <Text size="xs" c="red">{queryError}</Text>}
      {error && <Text size="xs" c="red">{error}</Text>}
      <Group gap="xs" justify="flex-end">
        <Button size="xs" variant="default" onClick={onCancel}>{t("Cancel")}</Button>
        <Button size="xs" onClick={handleSubmit} loading={saving} disabled={!canSubmit}>
          {submitLabel}
        </Button>
      </Group>

      {help && (
        <SearchHelpDialog
          opened={helpOpen}
          onClose={() => setHelpOpen(false)}
          viewLabel={viewForNamespace(namespace).label}
          help={help}
          zIndex={1001}
          onUseExample={(expr) => {
            setWhereExpr(expr);
            setQueryError(null);
            setHelpOpen(false);
          }}
        />
      )}
    </Stack>
  );
}

/** "Custom rules…"'s own dialog -- the one place Custom Rules are
 * created, edited, or deleted (never from inside the tree editor's own
 * "+ Add rule", which is a pure picker). Same manual-`zIndex={1000}`
 * nesting convention as `SaveFilterDialog`. Always mounted with `opened`
 * toggled; resets any in-progress create/edit form back to the list view
 * on close via the effect below, so reopening never shows a stale
 * half-filled form. */
function ManageCustomRulesDialog({
  opened, namespace, customRules, onCreate, onUpdate, onDelete, onClose,
}: {
  opened: boolean;
  namespace: GqlFilterNamespace;
  customRules: CustomRule[];
  onCreate: (name: string, whereExpr: string, params: GqlFilterParam[] | undefined) => Promise<void>;
  onUpdate: (handle: string, name: string, whereExpr: string, params: GqlFilterParam[] | undefined) => Promise<void>;
  onDelete: (handle: string) => Promise<void>;
  onClose: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [editingHandle, setEditingHandle] = useState<string | null>(null);
  const [deletingHandle, setDeletingHandle] = useState<string | null>(null);
  // Whichever CustomRuleForm is currently mounted (create xor edit-of-
  // one-row, never both) reports its own GOQL-help popup's open state
  // here -- see CustomRuleForm's own onNestedDialogChange doc comment.
  const [nestedDialogOpen, setNestedDialogOpen] = useState(false);

  useEffect(() => {
    if (opened) return;
    setCreating(false);
    setEditingHandle(null);
  }, [opened]);

  const rulesForNamespace = useMemo(
    () => customRules.filter((c) => c.namespace === namespace),
    [customRules, namespace],
  );

  async function handleDelete(handle: string) {
    setDeletingHandle(handle);
    try {
      await onDelete(handle);
    } finally {
      setDeletingHandle(null);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("Custom rules")}
      size="md"
      zIndex={1000}
      // Suppressed while the GOQL-help popup (opened from whichever
      // CustomRuleForm is mounted) is open -- same reasoning as
      // FilterPickerDialog's own outer-Modal guard, one level deeper:
      // without this, Escape would close both it and this dialog at once.
      closeOnEscape={!nestedDialogOpen}
    >
      <Stack gap="sm">
        {rulesForNamespace.length === 0 && !creating && (
          <Text size="xs" c="dimmed">{t("No custom rules yet.")}</Text>
        )}
        {rulesForNamespace.map((rule) =>
          editingHandle === rule.handle ? (
            <CustomRuleForm
              key={rule.id}
              namespace={namespace}
              initialName={rule.name}
              initialWhereExpr={rule.whereExpr}
              initialParams={rule.params ?? []}
              submitLabel={t("Save")}
              onSubmit={async (name, whereExpr, params) => {
                await onUpdate(rule.handle!, name, whereExpr, params);
                setEditingHandle(null);
              }}
              onCancel={() => setEditingHandle(null)}
              onNestedDialogChange={setNestedDialogOpen}
            />
          ) : (
            <Group key={rule.id} gap="xs" wrap="nowrap" align="flex-start">
              <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm">{rule.name}</Text>
                <Text size="xs" c="dimmed" ff="monospace" truncate>{rule.whereExpr}</Text>
                {rule.params && rule.params.length > 0 && (
                  <Text size="xs" c="dimmed">
                    {t("Parameters")}: {rule.params.map((p) => p.label).join(", ")}
                  </Text>
                )}
              </Stack>
              <Button size="xs" variant="subtle" onClick={() => setEditingHandle(rule.handle ?? null)}>{t("Edit")}</Button>
              <Button
                size="xs"
                variant="subtle"
                color="red"
                disabled={deletingHandle === rule.handle}
                onClick={() => rule.handle && handleDelete(rule.handle)}
              >
                {t("Delete")}
              </Button>
            </Group>
          ),
        )}

        <Divider />

        {creating ? (
          <CustomRuleForm
            namespace={namespace}
            initialName=""
            initialWhereExpr=""
            initialParams={[]}
            submitLabel={t("Create")}
            onSubmit={async (name, whereExpr, params) => {
              await onCreate(name, whereExpr, params);
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
            onNestedDialogChange={setNestedDialogOpen}
          />
        ) : (
          <Button size="xs" variant="subtle" onClick={() => setCreating(true)}>{t("+ New custom rule…")}</Button>
        )}
      </Stack>
    </Modal>
  );
}

interface TreeViewProps {
  namespace: GqlFilterNamespace;
  presets: GqlFilterPreset[];
  mutate: Mutate;
}

function FilterTreeNodeView({
  node, isRoot = false, ...rest
}: TreeViewProps & { node: FilterTreeNode; isRoot?: boolean }) {
  if (node.kind === "rule-group") {
    return <RuleGroupView group={node} isRoot={isRoot} {...rest} />;
  }
  return <RowView row={node} presets={rest.presets} mutate={rest.mutate} />;
}

function RuleGroupView({
  group, isRoot, ...rest
}: TreeViewProps & { group: FilterRuleGroup; isRoot: boolean }) {
  // Starts expanded when this group is freshly empty -- the root on the
  // dialog's first open with nothing built yet, or one just nested via
  // "+ Add rule group" (a new group is a new React element, so this
  // initializer runs again for it) -- so applying a single rule needs no
  // extra click to get to the picker. Only the *initial* value; toggled
  // normally by the buttons below from then on.
  const [addOpen, setAddOpen] = useState(() => group.children.length === 0);
  const { namespace, presets, mutate } = rest;

  return (
    <Stack
      gap={6}
      pl={isRoot ? 0 : 12}
      style={isRoot ? undefined : { borderLeft: "2px solid var(--mantine-color-default-border)" }}
    >
      <Group gap="xs" wrap="wrap" align="center">
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
          <CloseButton size="sm" onClick={() => mutate((t) => removeNode(t, group.id))} aria-label={t("Remove rule group")} />
        )}
      </Group>

      <Stack gap={6} pl={12}>
        {group.children.length === 0 && !addOpen && (
          <Text size="xs" c="dimmed">{t("No rules yet -- add one below.")}</Text>
        )}
        {group.children.map((child) => (
          <FilterTreeNodeView key={child.id} node={child} {...rest} />
        ))}

        {addOpen ? (
          <PresetSearchList
            namespace={namespace}
            presets={presets}
            onPick={(preset) => {
              mutate((t) => addRuleRow(t, group.id, preset.id));
              setAddOpen(false);
            }}
            onCancel={() => setAddOpen(false)}
          />
        ) : (
          <Group gap="xs">
            <Button size="xs" variant="subtle" onClick={() => setAddOpen(true)}>{t("+ Add rule")}</Button>
            <Button size="xs" variant="subtle" onClick={() => mutate((t) => addRuleGroup(t, group.id))}>{t("+ Add rule group")}</Button>
          </Group>
        )}
      </Stack>
    </Stack>
  );
}

/** A small marker at the start of every rule row -- purely decorative
 * (unlike the old `Grabber` glyph it replaces, this one doesn't imply any
 * affordance -- no drag, no reordering, nothing to click) -- just enough
 * visual weight that a rule line reads as "a rule" at a glance, so a
 * rule group with several rows (each already differing in label/params/
 * NOT) doesn't blend into one wall of text. */
function RuleIcon() {
  return (
    <Text size="sm" c="dimmed" aria-hidden="true" style={{ userSelect: "none" }}>
      ✓
    </Text>
  );
}

function RowView({
  row, presets, mutate,
}: {
  row: FilterRuleRow;
  presets: GqlFilterPreset[];
  mutate: Mutate;
}) {
  const preset = useMemo(
    () => presets.find((p) => p.id === row.presetId),
    [presets, row.presetId],
  );

  if (!preset) {
    // A stale id (catalog changed, or the referenced Custom Rule was
    // deleted, since this tree was built) -- surfaced rather than
    // silently dropped, but the only thing to do with it is remove it.
    return (
      <Group gap="xs" wrap="nowrap">
        <RuleIcon />
        <Text size="sm" c="red">{t("Unknown rule")}: {row.presetId}</Text>
        <CloseButton size="sm" onClick={() => mutate((t) => removeNode(t, row.id))} aria-label={t("Remove")} />
      </Group>
    );
  }

  return (
    // `align="center"` on the outer Group, not "flex-start" -- the
    // Checkbox/remove controls are different Mantine components at
    // different sizes, each with its own intrinsic height; top-aligning
    // them left each one's own visual center at a different height (the
    // bug the "embarrassingly ugly" screenshot showed). Centering the
    // row is what actually lines up controls of differing heights
    // against each other.
    <Group gap="xs" wrap="nowrap" align="center">
      <Group gap="xs" wrap="nowrap" align="center" style={{ flex: 1 }}>
        <RuleIcon />
        <Stack gap={4} style={{ flex: 1 }}>
          <Group gap={4}>
            <Text size="sm">{t(preset.label)}</Text>
            {preset.category === "Custom" && <Text size="xs" c="dimmed">({t("Custom")})</Text>}
          </Group>
          {preset.params && preset.params.length > 0 && (
            <Group gap="xs">
              {preset.params.map((param) =>
                param.type === "string" ? (
                  <TextInput
                    key={param.name}
                    size="xs"
                    w={140}
                    placeholder={t(param.label)}
                    value={row.values?.[param.name] ?? ""}
                    onChange={(e) =>
                      mutate((t) =>
                        updateRowValues(t, row.id, { ...row.values, [param.name]: e.currentTarget.value }),
                      )
                    }
                  />
                ) : (
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
                ),
              )}
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
      <CloseButton size="sm" onClick={() => mutate((t) => removeNode(t, row.id))} aria-label={t("Remove")} />
    </Group>
  );
}

/** The "+ Add rule" inline (never floating) search list -- a search box
 * plus this namespace's presets grouped by category, same grouping
 * `gqlFilterPresets.ts` defines, plus a "Custom" group of this
 * namespace's user-authored Custom Rules (customRuleMedia.ts). Clicking a
 * supported preset calls `onPick` once and the caller is responsible for
 * closing this back up; an unsupported built-in preset (adopted/has-
 * addresses today) is shown, disabled, with its `notes` as a tooltip --
 * visible so it's discoverable, not pickable.
 *
 * Purely a picker -- authoring/editing/deleting a Custom Rule all live in
 * `ManageCustomRulesDialog` instead (`FilterPickerDialog`'s own doc
 * comment), not duplicated here. */
function PresetSearchList({
  namespace, presets, onPick, onCancel,
}: {
  namespace: GqlFilterNamespace;
  presets: GqlFilterPreset[];
  onPick: (preset: GqlFilterPreset) => void;
  onCancel: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(
    () => presets.filter((p) => p.namespace === namespace),
    [presets, namespace],
  );
  const bySearch = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter((p) => p.label.toLowerCase().includes(q));
  }, [filtered, search]);
  const noMatches = bySearch.length === 0;

  return (
    // onKeyDown + data-mantine-stop-propagation on the search field --
    // same pairing and reasoning as CustomRuleForm's own fields (see
    // FilterPickerDialog's doc comment): without it, Escape while
    // typing a search term bubbles straight into this Modal's own
    // Escape handler and closes the *entire* Filters dialog, not just
    // this inline "+ Add rule" panel.
    <Stack
      gap="xs"
      p="xs"
      style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: "var(--mantine-radius-sm)" }}
      onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
    >
      <Group gap="xs" wrap="nowrap">
        <TextInput
          size="xs"
          style={{ flex: 1 }}
          placeholder={t("Search rules…")}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          autoFocus
          data-mantine-stop-propagation
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
          {noMatches && <Text size="xs" c="dimmed">{t("No rules match your search.")}</Text>}
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
