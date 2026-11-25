// A list's Columns dialog, opened from the gear in ListHeader: reorder
// and hide its columns, and add columns of its own, each a GOQL expression
// (`birth.place.title`, `len(citations)`) with an optional title. A new
// column is shared with the whole tree (store/treeColumnMedia.ts) when the
// user can add to the tree, else kept in this browser; which columns show
// and their order are per browser (store/columnSettings.ts).
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon, Alert, Badge, Button, Checkbox, Combobox, Group, Menu, Modal, Stack, Text, TextInput, Tooltip,
} from "@mantine/core";
import { getToken, hasPermissions } from "../auth/auth";
import { testGoqlSelect } from "../store/api";
import {
  brokenMessage, builtinColumns, clearBroken, columnExpression, expressionDependencies, getColumnLayout,
  customSortKeys, getTreeColumns, layoutChangesCache, listCustomColumns, newCustomColumnId, setColumnLayout,
  setTreeColumns, structuredValueError, useColumnSettingsVersion,
  type ColumnLayout, type CustomColumn, type TreeColumn,
} from "../store/columnSettings";
import { refreshTreeColumns, saveTreeColumn, uploadTreeColumn } from "../store/treeColumnMedia";
import { goqlNamespaceForEndpoint } from "../store/goqlCompletion";
import { getViewStore } from "../store/registry";
import type { ViewConfig } from "../store/views";
import { t } from "../i18n/i18n";
import { SortableList } from "./SortableList";
import { GoqlCompletionDropdown, useGoqlCompletion, COMPLETION_Z_INDEX } from "./goqlCompletion/useGoqlCompletion";

interface Row {
  key: string;
  /** A built-in column's label; null for a custom column. */
  builtinLabel: string | null;
  /** A custom column shared with the tree (else only in this browser, or
   * new). */
  tree: boolean;
  expr: string;
  title: string;
  /** A custom column's second sort (CustomColumn.thenBy). */
  thenBy: string;
  visible: boolean;
  error: string | null;
  /** Why `thenBy` can't be used, from Save's check. */
  thenByError: string | null;
}

/** Built-in columns the dialog lists: those the table can show at all
 * (views.ts `hidden` ones are cached for other features, never shown). */
function shownBuiltins(view: ViewConfig) {
  return builtinColumns(view).filter((c) => !c.hidden);
}

function defaultRows(view: ViewConfig): Row[] {
  return shownBuiltins(view).map((c) => ({
    key: c.key, builtinLabel: c.label, tree: false, expr: columnExpression(c), title: "", thenBy: "", visible: true, error: null,
    thenByError: null,
  }));
}

function customRow(namespace: string, viewKey: string, c: CustomColumn, tree: boolean): Row {
  return {
    key: c.id, builtinLabel: null, tree, expr: c.expr, title: c.title ?? "", thenBy: c.thenBy ?? "", visible: true,
    error: structuredValueError(namespace, c.expr) ?? brokenMessage(viewKey, c.id) ?? null, thenByError: null,
  };
}

function rowColumn(r: Row): CustomColumn {
  return {
    id: r.key,
    expr: r.expr.trim(),
    ...(r.title.trim() ? { title: r.title.trim() } : {}),
    ...(r.thenBy.trim() ? { thenBy: r.thenBy.trim() } : {}),
  };
}

function sameDefinition(a: CustomColumn, b: CustomColumn): boolean {
  return a.expr.trim() === b.expr.trim() && (a.title ?? "").trim() === (b.title ?? "").trim() &&
    (a.thenBy ?? "").trim() === (b.thenBy ?? "").trim();
}

function rowsFromLayout(view: ViewConfig, layout: ColumnLayout): Row[] {
  const namespace = goqlNamespaceForEndpoint(view.endpoint) ?? "";
  const hidden = new Set(layout.hidden);
  const treeIds = new Set(getTreeColumns(view.key).map((c) => c.id));
  const rows: Row[] = [
    ...defaultRows(view),
    ...listCustomColumns(view.key, layout).map((c) => customRow(namespace, view.key, c, treeIds.has(c.id))),
  ].map((row) => ({ ...row, visible: !hidden.has(row.key) }));
  const position = new Map(layout.order.map((key, i) => [key, i]));
  return rows
    .map((row, i) => ({ row, rank: position.get(row.key) ?? layout.order.length + i }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ row }) => row);
}

