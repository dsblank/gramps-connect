import { useEffect, useState } from "react";
import { Stack, Group, TextInput, Button, Text } from "@mantine/core";
import { useViewStore } from "../hooks/useViewStore";
import { getViewStore } from "../store/registry";
import type { ViewConfig } from "../store/views";

interface FilterBarProps {
  view: ViewConfig;
}

// Quick-filter buttons compose into the same where_expr box rather than
// bypassing it with a separate filter mechanism -- they just fill in (and
// immediately apply) an example exists(...)/count(...) expression. Both
// examples use the "events" relationship, which only Person has among
// this app's views so far.
const EVENT_EXAMPLES: { label: string; expr: string }[] = [
  { label: "has events", expr: "exists(events)" },
  { label: "3+ events", expr: "count(events) > 2" },
];

/** Rendered keyed by view.key from the parent so switching views remounts
 * it fresh (clears the input/error, matching the original spike's
 * selectView() resetting #where-expr/#filter-error). */
export function FilterBar({ view }: FilterBarProps) {
  const snapshot = useViewStore(view.key);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  // The store's filter can also be cleared from outside this component --
  // a person link in PersonDetail drops it before jumping to the target
  // (see ViewStore.navigateToHandle) -- so the input has to follow that,
  // not just its own Apply/Clear. Only tracks the "cleared" direction:
  // this component is still the sole source of truth for *applying* a new
  // expression, so a non-null whereExpr never overwrites the input the
  // user is mid-typing.
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

  return (
    <Stack gap={4} mb="sm">
      <Group gap="xs" wrap="nowrap">
        <Text size="sm" ff="monospace" c="dimmed">where_expr:</Text>
        <TextInput
          id="where-expr"
          size="sm"
          ff="monospace"
          style={{ flex: 1 }}
          value={input}
          placeholder={view.wherePlaceholder}
          onChange={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply(input.trim() || null);
          }}
        />
        <Button size="sm" loading={applying} onClick={() => apply(input.trim() || null)}>
          Apply
        </Button>
        <Button
          size="sm"
          variant="default"
          disabled={applying}
          onClick={() => {
            setInput("");
            apply(null);
          }}
        >
          Clear
        </Button>
      </Group>
      {view.key === "person" && (
        <Group gap={6}>
          <Text size="xs" c="dimmed">Examples:</Text>
          {EVENT_EXAMPLES.map(({ label, expr }) => (
            <Button
              key={expr}
              size="compact-xs"
              variant="light"
              onClick={() => {
                setInput(expr);
                apply(expr);
              }}
            >
              {label}
            </Button>
          ))}
        </Group>
      )}
      {error && <Text size="xs" c="red">{error}</Text>}
    </Stack>
  );
}
