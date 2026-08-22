import { useEffect, useRef, useState } from "react";
import { Stack, Group, TextInput, CloseButton, Text, ActionIcon, Tooltip, Checkbox } from "@mantine/core";
import { useViewStore } from "../hooks/useViewStore";
import { getViewStore } from "../store/registry";
import { getSearchHelp } from "../store/searchHelp";
import { getSearchState, setSearchState } from "../store/searchState";
import { SearchHelpDialog } from "./SearchHelpDialog";
import type { ViewConfig } from "../store/views";
import { t } from "../i18n/i18n";

interface FilterBarProps {
  view: ViewConfig;
}

/** Rendered keyed by view.key from the parent so switching views remounts
 * it fresh (clears transient `error`/`applying`, matching the original
 * spike's selectView() resetting #filter-error) -- but `input`/`useGoql`
 * seed from searchState.ts's per-view store instead of a fixed default, so
 * switching back to a view the user had a search typed into (GOQL or not)
 * shows it again rather than a blank box. */
export function FilterBar({ view }: FilterBarProps) {
  const snapshot = useViewStore(view.key);
  const [input, setInputState] = useState(() => getSearchState(view.key).input);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Defaults to the plain-text mode -- every view's everyday search is
  // simpler than the query language, which stays an opt-in escape hatch
  // (see ViewConfig.simpleSearch).
  const [useGoql, setUseGoqlState] = useState(() => getSearchState(view.key).useGoql);

  // Both setters also write through to searchState.ts, so the *next*
  // FilterBar mounted for this view.key (after a switch away and back)
  // picks up where this one left off -- see this component's own doc
  // comment above.
  function setInput(value: string) {
    setInputState(value);
    setSearchState(view.key, { input: value });
  }
  function setUseGoql(value: boolean) {
    setUseGoqlState(value);
    setSearchState(view.key, { useGoql: value });
  }
  // Undefined for a view with no help written for it yet -- the button is
  // simply absent there, rather than opening an empty dialog. Shown in both
  // simpleSearch modes -- Person's help text still needs editing to cover
  // plain-text mode too (see getSearchHelp's PERSON_HELP).
  const help = getSearchHelp(view);

  // The store's filter can also be cleared from outside this component --
  // a person link in PersonDetail drops it before jumping to the target
  // (see ViewStore.navigateToHandle) -- so the input has to follow that,
  // not just its own Enter/clear-button. Only tracks the "cleared"
  // direction: this component is still the sole source of truth for
  // *applying* a new expression, so a non-null whereExpr never overwrites
  // the input the user is mid-typing.
  //
  // Skipped on this instance's very first run: mounting with a restored
  // `input` (searchState.ts, above) but a null snapshot.whereExpr is the
  // ordinary case for a submitted-but-too-short query (buildExpr's null
  // return, same "clears the filter" case this effect itself handles) or
  // simply a search the user typed but never submitted -- neither is an
  // *external* clear, so treating mount itself as one would wipe the very
  // input this component just restored.
  const skipNextWhereExprClear = useRef(true);
  useEffect(() => {
    if (skipNextWhereExprClear.current) {
      skipNextWhereExprClear.current = false;
      return;
    }
    if (snapshot.whereExpr === null) setInput("");
  }, [snapshot.whereExpr]);

  async function apply(whereExpr: string | null) {
    setError(null);
    setApplying(true);
    try {
      await getViewStore(view.key).runQuery(whereExpr, false);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setApplying(false);
    }
  }

  // Plain-text mode translates through simpleSearch.buildExpr (null for
  // too-short input clears the filter, same as an empty box); GOQL mode
  // sends the box's contents straight through as a where_expr.
  function submit() {
    if (view.simpleSearch && !useGoql) {
      apply(view.simpleSearch.buildExpr(input));
    } else {
      apply(input.trim() || null);
    }
  }

  // Set on a view whose dataset is meant to stay fully fixed, with no
  // further user-editable expression -- see ViewConfig.searchable's doc
  // comment. Not automatic just from having a baseFilter: Output and
  // Messages both have one but stay searchable, since the fixed filter and
  // the user's search combine (ViewStore.combinedFilter) rather than
  // compete.
  if (view.searchable === false) return null;

  return (
    <Stack gap={4} mb="sm">
      <Group gap="xs" wrap="nowrap">
        <Text size="sm" ff="monospace" c="dimmed">{t("Search:")}</Text>
        <TextInput
          id="where-expr"
          size="sm"
          ff="monospace"
          style={{ flex: 1 }}
          value={input}
          placeholder={view.simpleSearch && !useGoql ? view.simpleSearch.placeholder : view.wherePlaceholder}
          disabled={applying}
          onChange={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          rightSection={
            input && (
              <CloseButton
                size="sm"
                disabled={applying}
                onClick={() => {
                  setInput("");
                  apply(null);
                }}
              />
            )
          }
        />
        {view.simpleSearch && (
          <Tooltip label={t("Use Gramps Object Query Language")} withArrow>
            <Checkbox
              size="sm"
              aria-label="Use Gramps Object Query Language"
              checked={useGoql}
              disabled={applying}
              onChange={(e) => {
                const checked = e.currentTarget.checked;
                setUseGoql(checked);
                setInput("");
                setError(null);
                // Only requery if a filter is actually active -- otherwise
                // this is a no-op apply(null) on every toggle, which still
                // round-trips the store and flashes the list.
                if (snapshot.whereExpr !== null) apply(null);
              }}
            />
          </Tooltip>
        )}
        {help && (
          <Tooltip label={`${t("How to search")} ${t(view.label)}`} withArrow>
            <ActionIcon
              variant="default"
              radius="xl"
              size="sm"
              aria-label={`${t("How to search")} ${t(view.label)}`}
              onClick={() => setHelpOpen(true)}
            >
              <Text component="span" size="xs" fw={700} ff="serif" fs="italic">{t("i")}</Text>
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
      {error && <Text size="xs" c="red">{error}</Text>}
      {help && (
        <SearchHelpDialog
          opened={helpOpen}
          onClose={() => setHelpOpen(false)}
          viewLabel={view.label}
          help={help}
          // Left unapplied in the box, so it's a starting point to edit
          // rather than a search of someone else's tree that returns
          // nothing here. Closing the dialog puts it in view.
          onUseExample={(expr) => {
            setInput(expr);
            setHelpOpen(false);
          }}
        />
      )}
    </Stack>
  );
}
