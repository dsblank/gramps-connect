import { Button, Tooltip, useComputedColorScheme } from "@mantine/core";
import type { CSSProperties } from "react";

interface ViewButtonProps {
  label: string;
  /** Tooltip copy -- omitted entirely (no Tooltip wrapper) when absent. */
  hint?: string;
  /** A plain link (VisualButtons' Map/Timeline/Graphs) when set; otherwise
   * an onClick button (RelatedPanel's Topic "View", HistoryButton's
   * "History"). */
  href?: string;
  onClick?: () => void;
  /** Mantine color name -- omitted keeps the theme's default (VisualButtons'
   * Map/Timeline/Graphs: "look at this record a different way, right now").
   * A muted override (RelatedPanel's Topic "View", HistoryButton's
   * "History") sets these apart as a subtly different kind of thing --
   * stepping outside the record's current state, into a live conversation
   * about it or a look back at its past -- without a second row or a
   * competing accent color loud enough to read as a distinct control
   * family. */
  color?: string;
}

/** Shared size="xs" variant="light" styling for every "look at this record
 * a different way" button -- VisualButtons.tsx's Map/Timeline/Graphs
 * anchors and RelatedPanel.tsx's Topic "View" button. Pulled out into one
 * component (rather than each call site repeating the same Button props)
 * so the two can't drift out of visual sync the way Topic's "View" briefly
 * did (it started life as a wordier "Open discussion" at the header's
 * default size, not this row's size="xs").
 *
 * Tinted rather than the header icons' bare treatment -- these sit in the
 * body's own reading order, where an outline button reads as disabled next
 * to real text. */
export function ViewButton({ label, hint, href, onClick, color }: ViewButtonProps) {
  // useComputedColorScheme, not CSS light-dark() -- ChatBubble.tsx's own
  // "gray"-text contrast fix found light-dark() doesn't track this app's
  // manual scheme toggle, so read the resolved scheme reactively instead.
  const dark = useComputedColorScheme("light") === "dark";
  const style: CSSProperties | undefined =
    color === "gray"
      ? ({ "--button-color": dark ? "var(--mantine-color-gray-1)" : "var(--mantine-color-gray-8)" } as CSSProperties)
      : undefined;
  const button = href ? (
    <Button component="a" href={href} size="xs" variant="light" color={color} style={style}>
      {label}
    </Button>
  ) : (
    <Button size="xs" variant="light" onClick={onClick} color={color} style={style}>
      {label}
    </Button>
  );
  return hint ? (
    <Tooltip label={hint} withArrow>
      {button}
    </Tooltip>
  ) : (
    button
  );
}
