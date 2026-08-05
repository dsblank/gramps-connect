import { Badge, Group } from "@mantine/core";
import { SectionShell, zipHandles } from "./shared";
import type { SectionProps } from "../types";

/** PrimaryObject.tag_list -- a plain handle list. Tags are simple enough
 * (name/color/priority, no sub-detail worth drilling into) that they're
 * rendered as plain colored badges rather than full RefRows; clicking one
 * still navigates like any other reference. */
export function TagsSection({ detail, onNavigate }: SectionProps) {
  const rows = zipHandles<{ handle: string; name: string; color?: string }>(detail.tag_list, detail.extended?.tags);
  if (rows.length === 0) return null;
  return (
    <SectionShell label="Tags" count={rows.length}>
      <Group gap={6}>
        {rows.map(({ handle, target }) => (
          <Badge
            key={handle}
            size="md"
            variant="filled"
            color={target?.color || "gray"}
            style={{ cursor: "pointer" }}
            onClick={() => onNavigate("tag", handle)}
          >
            {target?.name ?? handle}
          </Badge>
        ))}
      </Group>
    </SectionShell>
  );
}
