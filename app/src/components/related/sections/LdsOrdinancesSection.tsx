import { Group, Text } from "@mantine/core";
import { SectionShell } from "./shared";
import { displayDate } from "../summary";
import type { SectionProps } from "../types";

// Per gramps/gen/lib/ldsord.py's LdsOrd._TYPE_MAP / _STATUS_MAP -- neither
// is resolved to a label by the API (unlike Event.type/Family.type
// elsewhere), lds_ord_list isn't touched by extend=all at all (confirmed
// live: famc/place stay bare handles), so these are looked up client-side.
const TYPE_LABELS = ["Baptism", "Endowment", "Sealed to Parents", "Sealed to Spouse", "Confirmation", "Initiatory"];
const STATUS_LABELS = [
  "", "Born in Covenant", "Canceled", "Child", "Cleared", "Completed", "Do not seal",
  "Infant", "Pre-1970", "Qualified", "Do not seal/Cancel", "Stillborn", "Submitted", "Uncleared",
];

interface LdsOrd {
  type: number;
  date?: unknown;
  temple?: string;
  status: number;
  private?: boolean;
}

/** LdsOrdBase.lds_ord_list (Person, Family) -- ordinance records specific to
 * the Church of Jesus Christ of Latter-day Saints. `famc`/`place` (which
 * ordinance entries can reference) aren't resolved by extend=all and
 * aren't surfaced here as links -- same scope AttributesSection/
 * AddressesSection already settled for other inline-structured-data
 * sections; not worth a per-entry fetch for how rarely this is populated. */
export function LdsOrdinancesSection({ detail }: SectionProps) {
  const ords = (detail.lds_ord_list as LdsOrd[] | undefined) ?? [];
  if (ords.length === 0) return null;
  return (
    <SectionShell label="LDS Ordinances">
      {ords.map((ord, i) => {
        const parts = [displayDate(ord.date), ord.temple, STATUS_LABELS[ord.status]].filter(Boolean);
        return (
          <Group key={i} gap={6}>
            <Text size="md" fw={500}>{TYPE_LABELS[ord.type] ?? `Type ${ord.type}`}</Text>
            {parts.length > 0 && <Text size="md" c="dimmed">{parts.join(" — ")}</Text>}
            {ord.private && <Text component="span" size="sm">🔒</Text>}
          </Group>
        );
      })}
    </SectionShell>
  );
}
