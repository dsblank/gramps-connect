import { Alert, Divider, Stack, Text } from "@mantine/core";
import { VIEWS } from "../store/views";
import type { RefMeta } from "../store/objectDetail";
import { RelatedPanel } from "./RelatedPanel";
import { RefMetaRow } from "./related/RefBadges";
import type { OnNavigate } from "./related/types";

export interface SubSelection {
  type: string;
  handle: string;
  refMeta?: RefMeta;
}

interface ReferenceDetailProps {
  subSelection: SubSelection | null;
  /** Promotes to a real view switch (location.hash) -- wired by AsideSplit,
   * the one place that decides what "navigate" means for each pane. */
  onPromote: OnNavigate;
}

/** The lower-right pane: whatever was clicked in the upper pane's
 * RelatedPanel. Shows that specific *reference's* own metadata (frel/mrel/
 * role/private/note-and-citation-counts -- the data a plain "jump to this
 * row" link would otherwise discard) above the target object's own
 * RelatedPanel, reused unchanged -- this is not a second renderer, just
 * RelatedPanel mounted again for a different (type, handle) with a
 * different onNavigate wired in. */
export function ReferenceDetail({ subSelection, onPromote }: ReferenceDetailProps) {
  if (!subSelection) {
    return (
      <Stack p="md">
        <Text c="dimmed" size="md">Select a related item above to see its details.</Text>
      </Stack>
    );
  }

  const { type, handle, refMeta } = subSelection;
  const view = VIEWS.find((v) => v.key === type);
  if (!view) {
    return (
      <Alert color="red" m="md">
        Unknown object type "{type}".
      </Alert>
    );
  }

  return (
    <Stack gap={0} h="100%">
      {refMeta && (
        <>
          <Stack gap={4} p="md" pb="sm">
            <RefMetaRow refMeta={refMeta} />
          </Stack>
          <Divider />
        </>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        {/* No live-sync revision source for a sub-selected type outside the
            main table's own ViewStore -- refetches on (type, handle) change
            only, not on a background live-sync patch to this specific
            record. Acceptable for now; the main pane's own ViewStore-driven
            revision already covers the common case. */}
        <RelatedPanel view={view} handle={handle} revision={0} onNavigate={onPromote} />
      </div>
    </Stack>
  );
}