function layoutFromRows(view: ViewConfig, rows: Row[]): ColumnLayout | null {
  const shared = rows.filter((r) => r.builtinLabel === null && r.tree).map((r) => r.key);
  const custom = rows.filter((r) => r.builtinLabel === null && !r.tree).map(rowColumn);
  const order = rows.map((r) => r.key);
  const hidden = rows.filter((r) => !r.visible).map((r) => r.key);
  const defaultOrder = shownBuiltins(view).map((c) => c.key);
  const isDefault =
    shared.length === 0 && custom.length === 0 && hidden.length === 0 && order.join("\n") === defaultOrder.join("\n");
  return isDefault ? null : { ...(shared.length > 0 ? { shared } : {}), custom, order, hidden };
}

/** Why the custom columns' names can't be used in filters (`Father`):
 * a backtick in a title or expression, or two columns with the same name
 * (title, else expression), counting built-in columns and the tree's
 * columns this list doesn't show. Null when fine. */
function namingProblem(view: ViewConfig, rows: Row[], treeColumns: TreeColumn[]): string | null {
  const custom = rows.filter((r) => r.builtinLabel === null && r.expr.trim() !== "");
  const ticked = custom.find((r) => r.title.includes("`") || r.expr.includes("`"));
  if (ticked) return t("A column's title and expression can't contain a backtick (`).");
  const taken = new Map<string, string>();
  for (const c of shownBuiltins(view)) {
    taken.set(c.label.toLowerCase(), c.key);
    taken.set(t(c.label).toLowerCase(), c.key);
  }
  for (const c of treeColumns) {
    if (!rows.some((r) => r.key === c.id)) taken.set((c.title?.trim() || c.expr).toLowerCase(), c.id);
  }
  for (const r of custom) {
    const name = (r.title.trim() || r.expr.trim()).toLowerCase();
    const other = taken.get(name);
    if (other !== undefined && other !== r.key) {
      return t("Two columns are called \"{name}\". Give one of them another title, so a filter can tell them apart.")
        .replace("{name}", r.title.trim() || r.expr.trim());
    }
    taken.set(name, r.key);
  }
  return null;
}

function rowsCustom(rows: Row[]): CustomColumn[] {
  return rows.filter((r) => r.builtinLabel === null).map(rowColumn);
}

export function ColumnSettingsDialog({ view, opened, onClose }: { view: ViewConfig; opened: boolean; onClose: () => void }) {
  return (
    <Modal opened={opened} onClose={onClose} title={`${t("Columns")}: ${t(view.label)}`} size="xl">
      {/* Remounted per opening, so it starts from what's saved. */}
      {opened && <ColumnSettingsBody view={view} onClose={onClose} />}
    </Modal>
  );
}

