import { type ReactNode } from "react";
import { Alert, Box, Group, Loader, Stack, Text } from "@mantine/core";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";

interface VisualFrameProps {
  /** "Map"/"Timeline", at the head of the toolbar row. The page it names
   * has no other label on screen -- the icon rail highlights no object type
   * while a visual is open -- and it's this app's only heading below the
   * window title. */
  title: string;
  /** The scope indicator (ScopeChip), directly after the title -- it
   * qualifies what the page *is* ("Map — of Bob Smith"), so it sits with
   * the heading rather than down among the filters, which only narrow
   * what's already in scope. */
  scope?: ReactNode;
  /** Filters and legend -- one row directly above the plot, in the place
   * FilterBar's search row occupies on a table view. */
  toolbar?: ReactNode;
  /** Bottom strip: what's plotted, and any cache-completeness caveat. */
  status?: ReactNode;
  loading: boolean;
  /** Defaults to Map/Timeline's own copy -- override for a visual (Tree)
   * whose loading state isn't "places and events". */
  loadingText?: string;
  error: string | null;
  /** Rendered instead of `children` when there's nothing to plot, so each
   * visual can say why in its own terms. */
  empty?: ReactNode;
  children: ReactNode;
}

/** The frame both View > Map and View > Timeline live in: a bordered panel
 * whose body is a flex column (toolbar, plot, status), so the plot gets
 * exactly the leftover space and scrolls nothing. Its height comes from
 * whoever places it (App.tsx sizes it to the window), because both plots
 * measure themselves against this column -- the timeline off its own
 * ResizeObserver, the map off maplibre's -- and so need a real bounded
 * height rather than one that grows to fit content.
 *
 * These are pages, not dialogs: a whole-tree overview is a place you go,
 * with its own #/map or #/timeline route that Back steps out of, and the
 * window is the most of it you can see. Clicking a marker or a dot is the
 * one thing that leaves -- it navigates to that record in Places or Events,
 * where the three-pane layout takes over. */
export function VisualFrame({
  title, scope, toolbar, status, loading, loadingText = "Loading places and events…", error, empty, children,
}: VisualFrameProps) {
  useDocumentTitle(`${title} — Gramps Connect`);
  return (
    <Box
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        border: "1px solid var(--mantine-color-default-border)",
      }}
    >
      <Box style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
        <Group px="md" py="xs" gap="md" wrap="nowrap">
          <Text component="h2" size="sm" fw={600} m={0} style={{ flex: "none" }}>{title}</Text>
          {/* The toolbar takes the rest of the row and does its own wrapping
              inside it -- a filter row is much wider than this heading, and on
              a narrow window it's the filters that should stack, not the
              heading that should be pushed off. */}
          <Box style={{ flex: 1, minWidth: 0 }}>{toolbar}</Box>
        </Group>
        {/* A row of its own rather than a third item in the row above: the
            chip carries a record name of unbounded length plus a two-option
            control, and squeezing that between the heading and an already
            crowded filter row is what pushes the filters off a narrow
            window. Only present while the page is scoped. */}
        {scope && <Box px="md" pb="xs">{scope}</Box>}
      </Box>
      <Box style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}>
        {error ? (
          <Alert color="red" m="md" title="Couldn't load the tree's data">{error}</Alert>
        ) : loading ? (
          <Center>
            <Group gap="xs">
              <Loader size="sm" />
              <Text size="sm" c="dimmed">{loadingText}</Text>
            </Group>
          </Center>
        ) : empty ? (
          <Center>{empty}</Center>
        ) : (
          children
        )}
      </Box>
      {status && (
        <Box px="md" py={6} style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
          {status}
        </Box>
      )}
    </Box>
  );
}

/** Mantine's own Center would do, but this also has to fill the flex column
 * rather than sit at its natural height. */
function Center({ children }: { children: ReactNode }) {
  return (
    <Stack align="center" justify="center" style={{ flex: 1, minHeight: 0 }}>
      {children}
    </Stack>
  );
}
