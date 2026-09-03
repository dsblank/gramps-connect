import { Box, Group, Stack } from "@mantine/core";
import type { ViewConfig } from "../../store/views";
import type { UseDraftStack } from "../../store/draftStack";
import type { OnNavigate, OnViewGallery } from "./types";
import { RelatedPanel } from "../RelatedPanel";
import { MergeButton } from "./MergeButton";
import { BulkDeleteButton } from "./BulkDeleteButton";
import { BulkTagButton } from "./BulkTagButton";

/** AsideSplit.tsx's top-pane mount whenever 1 or 2 rows are selected --
 * covers both the plain single-selection case and the 2-selected split
 * "Merge" view in one component (rather than two, switched between by
 * AsideSplit) specifically so that ctrl/cmd-clicking a *second* row doesn't
 * unmount/remount the pane for the row already showing: each pane is keyed
 * by its own handle inside the same always-present Box/Group structure, so
 * React reconciles the existing pane in place (no refetch, no loading
 * flash) and only mounts a fresh one for the newly added handle. Swapping
 * between two structurally different components at that JSX position (the
 * original approach) can't achieve that -- React remounts everything under
 * a changed component type regardless of any inner keys.
 *
 * `handles.length === 1`: exactly today's single-select behavior -- one
 * full-width pane with its own action row (Edit/Delete/Message).
 * `handles.length === 2`: two panes side by side, each with its own action
 * row suppressed (`actions={false}`), and a single shared header row above
 * both holding Merge, Delete and Tag -- Edit/Message have no bulk equivalent
 * here (2-selected mode has nothing to open a shared edit dialog for, and
 * "message about both of these" doesn't reduce to one target), but Delete
 * and Tag both make sense at any selection size 2+, so (unlike Merge, which
 * needs both a mergeable type and Edit+Delete permissions -- MergeButton
 * itself renders nothing when ineligible, leaving Delete/Tag in the row)
 * BulkDeleteButton/BulkTagButton are the exact same components
 * SelectionBulkView.tsx uses for 3+, just handed a 2-length `handles` array.
 * 3+ selected is a different display mode entirely (SelectionBulkView.tsx),
 * not handled here. */
export function SelectionDetailView({
  view, handles, draftStack, revision, onNavigate, onViewGallery, flow,
}: {
  view: ViewConfig;
  handles: [string] | [string, string];
  draftStack?: UseDraftStack;
  revision: number;
  onNavigate: OnNavigate;
  onViewGallery?: OnViewGallery;
  flow?: boolean;
}) {
  const isSplit = handles.length === 2;

  return (
    <Stack gap={0} h={flow ? undefined : "100%"}>
      {isSplit && (
        <Group gap="xs" p="md" pb={0} justify="flex-end" style={{ flex: "none" }}>
          <MergeButton view={view} handles={handles} />
          <BulkDeleteButton view={view} handles={handles} />
          <BulkTagButton view={view} handles={handles} />
        </Group>
      )}
      <Group gap={0} wrap="nowrap" align="stretch" style={flow ? undefined : { flex: 1, minHeight: 0 }}>
        {handles.map((h, i) => (
          <Box
            key={h}
            style={{
              flex: 1,
              minWidth: 0,
              borderRight: isSplit && i === 0 ? "1px solid var(--mantine-color-default-border)" : undefined,
              // Only the split (2-pane) layout needs its own scroll
              // container per pane -- the single-pane case leaves this Box
              // a transparent wrapper so scrolling stays owned by whatever
              // already owned it before this component existed (AsideSplit's
              // outer Box, or RelatedPanel's own ScrollArea), unchanged.
              ...(isSplit && !flow ? { height: "100%", overflow: "auto" } : {}),
            }}
          >
            <RelatedPanel
              view={view}
              handle={h}
              draftStack={draftStack}
              revision={revision}
              onNavigate={onNavigate}
              onViewGallery={onViewGallery}
              actions={!isSplit}
              updateDocumentTitle={!isSplit}
              flow={flow}
            />
          </Box>
        ))}
      </Group>
    </Stack>
  );
}
