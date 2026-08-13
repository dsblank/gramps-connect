import { useEffect, useState } from "react";
import { Stack, Group, TextInput, CloseButton, Text, ActionIcon, Tooltip } from "@mantine/core";
import { useViewStore } from "../hooks/useViewStore";
import { getViewStore } from "../store/registry";
import { getSearchHelp } from "../store/searchHelp";
import { SearchHelpDialog } from "./SearchHelpDialog";
import type { ViewConfig } from "../store/views";

interface FilterBarProps {
  view: ViewConfig;
}

/** Rendered keyed by view.key from the parent so switching views remounts
 * it fresh (clears the input/error, matching the original spike's
 * selectView() resetting #where-expr/#filter-error). */
export function FilterBar({ view }: FilterBarProps) {
  const snapshot = useViewStore(view.key);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Undefined for a view with no help written for it yet -- the button is
  // simply absent there, rather than opening an empty dialog.
  const help = getSearchHelp(view);

  // The store's filter can also be cleared from outside this component --
  // a person link in PersonDetail drops it before jumping to the target
  // (see ViewStore.navigateToHandle) -- so the input has to follow that,
  // not just its own Enter/clear-button. Only tracks the "cleared"
  // direction: this component is still the sole source of truth for
  // *applying* a new expression, so a non-null whereExpr never overwrites
  // the input the user is mid-typing.
  useEffect(() => {
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
        <Text size="sm" ff="monospace" c="dimmed">Search:</Text>
        <TextInput
          id="where-expr"
          size="sm"
          ff="monospace"
          style={{ flex: 1 }}
          value={input}
          placeholder={view.wherePlaceholder}
          disabled={applying}
          onChange={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply(input.trim() || null);
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
        {help && (
          <Tooltip label={`How to search ${view.label}`} withArrow>
            <ActionIcon
              variant="default"
              radius="xl"
              size="sm"
              aria-label={`How to search ${view.label}`}
              onClick={() => setHelpOpen(true)}
            >
              <Text component="span" size="xs" fw={700} ff="serif" fs="italic">i</Text>
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
