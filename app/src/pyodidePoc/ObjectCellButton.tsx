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
import type { ReactElement } from "react";
import { formatHash, isSubjectKey, type VisualKey } from "../hash";
import { t } from "../i18n/i18n";
import { summaryLine, summaryText } from "../components/related/summary";
import type { ObjectCell } from "./types";

// The field(s) summaryLine() needs for each type to say more than
// "(unnamed)"/"(event)" -- a filter() result has only its what= fields, so
// a cell without them keeps the Gramplet's own text (pyodideWorker.ts's
// _describe_object), which names the type instead. Place labels come from
// the tree's place index by handle, so need nothing.
const SUMMARY_NEEDS: Record<string, string[]> = {
  person: ["primary_name"],
  family: ["father", "mother"],
  event: ["type", "date"],
  repository: ["name"],
  source: ["title"],
  citation: ["source", "page"],
  media: ["desc", "path"],
  note: ["text"],
  tag: ["name"],
};

function summaryFields(cell: ObjectCell): Record<string, unknown> | null {
  const fields = cell.fields;
  if (!fields) return null;
  const needs = SUMMARY_NEEDS[cell.objectType];
  if (needs && !needs.some((key) => fields[key] != null)) return null;
  return { ...fields, handle: cell.handle };
}

/** A table link's label: the same text "Referenced by" shows for that
 * record (summary.ts's summaryLine(), in the tree's name/date formats),
 * when the Gramplet fetched the fields for it, else row()'s own text. */
export function objectCellLabel(cell: ObjectCell): string {
  const fields = summaryFields(cell);
  return (fields && summaryLine(cell.objectType, fields)) || cell.text;
}

/** What a sortable table orders a link by: its label without the leading
 * Gramps ID (so people sort by name, not ID), then the ID. */
export function objectCellSortKeys(cell: ObjectCell): [string, string] {
  const fields = summaryFields(cell);
  if (fields) {
    const id = typeof fields.gramps_id === "string" ? fields.gramps_id : "";
    return [summaryText(cell.objectType, fields), id];
  }
  const match = /^\[([^\]]*)\] (.*)$/su.exec(cell.text);
  return match ? [match[2], match[1]] : [cell.text, ""];
}

// Which visuals apply to which subject type -- same applicability
// VisualButtons.tsx's HINTS table encodes (Tree only for person/family).
const VISUAL_APPLICABLE: Record<string, VisualKey[]> = {
  person: ["map", "timeline", "tree"],
  family: ["map", "timeline", "tree"],
  event: ["map", "timeline"],
  place: ["map", "timeline"],
};

export interface ObjectMenuAction {
  label: string;
  onClick: () => void;
}

/** What a chart's person menus show, besides the usual Open/Map/Timeline/
 * Tree: visuals to leave out, and items of the chart's own for the person
 * with that handle. */
export interface PersonMenuOptions {
  hideVisuals?: VisualKey[];
  actions?: (handle: string) => ObjectMenuAction[];
}

export function ObjectCellButton({ cell }: { cell: ObjectCell }) {
  const label = objectCellLabel(cell);
  return (
    <ObjectMenu objectType={cell.objectType} handle={cell.handle} label={label}>
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
        {label}
      </Text>
    </ObjectMenu>
  );
}

/** The same menu around any clickable target -- RelationshipChart.tsx's
 * person cards use it, so a person there offers what one in a table does.
 * `children` must accept a ref (Mantine's Menu.Target requirement). */
export function ObjectMenu({
  objectType,
  handle,
  label,
  hideVisuals = [],
  actions = [],
  children,
}: {
  objectType: string;
  handle: string;
  label: string;
  /** Visuals to leave out -- e.g. "tree" inside the Graphs view itself,
   * where "See as Tree" would only re-root the chart being looked at. */
  hideVisuals?: VisualKey[];
  /** Items for where the menu is shown, listed first -- e.g. the Graphs
   * view's Relationship mode's "Use as first person". */
  actions?: ObjectMenuAction[];
  children: ReactElement;
}) {
  const visuals = (isSubjectKey(objectType) ? VISUAL_APPLICABLE[objectType] ?? [] : []).filter((v) => !hideVisuals.includes(v));

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
    // VISUAL_APPLICABLE above never lists "search", "changed", "visited" or "bookmarks" -- these
    // exist only to keep the Record exhaustive, same as VisualButtons.tsx's LABELS.
    search: t("Search all"),
    changed: t("Change Log"),
    visited: t("Visited"),
    bookmarks: t("Bookmarks"),
  };

  return (
    <Menu position="bottom-start" withArrow shadow="md">
      <Menu.Target>{children}</Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{label}</Menu.Label>
        {actions.map((action) => (
          <Menu.Item key={action.label} onClick={action.onClick}>
            {action.label}
          </Menu.Item>
        ))}
        {actions.length > 0 && <Menu.Divider />}
        <Menu.Item component="a" href={formatHash({ viewKey: objectType, handle })}>
          {openLabels[objectType] ?? t("Open")}
        </Menu.Item>
        {visuals.map((visual) => (
          <Menu.Item
            key={visual}
            component="a"
            href={formatHash({ viewKey: visual, subject: { type: objectType, handle } })}
          >
            {visualItemLabels[visual]}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
