import { Stack, Text } from "@mantine/core";
import { SectionShell } from "./shared";
import type { SectionProps } from "../types";

interface Address {
  street?: string;
  locality?: string;
  city?: string;
  county?: string;
  state?: string;
  country?: string;
  postal?: string;
  phone?: string;
  private?: boolean;
}

function formatAddress(a: Address): string {
  return [a.street, a.locality, a.city, a.county, a.state, a.postal, a.country].filter(Boolean).join(", ");
}

/** AddressBase.address_list (Person, Repository) -- inline structured data,
 * not a reference to another Gramps object. Not clickable. */
export function AddressesSection({ detail }: SectionProps) {
  const addresses = (detail.address_list as Address[] | undefined) ?? [];
  if (addresses.length === 0) return null;
  return (
    <SectionShell label="Addresses" count={addresses.length}>
      {addresses.map((addr, i) => (
        <Stack key={i} gap={0}>
          <Text size="md">{formatAddress(addr)}{addr.private ? " 🔒" : ""}</Text>
          {addr.phone && <Text size="sm" c="dimmed">Phone: {addr.phone}</Text>}
        </Stack>
      ))}
    </SectionShell>
  );
}
