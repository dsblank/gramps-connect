import { forwardRef } from "react";
import type { KeyboardEvent, SyntheticEvent } from "react";
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
  // SyntheticEvent, not MouseEvent -- every caller only ever calls
  // e.stopPropagation() (or ignores it), and component="span" below drives
  // this from a keyboard event too, not just a click.
  onClick: (e: SyntheticEvent) => void;
  size?: number;
  /** When set, the circle is followed by this text inside the *same*
   * clickable button (AttachControl.tsx's "+ Add a note" style triggers)
   * instead of rendering as a bare icon with only a hover tooltip -- the
   * whole phrase is the click target, not just the small circle. */
  textLabel?: string;
  /** "span" for a caller nesting this inside another real `<button>`
   * (PyodidePocPanel.tsx's per-tab edit/remove glyphs, inside a Mantine
   * Tabs.Tab -- itself a `<button role="tab">`) -- a `<button>` inside a
   * `<button>` is invalid HTML (React warns: "validateDOMNesting(...):
   * <button> cannot appear as a descendant of <button>", and browsers don't
   * agree on how to recover from it, which can break the outer button's own
   * click handling, not just print a warning). Keyboard activation
   * (Enter/Space) and focusability are native to a real <button> but not to
   * a <span> -- both are added back by hand below rather than silently lost
   * for this case, since these glyphs are specifically meant to be
   * keyboard-reachable (see PyodidePocPanel.module.css's own
   * :focus-within reveal rule for them). */
  component?: "button" | "span";
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
 * `<button>` (component="button", the default -- see that prop's own doc
 * comment for the component="span" exception, where the ref's actual
 * element no longer matches this HTMLButtonElement typing, moot today since
 * no caller passes one either way) a caller (or a future Mantine
 * floating-element target) may need a DOM ref to -- a plain function
 * component would silently drop one. */
export const CircleGlyphButton = forwardRef<HTMLButtonElement, CircleGlyphButtonProps>(
  function CircleGlyphButton({ glyph, label, onClick, size = 20, textLabel, component = "button" }, ref) {
    // See the `component` prop's own doc comment -- a real <button> gets
    // Enter/Space activation and focusability for free; a <span> doesn't,
    // so component="span" adds both by hand instead of silently losing them.
    const spanA11yProps =
      component === "span"
        ? {
            role: "button" as const,
            tabIndex: 0,
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault(); // Space's default is to scroll the page
                onClick(e);
              }
            },
          }
        : undefined;
    if (textLabel) {
      return (
        <UnstyledButton component={component} ref={ref} onClick={onClick} aria-label={label} {...spanA11yProps}>
          <Group gap={6} wrap="nowrap">
            <span style={CIRCLE_STYLE(size)}>{glyph}</span>
            <Text size="sm" c="dimmed">{textLabel}</Text>
          </Group>
        </UnstyledButton>
      );
    }
    return (
      <Tooltip label={label} withArrow>
        <UnstyledButton
          component={component}
          ref={ref}
          onClick={onClick}
          aria-label={label}
          style={CIRCLE_STYLE(size)}
          {...spanA11yProps}
        >
          {glyph}
        </UnstyledButton>
      </Tooltip>
    );
  }
);
