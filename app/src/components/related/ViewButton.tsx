import { Button, Tooltip } from "@mantine/core";

interface ViewButtonProps {
  label: string;
  /** Tooltip copy -- omitted entirely (no Tooltip wrapper) when absent. */
  hint?: string;
  /** A plain link (VisualButtons' Map/Timeline/Graphs) when set; otherwise
   * an onClick button (RelatedPanel's Topic "View"). */
  href?: string;
  onClick?: () => void;
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
export function ViewButton({ label, hint, href, onClick }: ViewButtonProps) {
  const button = href ? (
    <Button component="a" href={href} size="xs" variant="light">
      {label}
    </Button>
  ) : (
    <Button size="xs" variant="light" onClick={onClick}>
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
