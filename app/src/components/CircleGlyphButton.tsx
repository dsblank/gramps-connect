import { forwardRef } from "react";
import type { MouseEvent } from "react";
import { Group, Text, Tooltip, UnstyledButton } from "@mantine/core";

interface CircleGlyphButtonProps {
  /** A plain text glyph, not restricted to a fixed set -- "+"/"−" for
   * attach/detach (see this component's own doc comment), "🔗" for RefRow's
   * "edit this reference's relationship metadata" (RefEditDialog.tsx). An
   * emoji here, not a thin single character like "↔": at this button's
   * small size a line-based glyph was visually indistinguishable from the
   * "−" remove button next to it (confirmed live) -- 🔗's shape and color
   * read clearly even at 16px, and DeleteButton.tsx's "🗑" already
   * establishes emoji as this codebase's answer for "needs to be
   * unambiguous at a glance", not just plain text (EditButton.tsx's "✎"
   * gets away with plain text only because nothing else in its header row
   * is glyph-shaped enough to confuse it with). */
  glyph: string;
  label: string;
  onClick: (e: MouseEvent) => void;
  size?: number;
  /** When set, the circle is followed by this text inside the *same*
   * clickable button (AttachControl.tsx's "+ Add a note" style triggers)
   * instead of rendering as a bare icon with only a hover tooltip -- the
   * whole phrase is the click target, not just the small circle. */
  textLabel?: string;
}

const CIRCLE_STYLE = (size: number) =>
  ({
    width: size,
    height: size,
    minWidth: size,
    borderRadius: "50%",
    border: "1px solid var(--mantine-color-default-border)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 1,
    fontSize: Math.round(size * 0.65),
    flexShrink: 0,
  }) as const;

/** A small circled "+"/"−" glyph button -- the shared visual language for
 * every "attach an existing record" / "detach this reference" action
 * (AttachControl.tsx's trigger, RefRow's Remove, TagsSection's badge close,
 * FamilyEditDialog's parent/child Remove and ChildrenField's "add" trigger)
 * -- a plain circle + character, not a colored "Delete" link, so removing a
 * reference doesn't read as more alarming than attaching one does.
 *
 * Plain CSS circle rather than a new SVG asset: Gramps' own icon set
 * (assets/icons/ATTRIBUTION.md) has no generic add/remove glyph to copy --
 * those come from the OS's GTK icon theme at runtime, not bundled Gramps
 * artwork -- and this codebase already prefers a plain text glyph over
 * sourcing a new icon for a single button (see EditButton.tsx's own doc
 * comment on why its ✎ is text, not an SVG).
 *
 * forwardRef, not a plain function component, since this wraps a real
 * `<button>` a caller (or a future Mantine floating-element target) may
 * need a DOM ref to -- a plain function component would silently drop one. */
export const CircleGlyphButton = forwardRef<HTMLButtonElement, CircleGlyphButtonProps>(
  function CircleGlyphButton({ glyph, label, onClick, size = 20, textLabel }, ref) {
    if (textLabel) {
      return (
        <UnstyledButton ref={ref} onClick={onClick} aria-label={label}>
          <Group gap={6} wrap="nowrap">
            <span style={CIRCLE_STYLE(size)}>{glyph}</span>
            <Text size="sm" c="dimmed">{textLabel}</Text>
          </Group>
        </UnstyledButton>
      );
    }
    return (
      <Tooltip label={label} withArrow>
        <UnstyledButton ref={ref} onClick={onClick} aria-label={label} style={CIRCLE_STYLE(size)}>
          {glyph}
        </UnstyledButton>
      </Tooltip>
    );
  }
);
