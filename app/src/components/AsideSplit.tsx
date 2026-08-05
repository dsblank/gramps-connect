import { useEffect, useState } from "react";
import { Box, Stack, Text } from "@mantine/core";
import { useViewStore } from "../hooks/useViewStore";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { formatHash } from "../hash";
import type { ViewConfig } from "../store/views";
import { RelatedPanel } from "./RelatedPanel";
import { ReferenceDetail } from "./ReferenceDetail";
import type { SubSelection } from "./ReferenceDetail";
import { CurrentPageContext } from "./related/CurrentPageContext";

interface AsideSplitProps {
  view: ViewConfig;
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
 * selection changes underneath it. */
export function AsideSplit({ view }: AsideSplitProps) {
  const snapshot = useViewStore(view.key);
  const [subSelection, setSubSelection] = useState<SubSelection | null>(null);

  useEffect(() => {
    setSubSelection(null);
  }, [view.key, snapshot.selectedHandle]);

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
    return (
      <Stack p="md">
        <Text c="dimmed" size="md">Select a row to see its details.</Text>
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
      <Stack h="100%" gap={0}>
        <Box style={{ flex: 1, minHeight: 0, overflow: "auto", borderBottom: "1px solid var(--mantine-color-default-border)" }}>
          <RelatedPanel
            view={view}
            handle={snapshot.selectedHandle}
            revision={snapshot.revision}
            onNavigate={(type, handle, refMeta) => setSubSelection({ kind: "object", type, handle, refMeta })}
            onViewGallery={(items, label) => setSubSelection({ kind: "gallery", items, label })}
            updateDocumentTitle
          />
        </Box>
        <Box style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <ReferenceDetail
            subSelection={subSelection}
            onPromote={(type, handle) => {
              window.location.hash = formatHash({ viewKey: type, handle });
            }}
          />
        </Box>
      </Stack>
    </CurrentPageContext.Provider>
  );
}
