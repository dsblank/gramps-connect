// Shared presentational bits for a reference's own metadata (see
// objectDetail.ts's RefMeta) -- reused by every forward-ref/backlink row
// across all 10 object types, and by ReferenceDetail's header, so a
// private flag or a frel/mrel/role/rel badge renders identically no matter
// which section put it there.
import { Badge, Group, Text, Tooltip } from "@mantine/core";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import type { RefMeta } from "../../store/objectDetail";
import { isEmptyDate } from "../../store/placeDisplay";
import { displayDate } from "./summary";
import { t } from "../../i18n/i18n";

function PrivateBadge({ refMeta }: { refMeta?: RefMeta }) {
  if (!refMeta?.private) return null;
  return (
    <Tooltip label={t("Private")} withArrow>
      <Text component="span" size="sm" aria-label={t("Private")}>🔒</Text>
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
  if (refMeta.date && !isEmptyDate(refMeta.date as GrampsDate)) {
    const text = displayDate(refMeta.date);
    if (text) parts.push(text);
  }
  if (parts.length === 0) return null;
  return (
    <Badge size="sm" variant="light" color="gray">
      {parts.join(", ")}
    </Badge>
  );
}

function lengthOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/** `countTarget`: the referenced record itself, when its own citations and
 * notes belong in the count too -- an event's sources are almost always on
 * the Event, not on the person's link to it. */
function CitationNoteCounts({ refMeta, countTarget }: { refMeta?: RefMeta; countTarget?: unknown }) {
  const target = countTarget as { note_list?: unknown; citation_list?: unknown } | null | undefined;
  const notes = lengthOf(refMeta?.note_list) + lengthOf(target?.note_list);
  const citations = lengthOf(refMeta?.citation_list) + lengthOf(target?.citation_list);
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
export function RefMetaRow({ refMeta, countTarget }: { refMeta?: RefMeta; countTarget?: unknown }) {
  if (!refMeta) return null;
  return (
    <Group gap={6} wrap="wrap">
      <PrivateBadge refMeta={refMeta} />
      <RelationBadge refMeta={refMeta} />
      <CitationNoteCounts refMeta={refMeta} countTarget={countTarget} />
    </Group>
  );
}
