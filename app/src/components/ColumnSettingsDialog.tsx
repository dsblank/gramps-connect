// A list's Columns dialog, opened from the gear in ListHeader: reorder
// and hide its columns, and add columns of its own, each a GOQL expression
// (`birth.place.title`, `len(citations)`) with an optional title. Saved per
// browser and per tree (store/columnSettings.ts).
import { useMemo, useRef, useState } from "react";
import {
  ActionIcon, Alert, Button, Checkbox, Combobox, Group, Modal, Stack, Text, TextInput, Tooltip,
} from "@mantine/core";
import { getToken } from "../auth/auth";
import { testGoqlSelect } from "../store/api";
import {
  brokenMessage, builtinColumns, clearBroken, columnExpression, expressionDependencies, getColumnLayout,
  customSortKeys, layoutChangesCache, newCustomColumnId, setColumnLayout, structuredValueError,
  type ColumnLayout,
} from "../store/columnSettings";
import { goqlNamespaceForEndpoint } from "../store/goqlCompletion";
import { getViewStore } from "../store/registry";
import type { ViewConfig } from "../store/views";
import { t } from "../i18n/i18n";
import { SortableList } from "./SortableList";
import { GoqlCompletionDropdown, useGoqlCompletion } from "./goqlCompletion/useGoqlCompletion";

interface Row {
  key: string;
  /** A built-in column's label; null for a custom column. */
  builtinLabel: string | null;
  expr: string;
  title: string;
  /** A custom column's tiebreak (CustomColumn.thenBy). */
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
    key: c.key, builtinLabel: c.label, expr: columnExpression(c), title: "", thenBy: "", visible: true, error: null, thenByError: null,
  }));
}

function rowsFromLayout(view: ViewConfig, layout: ColumnLayout): Row[] {
  const namespace = goqlNamespaceForEndpoint(view.endpoint) ?? "";
  const hidden = new Set(layout.hidden);
  const rows: Row[] = [
    ...defaultRows(view),
    ...layout.custom.map((c) => ({
      key: c.id, builtinLabel: null, expr: c.expr, title: c.title ?? "", thenBy: c.thenBy ?? "", visible: true,
      error: structuredValueError(namespace, c.expr) ?? brokenMessage(view.key, c.id) ?? null, thenByError: null,
    })),
  ].map((row) => ({ ...row, visible: !hidden.has(row.key) }));
  const position = new Map(layout.order.map((key, i) => [key, i]));
  return rows
    .map((row, i) => ({ row, rank: position.get(row.key) ?? layout.order.length + i }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ row }) => row);
}

function layoutFromRows(view: ViewConfig, rows: Row[]): ColumnLayout | null {
  const custom = rows
    .filter((r) => r.builtinLabel === null)
    .map((r) => ({
      id: r.key,
      expr: r.expr.trim(),
      ...(r.title.trim() ? { title: r.title.trim() } : {}),
      ...(r.thenBy.trim() ? { thenBy: r.thenBy.trim() } : {}),
    }));
  const order = rows.map((r) => r.key);
  const hidden = rows.filter((r) => !r.visible).map((r) => r.key);
  const defaultOrder = shownBuiltins(view).map((c) => c.key);
  const isDefault = custom.length === 0 && hidden.length === 0 && order.join("\n") === defaultOrder.join("\n");
  return isDefault ? null : { custom, order, hidden };
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

  const savedExprs = new Map(saved.custom.map((c) => [c.id, c.expr.trim()]));
  const savedThenBy = new Map(saved.custom.map((c) => [c.id, c.thenBy?.trim() ?? ""]));
  // Anything that changes what's fetched (not order/visibility/titles).
  const refetches = layoutChangesCache(view, saved, layoutFromRows(view, rows));

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
      { key: newCustomColumnId(), builtinLabel: null, expr: "", title: "", thenBy: "", visible: true, error: null, thenByError: null },
    ]);
  }

  async function save() {
    // Blank new rows are just dropped.
    const kept = rows.filter((r) => r.builtinLabel !== null || r.expr.trim() !== "");
    if (!kept.some((r) => r.visible)) {
      setFormError(t("At least one column has to stay visible."));
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
      clearBroken(view.key);
      setColumnLayout(view.key, layoutFromRows(view, checked));
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
        {t("Drag to reorder, untick to hide. Add a column with a GOQL expression for a single value, such as birth.place.title or len(citations). Saved in this browser, for this tree.")}
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
                  onChange={(patch) => update(row.key, patch)}
                  onRemove={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                />
              )}
            </Group>
          );
        }}
      />
      <Group justify="space-between">
        <Button variant="light" size="xs" onClick={addColumn}>{t("Add column")}</Button>
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
  onChange,
  onRemove,
}: {
  row: Row;
  namespace: string;
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
        <Combobox store={completion.combobox} onOptionSubmit={completion.accept} position="bottom-start" width={320} withinPortal>
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
          value={row.title}
          onChange={(e) => onChange({ title: e.currentTarget.value })}
        />
        <ThenByField row={row} namespace={namespace} onChange={onChange} />
        <Tooltip label={t("Remove this column")} openDelay={400}>
          <ActionIcon variant="subtle" color="gray" mt={2} onClick={onRemove} aria-label={t("Remove this column")}>
            ✕
          </ActionIcon>
        </Tooltip>
      </Group>
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
  onChange,
}: {
  row: Row;
  namespace: string;
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
    <Combobox store={completion.combobox} onOptionSubmit={completion.accept} position="bottom-start" width={320} withinPortal>
      <Combobox.Target withKeyboardNavigation={false}>
        <TextInput
          ref={fieldRef}
          size="xs"
          ff="monospace"
          style={{ flex: 1, minWidth: 0 }}
          placeholder={t("Then sort by (optional)")}
          aria-label={t("Then sort by")}
          title={t("When rows tie on this column, order them by this GOQL expression, then by the list's usual order.")}
          spellCheck={false}
          value={row.thenBy}
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