function ColumnSettingsBody({ view, onClose }: { view: ViewConfig; onClose: () => void }) {
  const saved = useMemo(() => getColumnLayout(view.key), [view.key]);
  const [rows, setRows] = useState<Row[]>(() => rowsFromLayout(view, saved));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const namespace = goqlNamespaceForEndpoint(view.endpoint) ?? "";
  // Adding to the tree is an upload plus a tag; changing one is a PUT.
  const canShare = hasPermissions("AddObject", "EditObject");

  // The tree's columns, fetched fresh for the Add menu.
  useColumnSettingsVersion();
  useEffect(() => {
    refreshTreeColumns().catch((err) => console.warn("[columns] refreshing tree columns failed", err));
  }, []);
  const treeColumns = getTreeColumns(view.key);
  const notShown = treeColumns.filter((c) => !rows.some((r) => r.key === c.id));

  const savedCustom = useMemo(() => listCustomColumns(view.key, saved), [view.key, saved]);
  const savedExprs = new Map(savedCustom.map((c) => [c.id, c.expr.trim()]));
  const savedThenBy = new Map(savedCustom.map((c) => [c.id, c.thenBy?.trim() ?? ""]));
  // Anything that changes what's fetched (not order/visibility/titles).
  const refetches = layoutChangesCache(view, savedCustom, rowsCustom(rows));
  // Columns kept in this browser that Save will share with the tree.
  const toShare = canShare ? rows.filter((r) => r.builtinLabel === null && !r.tree && r.expr.trim() !== "") : [];
  const sharesOld = toShare.some((r) => savedExprs.has(r.key));
  // Tree columns whose definition this Save changes for everyone.
  const editsTree = rows.some((r) => {
    if (!r.tree) return false;
    const before = treeColumns.find((c) => c.id === r.key);
    return before !== undefined && !sameDefinition(before, rowColumn(r));
  });

  function update(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setFormError(null);
  }

  function move(from: number, to: number) {
    setRows((prev) => {
      const next = [...prev];
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row);
      return next;
    });
  }

  function addColumn() {
    setRows((prev) => [
      ...prev,
      {
        key: newCustomColumnId(), builtinLabel: null, tree: false, expr: "", title: "", thenBy: "", visible: true, error: null,
        thenByError: null,
      },
    ]);
  }

  function addTreeColumn(column: TreeColumn) {
    setRows((prev) => [...prev, customRow(namespace, view.key, column, true)]);
  }

  /** Writes new and changed columns to the tree, one at a time; the rows
   * as they then stand (columns just shared marked so). A failed write
   * stops there: what was written stays, and the rest are left as they
   * were, so saving again doesn't add a column twice. */
  async function writeTreeColumns(checked: Row[]): Promise<{ rows: Row[]; error: string | null }> {
    if (!canShare) return { rows: checked, error: null };
    const columns = [...getTreeColumns()];
    const result: Row[] = [];
    let error: string | null = null;
    for (const r of checked) {
      if (r.builtinLabel !== null || error !== null) {
        result.push(r);
        continue;
      }
      const def = rowColumn(r);
      try {
        if (r.tree) {
          const index = columns.findIndex((c) => c.id === r.key);
          const before = columns[index];
          if (before?.handle && !sameDefinition(before, def)) {
            const next: TreeColumn = { ...def, view: view.key, handle: before.handle };
            await saveTreeColumn(before.handle, next);
            columns[index] = next;
          }
          result.push(r);
        } else {
          const next: TreeColumn = { ...def, view: view.key };
          next.handle = await uploadTreeColumn(next);
          columns.push(next);
          result.push({ ...r, tree: true });
        }
      } catch (err) {
        error = `${def.title || def.expr}: ${err instanceof Error ? err.message : String(err)}`;
        result.push(r);
      }
    }
    setTreeColumns(columns);
    return { rows: result, error };
  }

  async function save() {
    // Blank new rows are just dropped.
    const kept = rows.filter((r) => r.builtinLabel !== null || r.expr.trim() !== "");
    if (!kept.some((r) => r.visible)) {
      setFormError(t("At least one column has to stay visible."));
      return;
    }
    const naming = namingProblem(view, kept, treeColumns);
    if (naming) {
      setFormError(naming);
      return;
    }
    setSaving(true);
    try {
      // Only expressions that are new, edited, or failed before are checked.
      const token = await getToken();
      // A "then by" has to be one sortable value: not a record, a list or
      // a type. Checked against the server only when new or changed.
      const checkThenBy = async (thenBy: string, before: string, broken: boolean): Promise<string | null> => {
        if (!thenBy) return null;
        const structured = structuredValueError(namespace, thenBy);
        if (structured) return structured;
        if (customSortKeys(namespace, thenBy) === null) return t("Types such as an event's type can't be sorted.");
        if (thenBy === before && !broken) return null;
        return testGoqlSelect(view, token, thenBy);
      };
      const checked = await Promise.all(
        kept.map(async (r) => {
          if (r.builtinLabel !== null) return r;
          const expr = r.expr.trim();
          const broken = !!brokenMessage(view.key, r.key);
          const thenByError = await checkThenBy(r.thenBy.trim(), savedThenBy.get(r.key) ?? "", broken);
          const structured = structuredValueError(namespace, expr);
          if (structured) return { ...r, error: structured, thenByError };
          if (savedExprs.get(r.key) === expr && !broken) return { ...r, error: null, thenByError };
          return { ...r, error: await testGoqlSelect(view, token, expr), thenByError };
        }),
      );
      setRows(checked);
      if (checked.some((r) => r.error || r.thenByError)) return;
      const written = await writeTreeColumns(checked);
      clearBroken(view.key);
      setColumnLayout(view.key, layoutFromRows(view, written.rows));
      if (written.error) {
        // What was written is saved; the dialog stays open on the rest.
        setRows(written.rows);
        setFormError(`${t("Couldn't save a column to the tree")}: ${written.error}`);
        getViewStore(view.key).applyColumnChange().catch(() => {});
        return;
      }
      onClose();
      getViewStore(view.key).applyColumnChange().catch((err) => {
        console.error(`[${view.label}] applying column settings failed`, err);
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        {t("Drag to reorder, untick to hide. Add a column with a GOQL expression for a single value, such as birth.place.title or len(citations).")}{" "}
        {canShare
          ? t("New columns are shared with everyone on this tree. Which columns this list shows, and their order, are saved in this browser.")
          : t("Columns you add are kept in this browser. Which columns this list shows, and their order, are saved in this browser.")}
      </Text>
      <SortableList
        keys={rows.map((r) => r.key)}
        onMove={move}
        gap={6}
        renderItem={(index, grip) => {
          const row = rows[index];
          return (
            <Group gap="xs" wrap="nowrap" align="flex-start">
              {grip}
              <Tooltip label={row.visible ? t("Hide this column") : t("Show this column")} openDelay={400}>
                <Checkbox
                  mt={6}
                  checked={row.visible}
                  onChange={(e) => update(row.key, { visible: e.currentTarget.checked })}
                  aria-label={row.visible ? t("Hide this column") : t("Show this column")}
                />
              </Tooltip>
              {row.builtinLabel !== null ? (
                <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }} mt={4}>
                  <Text size="sm" style={{ flexShrink: 0 }}>{t(row.builtinLabel)}</Text>
                  <Text size="xs" c="dimmed" ff="monospace" truncate>{row.expr}</Text>
                </Group>
              ) : (
                <CustomColumnFields
                  row={row}
                  namespace={namespace}
                  readOnly={row.tree && !canShare}
                  localOnly={!row.tree && !canShare}
                  onChange={(patch) => update(row.key, patch)}
                  onRemove={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                />
              )}
            </Group>
          );
        }}
      />
      <Group justify="space-between">
        {notShown.length === 0 ? (
          <Button variant="light" size="xs" onClick={addColumn}>{t("Add column")}</Button>
        ) : (
          <Menu position="bottom-start" withinPortal>
            <Menu.Target>
              <Button variant="light" size="xs">{t("Add column")}</Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={addColumn}>{t("New column…")}</Menu.Item>
              <Menu.Divider />
              <Menu.Label>{t("This tree's columns")}</Menu.Label>
              {notShown.map((c) => (
                <Menu.Item key={c.id} onClick={() => addTreeColumn(c)}>
                  <Text size="sm">{c.title?.trim() || c.expr}</Text>
                  {c.title?.trim() && <Text size="xs" c="dimmed" ff="monospace">{c.expr}</Text>}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        )}
        <Button
          variant="subtle"
          color="gray"
          size="xs"
          onClick={() => {
            setRows(defaultRows(view));
            setFormError(null);
          }}
        >
          {t("Reset to defaults")}
        </Button>
      </Group>
      {sharesOld && (
        <Text size="xs" c="dimmed">
          {t("Columns made in this browser before columns were shared will be added to the tree, for everyone, when you save.")}
        </Text>
      )}
      {editsTree && (
        <Text size="xs" c="dimmed">
          {t("You changed a column that's shared with the tree: the change applies to everyone who shows it.")}
        </Text>
      )}
      {refetches && (
        <Text size="xs" c="dimmed">
          {t("Saving reloads this list from the server to fetch the changed columns; on a large tree that takes a while.")}
        </Text>
      )}
      {formError && <Alert color="red" variant="light">{formError}</Alert>}
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>{t("Cancel")}</Button>
        <Button onClick={save} loading={saving}>{t("Save")}</Button>
      </Group>
    </Stack>
  );
}

function CustomColumnFields({
  row,
  namespace,
  readOnly,
  localOnly,
  onChange,
  onRemove,
}: {
  row: Row;
  namespace: string;
  /** A tree column this user can't change: shown, not editable. */
  readOnly: boolean;
  /** Kept in this browser only (this user can't add to the tree). */
  localOnly: boolean;
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
}) {
  const exprRef = useRef<HTMLInputElement>(null);
  const completion = useGoqlCompletion({
    value: row.expr,
    setValue: (expr) => onChange({ expr, error: null }),
    fieldRef: exprRef,
    locate: (value) => ({ namespace, source: value, offset: 0 }),
  });
  // Gramps types are stored as numbers whose order isn't their names'.
  const canSort = row.expr.trim() === "" || customSortKeys(namespace, row.expr) !== null;
  const untracked = useMemo(
    () => row.expr.trim() !== "" && expressionDependencies(namespace, row.expr).untracked,
    [namespace, row.expr],
  );
  return (
    <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <Combobox store={completion.combobox} onOptionSubmit={completion.accept} position="bottom-start" width={320} withinPortal zIndex={COMPLETION_Z_INDEX}>
          <Combobox.Target withKeyboardNavigation={false}>
            <TextInput
              ref={exprRef}
              size="xs"
              ff="monospace"
              style={{ flex: 2, minWidth: 0 }}
              placeholder={`${t("GOQL expression, e.g. birth.place.title")} · ${t("<Tab> completes")}`}
              aria-label={t("GOQL expression")}
              spellCheck={false}
              value={row.expr}
              readOnly={readOnly}
              error={row.error ?? undefined}
              onChange={(e) => {
                const value = e.currentTarget.value;
                onChange({ expr: value, error: null });
                completion.handleChange(value, e.currentTarget.selectionStart ?? value.length);
              }}
              onKeyDown={(e) => {
                completion.handleKeyDown(e);
              }}
              onBlur={completion.close}
              data-mantine-stop-propagation
            />
          </Combobox.Target>
          <GoqlCompletionDropdown completions={completion.completions} />
        </Combobox>
        <TextInput
          size="xs"
          style={{ flex: 1, minWidth: 0 }}
          placeholder={row.expr.trim() || t("Title (optional)")}
          aria-label={t("Title (optional)")}
          readOnly={readOnly}
          value={row.title}
          onChange={(e) => onChange({ title: e.currentTarget.value })}
        />
        <ThenByField row={row} namespace={namespace} readOnly={readOnly} onChange={onChange} />
        {(() => {
          const label = row.tree ? t("Remove from this list (it stays in the tree)") : t("Remove this column");
          return (
            <Tooltip label={label} openDelay={400}>
              <ActionIcon variant="subtle" color="gray" mt={2} onClick={onRemove} aria-label={label}>
                ✕
              </ActionIcon>
            </Tooltip>
          );
        })()}
      </Group>
      {localOnly && (
        <Group gap={6}>
          <Badge size="xs" variant="light" color="gray">{t("Only in this browser")}</Badge>
        </Group>
      )}
      {!canSort && !row.error && (
        <Text size="xs" c="dimmed">
          {t("Types such as an event's type can't be sorted.")}
        </Text>
      )}
      {untracked && (
        <Text size="xs" c="dimmed">
          {t("Reads records this list can't watch (references from other records, or a link inside the condition). After those are edited, this column can stay out of date, even after reloading the page, until the list is next fetched from the server: when you search, sort or save columns, or when this record changes.")}
        </Text>
      )}
    </Stack>
  );
}

/** A custom column's "then by" box: the GOQL expression that orders rows
 * tied on the column when it's sorted, with Tab completion like the
 * expression box. */
function ThenByField({
  row,
  namespace,
  readOnly,
  onChange,
}: {
  row: Row;
  namespace: string;
  readOnly: boolean;
  onChange: (patch: Partial<Row>) => void;
}) {
  const fieldRef = useRef<HTMLInputElement>(null);
  const completion = useGoqlCompletion({
    value: row.thenBy,
    setValue: (thenBy) => onChange({ thenBy, thenByError: null }),
    fieldRef,
    locate: (value) => ({ namespace, source: value, offset: 0 }),
  });
  return (
    <Combobox store={completion.combobox} onOptionSubmit={completion.accept} position="bottom-start" width={320} withinPortal zIndex={COMPLETION_Z_INDEX}>
      <Combobox.Target withKeyboardNavigation={false}>
        <TextInput
          ref={fieldRef}
          size="xs"
          ff="monospace"
          style={{ flex: 1, minWidth: 0 }}
          placeholder={t("Then sort by (optional)")}
          aria-label={t("Then sort by")}
          title={t("Clicking this column's header sorts by the column, then by this GOQL expression: for example a birthplace column then birth.date, to list each place's people oldest first.")}
          spellCheck={false}
          value={row.thenBy}
          readOnly={readOnly}
          error={row.thenByError ?? undefined}
          onChange={(e) => {
            const value = e.currentTarget.value;
            onChange({ thenBy: value, thenByError: null });
            completion.handleChange(value, e.currentTarget.selectionStart ?? value.length);
          }}
          onKeyDown={(e) => {
            completion.handleKeyDown(e);
          }}
          onBlur={completion.close}
          data-mantine-stop-propagation
        />
      </Combobox.Target>
      <GoqlCompletionDropdown completions={completion.completions} />
    </Combobox>
  );
}
