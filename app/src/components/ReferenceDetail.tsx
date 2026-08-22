import { Alert, Divider, Stack, Text } from "@mantine/core";
import { VIEWS } from "../store/views";
import type { RefMeta } from "../store/objectDetail";
import { RelatedPanel } from "./RelatedPanel";
import { RefMetaRow } from "./related/RefBadges";
import { MediaGallery } from "./related/MediaGallery";
import type { GalleryItem, OnNavigate } from "./related/types";
import type { UseDraftStack } from "../store/draftStack";
import { t } from "../i18n/i18n";

export type SubSelection =
  | { kind: "object"; type: string; handle: string; refMeta?: RefMeta }
  | { kind: "gallery"; items: GalleryItem[]; label: string };

interface ReferenceDetailProps {
  subSelection: SubSelection | null;
  /** Promotes to a real view switch (location.hash) -- wired by AsideSplit,
   * the one place that decides what "navigate" means for each pane. */
  onPromote: OnNavigate;
  /** Passed straight through to whichever body this renders -- see
   * RelatedPanel's `flow`. */
  flow?: boolean;
  /** Passed straight through to the nested RelatedPanel -- see its own
   * `draftStack` doc comment. */
  draftStack?: UseDraftStack;
}

/** The lower-right pane: whatever was clicked in the upper pane's
 * RelatedPanel -- either a single object's own reference detail (its
 * metadata plus its own RelatedPanel, reused unchanged) or, from
 * MediaSection's "view gallery" link, a grid of every photo attached to a
 * record too large to expand inline (see MediaSection's doc comment). */
export function ReferenceDetail({ subSelection, onPromote, flow, draftStack }: ReferenceDetailProps) {
  if (!subSelection) {
    return (
      <Stack p="md">
        <Text c="dimmed" size="md">{t("Select a related item above to see its details.")}</Text>
      </Stack>
    );
  }

  if (subSelection.kind === "gallery") {
    return (
      <MediaGallery
        items={subSelection.items}
        label={subSelection.label}
        onPromote={(type, handle) => onPromote(type, handle)}
        flow={flow}
      />
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
    <Stack gap={0} h={flow ? undefined : "100%"}>
      {refMeta && (
        <>
          <Stack gap={4} p="md" pb="sm">
            <RefMetaRow refMeta={refMeta} />
          </Stack>
          <Divider />
        </>
      )}
      <div style={flow ? undefined : { flex: 1, minHeight: 0 }}>
        {/* No live-sync revision source for a sub-selected type outside the
            main table's own ViewStore -- refetches on (type, handle) change
            only, not on a background live-sync patch to this specific
            record. Acceptable for now; the main pane's own ViewStore-driven
            revision already covers the common case.
            No onViewGallery here -- see RelatedPanelProps' doc comment on
            why the bottom pane's own Media sections fall back to a plain
            count instead. */}
        <RelatedPanel
          view={view} handle={handle} draftStack={draftStack} revision={0} onNavigate={onPromote} flow={flow}
        />
      </div>
    </Stack>
  );
}
