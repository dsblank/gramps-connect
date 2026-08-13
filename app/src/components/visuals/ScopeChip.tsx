import { Badge, Group, Loader, SegmentedControl, Text, Tooltip } from "@mantine/core";
import { formatHash, type VisualKey } from "../../hash";
import type { ResolvedScope } from "../../store/visualScope";

/** Filter down to the subject's own records, or draw the whole tree with
 * them picked out. Which one a visual opens in depends on the subject type
 * -- see each view's DEFAULT_MODE -- because for some pairings a filtered
 * plot is a single mark, which says nothing without its surroundings. */
export type ScopeMode = "only" | "context";

interface ScopeChipProps {
  visual: VisualKey;
  scope: ResolvedScope | null;
  loading: boolean;
  /** Set when a subject is routed but couldn't be resolved -- a stale link,
   * or a cache that hasn't filled far enough to hold that record yet. */
  unresolved: boolean;
  mode: ScopeMode;
  onModeChange: (mode: ScopeMode) => void;
  /** How many of the plotted rows the scope actually matched, for the
   * count on the chip -- the visual knows this, the scope doesn't (a scope
   * names events that may be undated, or places without coordinates). */
  matched: number;
  /** What `matched` counts, singular: "event", "place". */
  noun: string;
}

/** The "showing one record's slice of the tree" indicator, in the visual's
 * header next to its title.
 *
 * Dismissing it navigates rather than clearing local state -- the scope
 * lives in the route (see hash.ts's VisualSubject), so ✕ is a link back to
 * the unscoped page and Back returns to the scoped one, which is what the
 * browser's own controls already led the user to expect. The mode toggle,
 * by contrast, is deliberately *not* routed: it's a way of looking at the
 * scope rather than part of what's being looked at, the same call the
 * search and category filters here already make. */
export function ScopeChip({
  visual, scope, loading, unresolved, mode, onModeChange, matched, noun,
}: ScopeChipProps) {
  if (loading) {
    return (
      <Group gap={6} wrap="nowrap">
        <Loader size="xs" />
        <Text size="xs" c="dimmed">Loading this record…</Text>
      </Group>
    );
  }

  if (unresolved) {
    return (
      <Tooltip
        label="This record isn't in this device's cache — it may have been deleted, or the cache is still filling."
        withArrow
        multiline
        w={260}
      >
        <Badge size="sm" variant="light" color="yellow" style={{ textTransform: "none" }}>
          Record not found — showing the whole tree
        </Badge>
      </Tooltip>
    );
  }

  if (!scope) return null;

  const empty = matched === 0;
  return (
    <Group gap="xs" wrap="nowrap">
      <Badge
        size="sm"
        variant="light"
        color={empty ? "yellow" : "blue"}
        style={{ textTransform: "none", maxWidth: 320 }}
        rightSection={
          <Tooltip label="Show the whole tree" withArrow>
            {/* An anchor, not a button: this is a navigation, and making it
                a real link means middle-click and copy-link behave. */}
            <a
              href={formatHash({ viewKey: visual })}
              aria-label="Show the whole tree"
              style={{ color: "inherit", textDecoration: "none", paddingLeft: 4 }}
            >
              ✕
            </a>
          </Tooltip>
        }
      >
        {scope.label}
      </Badge>
      {empty ? (
        <Text size="xs" c="dimmed">
          nothing to plot for this record — showing the whole tree
        </Text>
      ) : (
        <SegmentedControl
          size="xs"
          value={mode}
          onChange={(value) => onModeChange(value as ScopeMode)}
          data={[
            { value: "only", label: `Only these ${matched.toLocaleString()}` },
            { value: "context", label: "In context" },
          ]}
          aria-label={`Show only this record's ${noun}s, or highlight them in the whole tree`}
        />
      )}
    </Group>
  );
}
