import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Box, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import { useViewStore } from "../hooks/useViewStore";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { formatHash } from "../hash";
import { VIEWS, type ViewConfig } from "../store/views";
import { RelatedPanel } from "./RelatedPanel";
import { ReferenceDetail } from "./ReferenceDetail";
import type { SubSelection } from "./ReferenceDetail";
import { CurrentPageContext } from "./related/CurrentPageContext";
import type { UseDraftStack } from "../store/draftStack";

interface AsideSplitProps {
  view: ViewConfig;
  /** Narrow, stacked layout (App.tsx): both panes size to their content
   * and the *page* scrolls, instead of splitting a fixed-height column
   * between two independently-scrolling halves. Threaded on down into
   * RelatedPanel/ReferenceDetail, which own scrollers of their own. */
  flow?: boolean;
  /** Owned by App.tsx -- threaded through to both panes' RelatedPanel so
   * either can offer an Edit button (see RelatedPanel's own doc comment). */
  draftStack?: UseDraftStack;
}

/** What the collapsed strip says it's holding. Only ever visible in the
 * "manually collapsed while something is still sub-selected" state (every
 * other route to a collapsed pane also clears the sub-selection), so the
 * object type is enough to tell the user reopening is worth it -- not worth
 * plumbing the sub-selected record's own fetched title up two components
 * for. */
function stripLabel(subSelection: SubSelection | null): string {
  if (!subSelection) return "Reference detail";
  if (subSelection.kind === "gallery") return `Reference detail — ${subSelection.label}`;
  const label = VIEWS.find((v) => v.key === subSelection.type)?.label;
  return label ? `Reference detail — ${label}` : "Reference detail";
}

/** Replaces the old single-pane DetailPanel mount in App.tsx's
 * AppShell.Aside with the two stacked panes: the main table's selected row
 * drives the top RelatedPanel; clicking a reference inside it sets
 * `subSelection` (plain lifted state, not a new global store -- both
 * panes are direct siblings here, and this state is exactly as ephemeral
 * as PersonDetail's old parentsOpen/Collapse state already was, not
 * something worth URL-syncing) rather than navigating away, and the bottom
 * ReferenceDetail renders it. A link clicked *inside* ReferenceDetail is
 * what actually promotes to a real view switch (location.hash), which
 * naturally clears subSelection via the effect below once the main
 * selection changes underneath it.
 *
 * The bottom pane is collapsible, and defaults to collapsed: its empty
 * state is a *steady* state (you can read a record's relations without
 * ever drilling into one), unlike the top pane's, which no longer really
 * exists now that ViewStore auto-selects a first row. Collapsed it keeps a
 * one-line strip rather than disappearing outright -- the whole
 * interaction model here is positional ("clicking in the top pane
 * previews into the bottom one; clicking in the bottom one commits"), and
 * that's only learnable if the pane being previewed into is visibly
 * there. It opens automatically on the first drill-down click and then
 * stays open: auto-collapsing the moment a sub-selection goes away is what
 * makes this kind of pane feel flickery. The one exception is a change of
 * subject (a new main-table row, or a new view), which is also the only
 * thing that clears `subSelection` -- keeping the pane open there would
 * just re-create the empty half-pane this is meant to avoid. */
