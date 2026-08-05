// Shared presentational bits for a reference's own metadata (see
// objectDetail.ts's RefMeta) -- reused by every forward-ref/backlink row
// across all 10 object types, and by ReferenceDetail's header, so a
// private flag or a frel/mrel/role/rel badge renders identically no matter
// which section put it there.
import { Badge, Group, Text, Tooltip } from "@mantine/core";
import type { RefMeta } from "../../store/objectDetail";

function PrivateBadge({ refMeta }: { refMeta?: RefMeta }) {
  if (!refMeta?.private) return null;
  return (
    <Tooltip label="Private" withArrow>
      <Text component="span" size="sm" aria-label="Private">🔒</Text>
    </Tooltip>
  );
}

/** ChildRef's frel/mrel, EventRef's role, PersonRef's rel, RepoRef's
 * call_number/media_type -- whichever one this ref type carries. */
function RelationBadge({ refMeta }: { refMeta?: RefMeta }) {
  if (!refMeta) return null;
  const parts: string[] = [];
  if (refMeta.frel || refMeta.mrel) {
    if (refMeta.frel && refMeta.frel === refMeta.mrel) {
      parts.push(refMeta.frel);
    } else {
      if (refMeta.frel) parts.push(`father: ${refMeta.frel}`);
      if (refMeta.mrel) parts.push(`mother: ${refMeta.mrel}`);
    }
  }
  // "Primary" is the common case (the person the event is actually
  // about) -- noisy to badge on every single row, so only unusual roles
  // (Witness, Clergy, ...) are called out.
  if (refMeta.role && refMeta.role !== "Primary") parts.push(refMeta.role);
  if (refMeta.rel) parts.push(refMeta.rel);
  if (refMeta.call_number) parts.push(`call #${refMeta.call_number}`);
  if (parts.length === 0) return null;
  return (
    <Badge size="sm" variant="light" color="gray">
      {parts.join(", ")}
    </Badge>
  );
}

function CitationNoteCounts({ refMeta }: { refMeta?: RefMeta }) {
  const notes = refMeta?.note_list?.length ?? 0;
  const citations = refMeta?.citation_list?.length ?? 0;
  if (notes === 0 && citations === 0) return null;
  const parts: string[] = [];
  if (citations > 0) parts.push(`${citations} citation${citations > 1 ? "s" : ""}`);
  if (notes > 0) parts.push(`${notes} note${notes > 1 ? "s" : ""}`);
  return <Text size="xs" c="dimmed">{parts.join(", ")}</Text>;
}

/** All three badges together, in the order they read best inline after a
 * target's summary line. Renders nothing when `refMeta` is absent (plain
 * handle-list refs, e.g. Person.family_list, carry no per-item metadata at
 * all) or empty. */
export function RefMetaRow({ refMeta }: { refMeta?: RefMeta }) {
  if (!refMeta) return null;
  return (
    <Group gap={6} wrap="wrap">
      <PrivateBadge refMeta={refMeta} />
      <RelationBadge refMeta={refMeta} />
      <CitationNoteCounts refMeta={refMeta} />
    </Group>
  );
}
