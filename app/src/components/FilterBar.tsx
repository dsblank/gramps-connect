import { useEffect, useRef, useState } from "react";
import { Stack, Group, TextInput, CloseButton, Text, Tooltip, Checkbox } from "@mantine/core";
import { useViewStore } from "../hooks/useViewStore";
import { getViewStore } from "../store/registry";
import { getSearchHelp } from "../store/searchHelp";
import { getSearchState, setSearchState } from "../store/searchState";
import { InfoButton } from "./InfoButton";
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
  // Whether `input` currently matches what's actually applied to the view --
  // drives the box's "unapplied" highlight, below. Set explicitly at each
  // point that changes either side of that comparison, rather than derived
  // by re-deriving whereExpr from input on every render: simpleSearch's
  // buildExpr is one-way (plain text -> a where_expr), so there's no
  // general way to tell whether the *current* input would still produce the
  // where_expr already applied.
  const [dirty, setDirtyState] = useState(() => getSearchState(view.key).dirty);

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
  function setDirty(value: boolean) {
    setDirtyState(value);
    setSearchState(view.key, { dirty: value });
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
  // Set (only when a real null-transition is about to happen -- see the
  // GOQL checkbox handler below) just before this component's own apply(null)
  // drops a now-stale *applied* filter as a side effect of some other
  // action, so the effect below doesn't mistake that for the external
  // clear it exists to detect and wipe the box the user didn't ask to
  // clear.
  const clearingAppliedFilterOnly = useRef(false);

  // Known gap: a browser's own autofill (or a password-manager extension)
  // can set the box's DOM value through a path that dispatches no event
  // onChange (or any other DOM listener) ever sees, so a selection made
  // that way doesn't mark the box dirty -- confirmed still broken after
  // trying both a raw input/change DOM listener and the usual
  // :-webkit-autofill/animationstart CSS trick, neither of which caught
  // it. Left as-is rather than continuing to guess at more workarounds
  // blind, with no browser available here to verify one actually works.
  function handleTextChange(value: string) {
    setInput(value);
    // An empty box matches "no filter" whenever that's already what's
    // applied -- otherwise it's still one Enter/clear-click away from
    // clearing the *applied* filter (same distinction CloseButton's own
    // click makes explicitly).
    setDirty(value !== "" || snapshot.whereExpr !== null);
  }

  useEffect(() => {
    if (skipNextWhereExprClear.current) {
      skipNextWhereExprClear.current = false;
      return;
    }
    if (snapshot.whereExpr !== null) return;
    if (clearingAppliedFilterOnly.current) {
      clearingAppliedFilterOnly.current = false;
      return;
    }
    setInput("");
    setDirty(false);
  }, [snapshot.whereExpr]);

  // Returns whether the apply actually went through, so callers can decide
  // whether `input` now matches what's applied (submit()) -- an error means
  // it doesn't, so the highlight should stay on.
  async function apply(whereExpr: string | null): Promise<boolean> {
    setError(null);
    setApplying(true);
    try {
      const store = getViewStore(view.key);
      // Going back to "no filter" keeps whatever's currently selected in
      // view rather than jumping to the new result set's default row --
      // see ViewStore.clearFilter's doc comment.
      if (whereExpr === null) {
        await store.clearFilter();
      } else {
        await store.runQuery(whereExpr, false);
      }
      return true;
    } catch (err: any) {
      setError(err.message ?? String(err));
      return false;
    } finally {
      setApplying(false);
    }
  }

  // Plain-text mode translates through simpleSearch.buildExpr (null for
  // too-short input clears the filter, same as an empty box); GOQL mode
  // sends the box's contents straight through as a where_expr.
  function submit() {
    const whereExpr = view.simpleSearch && !useGoql ? view.simpleSearch.buildExpr(input) : input.trim() || null;
    apply(whereExpr).then((ok) => {
      if (ok) setDirty(false);
    });
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
          // A very light blue background while `input` matches what's
          // actually applied -- plain (no background) whenever it's dirty,
          // e.g. typed-but-not-submitted, or an applied filter dropped out
          // from under the box by the useGoql toggle (see its handler
          // below). --mantine-color-blue-light is the same theme-aware
          // tint RefPickerField.tsx uses for its "new" badge, so this stays
          // subtle (and still legible) in dark mode too.
          styles={{ input: { backgroundColor: dirty ? undefined : "var(--mantine-color-blue-light)" } }}
          onChange={(e) => handleTextChange(e.currentTarget.value)}
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
                  setDirty(false);
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
                setError(null);
                // The typed text stays in the box across the toggle -- it's
                // just a starting point to edit/resubmit under the new
                // mode's syntax, not something the toggle should throw
                // away. But it always needs the "unapplied" highlight,
                // unconditionally: whatever was applied (if anything) was
                // built from the old mode's interpretation, which the new
                // mode isn't guaranteed to reproduce even for an empty box
                // (GOQL's own placeholder/wherePlaceholder differs from
                // simpleSearch's), so the toggle itself is always a step
                // back from "confirmed applied" until resubmitted.
                setDirty(true);
                // Only requery when a filter is actually active -- otherwise
                // this is a no-op apply(null) on every toggle, which still
                // round-trips the store and flashes the list.
                if (snapshot.whereExpr !== null) {
                  clearingAppliedFilterOnly.current = true;
                  apply(null);
                }
              }}
            />
          </Tooltip>
        )}
        {help && (
          <InfoButton label={`${t("How to search")} ${t(view.label)}`} onClick={() => setHelpOpen(true)} />
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
            setDirty(true);
            setHelpOpen(false);
          }}
        />
      )}
    </Stack>
  );
}
