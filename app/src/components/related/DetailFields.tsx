import { Group, Stack, Text } from "@mantine/core";
import { DETAIL_FIELDS } from "./detailFieldDefinitions";
import type { ObjectDetail } from "../../store/objectDetail";

/** Renders whichever of DETAIL_FIELDS' flat facts this type has and this
 * particular record actually has a value for -- always visible (not
 * behind a SectionShell toggle) since these are core facts about the
 * record itself, same prominence as its ID, not a list of references to
 * browse. Renders nothing at all if every field is empty. */
export function DetailFields({ type, detail }: { type: string; detail: ObjectDetail }) {
  const fields = DETAIL_FIELDS[type] ?? [];
  const rows = fields.map((f) => ({ label: f.label, value: f.value(detail) })).filter((r) => r.value);
  if (rows.length === 0) return null;
  return (
    <Stack gap={4}>
      {rows.map((r) => (
        <Group key={r.label} gap={6} wrap="nowrap" align="flex-start">
          <Text size="sm" c="dimmed">{r.label}:</Text>
          <Text size="sm">{r.value}</Text>
        </Group>
      ))}
    </Stack>
  );
}
