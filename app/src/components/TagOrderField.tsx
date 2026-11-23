// "Order priority" in the Tag editor: every tag in priority order, with
// the one being edited highlighted and draggable, rather than a bare
// number. Dropping it records the position on the draft (priority +
// TAG_MOVED_KEY); store/tagOrder.ts turns that into the renumbering when
// the draft is saved. Each row still shows its number -- and, once moved,
// what it was -- so the stored value stays visible.
import { useEffect, useState } from "react";
import { Alert, Box, Group, Input, Loader, ScrollArea, Text } from "@mantine/core";
import { getToken } from "../auth/auth";
import { canChangeData } from "../pyodidePoc/grampletCommit";
import { fetchTagRecords, planTagOrder, TAG_MOVED_KEY, type TagRecord } from "../store/tagOrder";
import type { DraftEntry } from "../store/draftStack";
import { gtkColorToCss } from "./related/color";
import { SortableList } from "./SortableList";
import { t } from "../i18n/i18n";

interface TagOrderFieldProps {
  draft: DraftEntry;
  label: string;
  onChange: (patch: Record<string, unknown>) => void;
}

export function TagOrderField({ draft, label, onChange }: TagOrderFieldProps) {
  const [tags, setTags] = useState<TagRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fresh list for each edit session (draft.session), since other people
  // may have added or reordered tags since this dialog was last open.
  useEffect(() => {
    let cancelled = false;
    setTags(null);
    setError(null);
    (async () => {
      try {
        const records = await fetchTagRecords(await getToken());
        if (!cancelled) setTags(records);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draft.session]);

  const help = t("Drag this tag up or down. When a record has several tags, the one higher in the list wins, for example for its color in charts.");

  if (error) {
    return (
      <Input.Wrapper label={label}>
        <Alert color="red">{error}</Alert>
      </Input.Wrapper>
    );
  }
  if (!tags) {
    return (
      <Input.Wrapper label={label}>
        <Group><Loader size="xs" /></Group>
      </Input.Wrapper>
    );
  }

  const self: TagRecord = { ...draft.data, handle: draft.handle };
  const original = draft.mode === "edit" ? (draft.originalData as TagRecord | undefined) : undefined;
  const plan = planTagOrder(tags, self, original);
  const colorByHandle = new Map(tags.map((tag) => [tag.handle, tag.color]));
  const canMove = canChangeData();

  function move(from: number, to: number) {
    // Only the edited tag has a grip, so `from` is always plan.selfIndex.
    if (from !== plan.selfIndex) return;
    onChange({ priority: to, [TAG_MOVED_KEY]: true });
  }

  return (
    <Input.Wrapper
      label={label}
      description={canMove ? help : t("Only editors can change the order of tags.")}
    >
      <ScrollArea.Autosize mah={260} type="auto" mt={6}>
        <SortableList
          keys={plan.rows.map((r) => r.handle)}
          onMove={move}
          disabled={!canMove}
          gap={2}
          renderItem={(index, grip) => {
            const row = plan.rows[index];
            const isSelf = index === plan.selfIndex;
            const color = gtkColorToCss(
              (isSelf ? draft.data.color : colorByHandle.get(row.handle)) as string | undefined
            );
            const renumbered = row.oldPriority !== undefined && row.oldPriority !== row.newPriority;
            return (
              <Group
                gap="xs"
                wrap="nowrap"
                px={6}
                py={3}
                style={{
                  borderRadius: 6,
                  background: isSelf ? "var(--mantine-primary-color-light)" : undefined,
                }}
              >
                {/* Only the tag being edited moves; others keep the grip's room. */}
                {isSelf && grip ? grip : <Box w={14} style={{ flexShrink: 0 }} />}
                <Box
                  w={12}
                  h={12}
                  style={{
                    flexShrink: 0,
                    borderRadius: 3,
                    background: color ?? "transparent",
                    border: "1px solid var(--mantine-color-default-border)",
                  }}
                />
                <Text size="sm" fw={isSelf ? 600 : undefined} truncate style={{ flex: 1, minWidth: 0 }}>
                  {row.name || (isSelf ? t("(this tag)") : "")}
                </Text>
                <Text size="xs" c="dimmed" style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                  {renumbered ? `${row.oldPriority} → ${row.newPriority}` : row.newPriority}
                </Text>
              </Group>
            );
          }}
        />
      </ScrollArea.Autosize>
    </Input.Wrapper>
  );
}
