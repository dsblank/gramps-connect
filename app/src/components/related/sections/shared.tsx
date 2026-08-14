// Building blocks every section (generic or type-specific) is built from --
// keeping these in one place is what makes "add a private-flag badge
// everywhere" or "fix how a row's click target works" a one-file change
// instead of an 18-file one.
import type { ReactNode } from "react";
import { Anchor, Group, Image, Stack, Text, Tooltip } from "@mantine/core";
import { CircleGlyphButton } from "../../CircleGlyphButton";
import { VIEWS } from "../../../store/views";
import { summaryLine } from "../summary";
import { RefMetaRow } from "../RefBadges";
import { isCurrentPage, useCurrentPage } from "../CurrentPageContext";
import type { RefMeta } from "../../../store/objectDetail";
import type { OnNavigate } from "../types";

// Anchor's own "rendered as a button" styles default to a flex-centered,
// full-width control -- overridden back to plain inline text so these read
// as a name/date/title, not a wide centered button (ported from the
// original PersonDetail.tsx's LINK_STYLE).
const LINK_STYLE = { display: "inline", width: "auto", textAlign: "left" } as const;

/** No collapse/expand -- every one of this file's ~18 call sites always
 * passed `defaultOpen` anyway (collapsed-by-default was never actually
 * used), and the pane this renders in already scrolls, so a toggle added
 * nothing. Just a static label over its children -- no item count either
 * (redundant now that the list underneath it is always visible), and no
 * header-right action slot (AttachControl.tsx's "+" lives inside the list
 * as its own trailing row instead -- see NotesSection.tsx/CitationsSection.tsx/
 * TagsSection.tsx -- rather than crowding this one-line header). */
export function SectionShell({ label, children }: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Text size="md" fw={600}>{label}</Text>
      <Stack gap="sm" pl="md" pt="xs">{children}</Stack>
    </div>
  );
}

const TYPE_ICONS = new Map(VIEWS.map((v) => [v.key, { src: v.icon, label: v.label }]));

/** The one visual cue that a row's *target type* isn't necessarily what its
 * label looks like -- e.g. ParentsSection shows "Warner, Allen Carl" (reads
 * like a person) but the row actually navigates to the family he and the
 * viewed person's mother share, not to his own page (see ParentsSection's
 * doc comment). Reuses the same per-type icon set the sidebar already
 * shows, rather than inventing new iconography, so "family" already reads
 * as a familiar symbol by the time it shows up here. */
function TypeIcon({ type }: { type: string }) {
  const entry = TYPE_ICONS.get(type);
  if (!entry) return null;
  return (
    <Tooltip label={entry.label} position="top" withArrow openDelay={300}>
      <Image src={entry.src} alt="" w={14} h={14} style={{ opacity: 0.55, flexShrink: 0 }} />
    </Tooltip>
  );
}

/** One clickable reference row: a summary line for the target object plus
 * (when this ref carries its own metadata) the frel/mrel/role/private/
 * note-and-citation-count badges. Clicking never navigates directly --
 * always through the `onNavigate` callback RelatedPanel was given, so the
 * same row works whether it's mounted in the top pane (sets sub-selection)
 * or the bottom pane (promotes to a real view switch). */
export function RefRow({ type, handle, obj, refMeta, onNavigate, label, onEdit, onRemove }: {
  type: string;
  handle: string;
  obj: unknown;
  refMeta?: RefMeta;
  onNavigate: OnNavigate;
  /** Overrides summaryLine(type, obj) -- for the rare row that needs to
   * show something other than the target's own default summary (e.g.
   * FamiliesSection showing just the *other* spouse's name rather than
   * both family members). */
  label?: string;
  /** Opens RefEditDialog.tsx to edit this *reference's own* relationship
   * metadata (a ChildRef's frel/mrel, an EventRef's role, ...) -- distinct
   * from RelatedPanel's header EditButton, which edits the target object
   * itself. Only set by sections whose ref type carries editable metadata
   * (Children/Events/Participants/Associations/Repositories), already
   * permission-gated by the caller the same way onRemove is. */
  onEdit?: () => void;
  /** Detaches this reference from the record being viewed (not a delete of
   * the target object itself) -- only set by sections with an
   * AttachControl (Notes/Citations), already permission-gated by the
   * caller the same way AttachControl gates itself. */
  onRemove?: () => void;
}) {
  const currentPage = useCurrentPage();
  const text = label ?? summaryLine(type, obj);

  return (
    <Stack gap={2}>
      <Group gap={4} wrap="nowrap">
        <TypeIcon type={type} />
        {isCurrentPage(currentPage, type, handle) ? (
          // Already the record showing in the main table -- a link back to
          // it would be a pointless round trip, so it's just bold text
          // (still identifiable as "this is a reference to something",
          // just not one worth clicking) rather than a dead-end Anchor.
          <Text size="md" fw={700}>{text}</Text>
        ) : (
          <Anchor
            component="button"
            type="button"
            size="md"
            underline="hover"
            style={LINK_STYLE}
            onClick={() => onNavigate(type, handle, refMeta)}
          >
            {text}
          </Anchor>
        )}
        {onEdit && <CircleGlyphButton glyph="🔗" label="Edit relationship" onClick={onEdit} size={16} />}
        {onRemove && <CircleGlyphButton glyph="−" label="Remove" onClick={onRemove} size={16} />}
      </Group>
      <RefMetaRow refMeta={refMeta} />
    </Stack>
  );
}

/** Visually clusters a couple's two RefRows (father+mother, or a family's
 * own parents) into one unit -- side by side rather than the section's
 * normal one-row-per-list-item vertical stack, with a light border around
 * both, so "these two are a pair" reads at a glance instead of looking
 * like two unrelated list rows. Wraps to stacked on a narrow pane rather
 * than clipping/overflowing. */
export function PairGroup({ children }: { children: ReactNode }) {
  return (
    <Group
      gap="lg"
      align="flex-start"
      wrap="wrap"
      p={6}
      style={{
        border: "1px solid var(--mantine-color-default-border)",
        borderRadius: "var(--mantine-radius-sm)",
      }}
    >
      {children}
    </Group>
  );
}

/** Zips a plain handle-list ref field (CitationBase.citation_list,
 * NoteBase.note_list, PrimaryObject.tag_list -- none of these wrap their
 * target in a *Ref struct, just a bare handle string, so there's no
 * per-item metadata to carry) against its resolved `extended.*` array. */
export function zipHandles<T>(handles: unknown, extendedList: unknown): { handle: string; target: T }[] {
  const h = (handles as string[] | undefined) ?? [];
  const extended = (extendedList as T[] | undefined) ?? [];
  const length = Math.min(h.length, extended.length);
  const result: { handle: string; target: T }[] = [];
  for (let i = 0; i < length; i++) {
    result.push({ handle: h[i], target: extended[i] });
  }
  return result;
}