export function AsideSplit({ view, flow, draftStack }: AsideSplitProps) {
  const snapshot = useViewStore(view.key);
  const [subSelection, setSubSelection] = useState<SubSelection | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const topPaneRef = useRef<HTMLDivElement>(null);
  const bottomPaneRef = useRef<HTMLDivElement>(null);
  // The element the user last clicked inside the top pane, captured
  // generically here rather than threaded through OnNavigate (which every
  // section component implements) -- see the layout effect below.
  const lastClickedRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    setSubSelection(null);
    setDetailOpen(false);
  }, [view.key, snapshot.selectedHandle]);

  // Opening the bottom pane halves the top one, which moves the very row
  // the user just clicked -- often right out of sight, since anything they
  // clicked in the lower half of the full-height pane now sits below the
  // fold. Scroll it back into view on the closed -> open transition (only:
  // re-running on every render would fight the user's own scrolling once
  // the pane is already open). "nearest" keeps the correction to the
  // minimum movement needed, so a row that's still visible doesn't jump.
  //
  // Stacked (`flow`) the panes don't share a fixed height, so nothing
  // moves and there's nothing to correct -- but the bottom pane now opens
  // below the whole of the top one, usually off-screen, which makes the
  // click look like it did nothing. Scroll to the pane itself instead.
  useLayoutEffect(() => {
    const justOpened = detailOpen && !wasOpenRef.current;
    wasOpenRef.current = detailOpen;
    if (!justOpened) return;
    if (flow) {
      bottomPaneRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
    const el = lastClickedRef.current;
    if (el && topPaneRef.current?.contains(el)) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [detailOpen, flow]);

  // A generic, view-level title while nothing's selected (or as a brief
  // first paint before the selected record's own fetch resolves) --
  // RelatedPanel below overrides this with the specific record's title
  // once loaded (see its own updateDocumentTitle prop); undefined here is
  // a deliberate no-op rather than resetting to this generic title on
  // every render once RelatedPanel has already set something more
  // specific (see useDocumentTitle's own doc comment). Checked the same
  // way as the early return just below (not a derived boolean) so TS's
  // narrowing of selectedHandle to non-null past that return still holds.
  useDocumentTitle(
    snapshot.selectedIndex === null || snapshot.selectedHandle === null
      ? `${view.label} — Gramps Connect`
      : undefined
  );

  if (snapshot.selectedIndex === null || snapshot.selectedHandle === null) {
    // Now a genuinely exceptional state rather than the normal way a view
    // opens: ViewStore.applyDefaultSelection() selects a first row as soon
    // as one exists, so reaching here means there are no rows to select
    // (yet, or at all under the current filter).
    const message =
      snapshot.status === "idle" || snapshot.status === "loading"
        ? "Loading…"
        : snapshot.totalCount === 0
          ? "No records to show."
          : "Select a row to see its details.";
    return (
      <Stack p="md">
        <Text c="dimmed" size="md">{message}</Text>
      </Stack>
    );
  }

  return (
    // Both panes see the same "what's the main table's current selection"
    // identity -- set once here (the only place that actually knows it)
    // rather than threading it as a prop through every section component.
    // See CurrentPageContext's doc comment for why (self-referencing
    // links, e.g. a family's Children list including the very person
    // whose page you're already on).
    <CurrentPageContext.Provider value={{ type: view.key, handle: snapshot.selectedHandle }}>
      <Stack h={flow ? undefined : "100%"} gap={0}>
        <Box
          ref={topPaneRef}
          onClickCapture={(e) => { lastClickedRef.current = e.target as HTMLElement; }}
          style={flow ? undefined : { flex: 1, minHeight: 0, overflow: "auto" }}
        >
          <RelatedPanel
            flow={flow}
            view={view}
            draftStack={draftStack}
            handle={snapshot.selectedHandle}
            revision={snapshot.selectedRevision}
            onNavigate={(type, handle, refMeta) => {
              setSubSelection({ kind: "object", type, handle, refMeta });
              setDetailOpen(true);
            }}
            onViewGallery={(items, label) => {
              setSubSelection({ kind: "gallery", items, label });
              setDetailOpen(true);
            }}
            updateDocumentTitle
          />
        </Box>
        <UnstyledButton
          onClick={() => setDetailOpen((open) => !open)}
          aria-expanded={detailOpen}
          style={{
            flex: "none",
            padding: "6px var(--mantine-spacing-md)",
            borderTop: "1px solid var(--mantine-color-default-border)",
            borderBottom: detailOpen ? "1px solid var(--mantine-color-default-border)" : undefined,
            background: "var(--mantine-color-default-hover)",
          }}
        >
          <Group gap={6} wrap="nowrap">
            {/* Same plain-text triangles DataTable's sort header uses --
                this project carries no icon dependency. */}
            <Text size="xs" c="dimmed">{detailOpen ? "▾" : "▴"}</Text>
            <Text size="xs" c="dimmed" fw={600} truncate>{stripLabel(subSelection)}</Text>
          </Group>
        </UnstyledButton>
        {detailOpen && (
          <Box ref={bottomPaneRef} style={flow ? undefined : { flex: 1, minHeight: 0, overflow: "auto" }}>
            <ReferenceDetail
              flow={flow}
              draftStack={draftStack}
              subSelection={subSelection}
              onPromote={(type, handle) => {
                window.location.hash = formatHash({ viewKey: type, handle });
              }}
            />
          </Box>
        )}
      </Stack>
    </CurrentPageContext.Provider>
  );
}
