import { useEffect, useState } from "react";
import { Box, Stack, Text } from "@mantine/core";
import { useViewStore } from "../hooks/useViewStore";
import { formatHash } from "../hash";
import type { ViewConfig } from "../store/views";
import { RelatedPanel } from "./RelatedPanel";
import { ReferenceDetail } from "./ReferenceDetail";
import type { SubSelection } from "./ReferenceDetail";

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

  if (snapshot.selectedIndex === null || snapshot.selectedHandle === null) {
    return (
      <Stack p="md">
        <Text c="dimmed" size="md">Select a row to see its details.</Text>
      </Stack>
    );
  }

  return (
    <Stack h="100%" gap={0}>
      <Box style={{ flex: 1, minHeight: 0, overflow: "auto", borderBottom: "1px solid var(--mantine-color-default-border)" }}>
        <RelatedPanel
          view={view}
          handle={snapshot.selectedHandle}
          revision={snapshot.revision}
          onNavigate={(type, handle, refMeta) => setSubSelection({ type, handle, refMeta })}
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
  );
}
