import { Box, Group, Text } from "@mantine/core";
import type { LegendEntry } from "../../charts/personColors";

/** Swatch + label + count for each color a chart is using -- the key for
 * "Color by tag/attribute" (charts/personColors.ts). Text stays in the
 * theme's ink; only the swatch carries the color. */
export function ChartLegend({ entries }: { entries: LegendEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <Group gap="sm" wrap="wrap" style={{ rowGap: 4 }}>
      {entries.map((e, i) => (
        <Group key={`${i}:${e.label}`} gap={4} wrap="nowrap">
          <Box
            w={12}
            h={12}
            style={{ borderRadius: 3, backgroundColor: e.color, flexShrink: 0, border: "1px solid rgba(0, 0, 0, 0.15)" }}
          />
          <Text size="xs">{e.label}</Text>
          {e.count != null && <Text size="xs" c="dimmed">{e.count}</Text>}
        </Group>
      ))}
    </Group>
  );
}
