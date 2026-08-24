import { ActionIcon, Text, Tooltip } from "@mantine/core";
import { t } from "../i18n/i18n";

interface InfoButtonProps {
  /** Both the hover tooltip and the aria-label -- e.g. "How to search
   * Places", "How to use this editor". Callers should make it specific to
   * what it opens, not a bare "Help". */
  label: string;
  onClick: () => void;
  size?: "xs" | "sm" | "md";
}

/** The small circled-"i" trigger for a help popup -- pulled out of
 * FilterBar.tsx (its own search-help button) so every "here's how this
 * screen works" affordance in the app looks and behaves the same way
 * instead of each screen inventing its own info glyph. Deliberately just
 * the trigger, not a bundled Modal: a caller's help content can be a
 * plain static Modal (MapItemEditorDialog.tsx's keyboard-shortcut help) or
 * something more structured (FilterBar's own per-view search syntax
 * reference, SearchHelpDialog.tsx) -- this button doesn't need an opinion
 * on that, it just needs to look and read the same everywhere. */
export function InfoButton({ label, onClick, size = "sm" }: InfoButtonProps) {
  return (
    <Tooltip label={label} withArrow>
      <ActionIcon variant="default" radius="xl" size={size} aria-label={label} onClick={onClick}>
        <Text component="span" size="xs" fw={700} ff="serif" fs="italic">{t("i")}</Text>
      </ActionIcon>
    </Tooltip>
  );
}
