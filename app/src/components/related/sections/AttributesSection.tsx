import { Group, Text } from "@mantine/core";
import { SectionShell } from "./shared";
import type { SectionProps } from "../types";

interface Attribute {
  type: string;
  value: string;
  private?: boolean;
}

/** AttributeBase.attribute_list -- inline key/value data (Attribute isn't a
 * reference to another Gramps object, so extend=all doesn't -- and
 * shouldn't -- resolve it; there's nothing to resolve). Not clickable. */
export function AttributesSection({ detail }: SectionProps) {
  const attrs = (detail.attribute_list as Attribute[] | undefined) ?? [];
  if (attrs.length === 0) return null;
  return (
    <SectionShell label="Attributes" count={attrs.length}>
      {attrs.map((attr, i) => (
        <Group key={i} gap={6}>
          <Text size="md" fw={500}>{attr.type}:</Text>
          <Text size="md">{attr.value}</Text>
          {attr.private && <Text component="span" size="sm">🔒</Text>}
        </Group>
      ))}
    </SectionShell>
  );
}
