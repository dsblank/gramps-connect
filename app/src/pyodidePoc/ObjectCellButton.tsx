// Renders a Gramplet result-table cell that pyodideWorker.ts's row()
// recognized as a primary object (types.ts's ObjectCell) -- clickable link
// text (RelatedPanel.tsx's ClickableTitle blue-text convention) that pops a
// Menu offering navigation, rather than a plain onClick that jumps
// straight there: a table row can hold several such cells at once (e.g.
// row(person, event)), and each needs its own independent "where do I want
// to go" choice, the same way Map/Timeline/Tree's own selection cards
// (MapView's PlaceCard, TimelineView's EventCard, TreeView's PersonCard)
// offer a choice rather than navigating on the first click.
//
// Menu rather than Popover -- see AttachControl.tsx's own comment on why a
// Popover is the wrong tool once a click needs to register cleanly; Menu's
// built-in outside-click/focus handling is a better fit for "click a
// target, get a short list of actions" than reimplementing that by hand.
import { Menu, Text } from "@mantine/core";
import { formatHash, isSubjectKey, type VisualKey } from "../hash";
import { t } from "../i18n/i18n";
import type { ObjectCell } from "./types";

// Which visuals apply to which subject type -- same applicability
// VisualButtons.tsx's HINTS table encodes (Tree only for person/family).
const VISUAL_APPLICABLE: Record<string, VisualKey[]> = {
  person: ["map", "timeline", "tree"],
  family: ["map", "timeline", "tree"],
  event: ["map", "timeline"],
  place: ["map", "timeline"],
};

export function ObjectCellButton({ cell }: { cell: ObjectCell }) {
  const visuals = isSubjectKey(cell.objectType) ? VISUAL_APPLICABLE[cell.objectType] ?? [] : [];

  // Called per-render (not hoisted to module scope) so a language switch
  // -- i18n.ts's t() reads current state, not a snapshot -- is reflected
  // here too. The plural, sidebar-facing phrasing TreeView/TimelineView's
  // own "Open in People"/"Open in Events" buttons already use for those
  // two types, extended to all ten so this one component can open any of
  // them; VISUAL_ITEM_LABELS is terser copy for a narrower slot than
  // VisualButtons.tsx's tooltipped buttons.
  const openLabels: Record<string, string> = {
    person: t("Open in People"),
    family: t("Open in Family"),
    event: t("Open in Events"),
    place: t("Open in Places"),
    repository: t("Open in Repositories"),
    source: t("Open in Sources"),
    citation: t("Open in Citations"),
    media: t("Open in Media"),
    note: t("Open in Notes"),
    tag: t("Open in Tags"),
  };
  const visualItemLabels: Record<VisualKey, string> = {
    map: t("Show on Map"),
    timeline: t("Put on Timeline"),
    tree: t("See as Tree"),
    // VISUAL_APPLICABLE above never lists "search" -- this entry exists
    // only to keep the Record exhaustive, same as VisualButtons.tsx's LABELS.
    search: t("Search all"),
  };

  return (
    <Menu position="bottom-start" withArrow shadow="md">
      <Menu.Target>
        <Text
          component="button"
          size="sm"
          style={{
            cursor: "pointer",
            background: "none",
            border: "none",
            padding: 0,
            textAlign: "left",
            color: "var(--mantine-color-blue-6)",
          }}
        >
          {cell.text}
        </Text>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{cell.text}</Menu.Label>
        <Menu.Item component="a" href={formatHash({ viewKey: cell.objectType, handle: cell.handle })}>
          {openLabels[cell.objectType] ?? t("Open")}
        </Menu.Item>
        {visuals.map((visual) => (
          <Menu.Item
            key={visual}
            component="a"
            href={formatHash({ viewKey: visual, subject: { type: cell.objectType, handle: cell.handle } })}
          >
            {visualItemLabels[visual]}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
