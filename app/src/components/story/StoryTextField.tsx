// A plain Textarea plus Bold/Italic toggle buttons that wrap the current
// selection in `**`/`*` markers -- the lightest possible stand-in for a
// real rich-text editor (no new dependency; this app has no other RTE to
// share one with yet). StoryView.tsx's renderStoryText is the matching
// reader that turns those markers back into <b>/<i> when presenting.
import { useRef } from "react";
import { Button, Group, Stack, Text, Textarea } from "@mantine/core";
import { t } from "../../i18n/i18n";

/** Wraps the textarea's current selection in `marker` (or unwraps it, if
 * the selection is already exactly `marker…marker`) -- with nothing
 * selected, inserts an empty `marker` pair at the cursor and leaves the
 * cursor between them, same as a typical "Bold" toolbar button elsewhere. */
function applyMarker(el: HTMLTextAreaElement, marker: string, value: string, onChange: (v: string) => void) {
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  if (start === end) {
    onChange(value.slice(0, start) + marker + marker + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + marker.length, start + marker.length);
    });
    return;
  }
  const selected = value.slice(start, end);
  const alreadyWrapped = selected.length > marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker);
  const replacement = alreadyWrapped ? selected.slice(marker.length, selected.length - marker.length) : `${marker}${selected}${marker}`;
  onChange(value.slice(0, start) + replacement + value.slice(end));
}

export function StoryTextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  return (
    <Stack gap={4}>
      <Group gap="xs">
        <Text size="sm" fw={500}>{label}</Text>
        <Button variant="default" size="compact-xs" fw={700} onClick={() => ref.current && applyMarker(ref.current, "**", value, onChange)}>
          {t("B")}
        </Button>
        <Button variant="default" size="compact-xs" fs="italic" onClick={() => ref.current && applyMarker(ref.current, "*", value, onChange)}>
          {t("i")}
        </Button>
      </Group>
      <Textarea ref={ref} autosize minRows={2} maxRows={8} value={value} onChange={(e) => onChange(e.currentTarget.value)} />
    </Stack>
  );
}
