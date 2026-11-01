// The pieces every "list of records from the server" page shares --
// View > Search all (SearchView.tsx) and View > Change Log (ChangedView.tsx):
// the All/People/Family/... type tabs, the Google-style result card, and
// the notice for a search index that hasn't been built (both pages read
// /api/search/, so both come up empty without one).
import { useEffect, useState, type ReactNode } from "react";
import { Alert, Badge, Box, Button, Group, Image, Stack, Text, UnstyledButton } from "@mantine/core";
import { getToken, hasPermissions } from "../../auth/auth";
import { API_BASE } from "../../config";
import { formatHash } from "../../hash";
import type { SearchHit } from "../../store/searchApi";
import { formatChange, VIEWS } from "../../store/views";
import { summaryLine } from "../related/summary";
import { MediaThumbnail } from "../related/MediaThumbnail";
import { snippetFor } from "./searchSnippet";
import { t } from "../../i18n/i18n";
import { useDisplayFormatVersion } from "../../store/placeIndex";
import { apiFetch } from "../../store/apiFetch";
import { fetchMetadata } from "../../store/metadataApi";

// The `type` values SearchQueryArgs.type actually accepts (PRIMARY_GRAMPS_
// OBJECTS, lowercased) -- VIEWS also has Output/Messages/Story entries
// that aren't real primary object types and would 422 if sent as `type`,
// so the tab row is built from this list, not straight from VIEWS.
export const SEARCHABLE_TYPES = [
  "person", "family", "event", "place", "repository", "source", "citation", "media", "note", "tag",
] as const;

function iconFor(objectType: string): string | undefined {
  return VIEWS.find((v) => v.key === objectType)?.icon;
}

function labelFor(objectType: string): string {
  return objectType.charAt(0).toUpperCase() + objectType.slice(1);
}

/** All/People/Family/Events/... directly under the search box, Google-
 * results-page style: the active one gets a solid underline, the rest sit
 * in dimmed text. Reuses VIEWS' own nav labels (VIEWS.find, same as
 * iconFor above) rather than labelFor's bare capitalization -- "People"
 * reads better as a tab than "Person" does. */
export function TypeTabs({ active, onSelect }: { active: string | null; onSelect: (type: string | null) => void }) {
  const tabs: { key: string | null; label: string }[] = [
    { key: null, label: "All" },
    ...SEARCHABLE_TYPES.map((key) => ({ key, label: VIEWS.find((v) => v.key === key)!.label })),
  ];
  return (
    <Group gap="lg">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <UnstyledButton
            key={tab.key ?? "all"}
            onClick={() => onSelect(tab.key)}
            pb={4}
            style={{ borderBottom: isActive ? "2px solid var(--mantine-color-text)" : "2px solid transparent" }}
          >
            <Text size="sm" fw={isActive ? 600 : 400} c={isActive ? undefined : "dimmed"}>
              {t(tab.label)}
            </Text>
          </UnstyledButton>
        );
      })}
    </Group>
  );
}

function goToHit(hit: SearchHit) {
  window.location.hash = formatHash({ viewKey: hit.object_type, handle: hit.handle });
}


/** Whether the server's search index has been built for this tree, from
 * /api/metadata/: "missing" when it holds nothing although the tree has
 * records. A server without a task queue never builds it by itself (with
 * one, fetching the metadata starts the build), and then every search
 * finds nothing with no hint why. */
export type IndexState = "unknown" | "ok" | "missing" | "building";

export async function checkIndex(): Promise<IndexState> {
  const metadata = await fetchMetadata(await getToken());
  const indexed = metadata.search?.sifts?.count;
  const records = Object.values(metadata.object_counts ?? {}).reduce((sum, n) => sum + (n || 0), 0);
  if (typeof indexed !== "number" || indexed > 0 || records === 0) return "ok";
  return metadata.search?.building ? "building" : "missing";
}

/** Shown in place of the results while the index is empty: owners and
 * admins (TriggerReindex) get a button to build it right here, everyone
 * else is told who can. */
export function IndexNotice({ state, onBuild }: { state: IndexState; onBuild: () => void }) {
  if (state === "building") {
    return (
      <Alert color="blue" title={t("The search index is being built")} maw={520}>
        {t("Searches will find records once it's done. Try again in a few minutes.")}
      </Alert>
    );
  }
  const canBuild = hasPermissions("TriggerReindex");
  return (
    <Alert color="yellow" title={t("This tree's search index hasn't been built")} maw={520}>
      <Stack gap="sm" align="flex-start">
        <Text size="sm">
          {canBuild
            ? t("Until it is, searches here find nothing. Building it can take a few minutes on a large tree.")
            : t("Until it is, searches here find nothing. Ask the tree's owner to build it from Tools > Rebuild Search Index.")}
        </Text>
        {canBuild && <Button size="xs" onClick={onBuild}>{t("Build search index")}</Button>}
      </Stack>
    </Alert>
  );
}


// Raw object types that carry their own media_list (confirmed live off
// /api/search/ payloads: person/family/event/place/source/citation all
// have the field, sometimes empty; repository/note/tag never do, and
// media obviously doesn't need one -- it *is* the media). Only these are
// worth the extra per-hit lookup RecordThumbnail below makes.
const MEDIA_LIST_TYPES = new Set(["person", "family", "event", "place", "source", "citation"]);

function firstMediaHandle(obj: Record<string, unknown>): string | undefined {
  const list = obj.media_list as { ref?: string }[] | undefined;
  return Array.isArray(list) ? list.find((r) => r?.ref)?.ref : undefined;
}

/** A search card's thumbnail. A Media hit already knows its own mime
 * straight off the raw object -- no extra request. Every other type that
 * carries a media_list (see MEDIA_LIST_TYPES) gets exactly one small extra
 * lookup, GET /api/media/<handle> for metadata only (no file bytes), to
 * learn the referenced Media's mime -- MediaThumbnail.tsx needs it before
 * it will even attempt the actual thumbnail image. Bounded to at most
 * RESULTS_LIMIT of these per search: the "spend some hits on media" this
 * page's own brief asked for, not an unbounded fan-out. Renders nothing
 * while that lookup is in flight, has nothing to show, or fails -- same
 * "just don't show a thumbnail" fallback MediaThumbnail itself already
 * uses for a non-thumbnailable/missing file. */
function RecordThumbnail({ hit }: { hit: SearchHit }) {
  const [resolved, setResolved] = useState<{ handle: string; mime?: string } | null>(
    hit.object_type === "media" ? { handle: hit.handle, mime: hit.object.mime as string | undefined } : null
  );

  useEffect(() => {
    if (hit.object_type === "media" || !MEDIA_LIST_TYPES.has(hit.object_type)) return;
    const mediaHandle = firstMediaHandle(hit.object);
    if (!mediaHandle) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await apiFetch(`${API_BASE}/api/media/${encodeURIComponent(mediaHandle)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const media = await res.json();
        if (!cancelled) setResolved({ handle: mediaHandle, mime: media.mime });
      } catch {
        // No thumbnail on this card -- not worth surfacing as an error.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hit.object_type, hit.handle, hit.object]);

  if (!resolved) return null;
  return <MediaThumbnail handle={resolved.handle} mime={resolved.mime} size={72} />;
}

/** One "detailed section" -- a type icon/label line (the closest thing
 * this data has to Google's site-name/breadcrumb line), a bold clickable
 * title (summaryLine(), already generic across all ten types), and
 * whatever detail snippetFor() can say about it. RecordThumbnail above
 * covers the picture -- a Media hit's own file, or the first photo
 * attached to a person/family/event/place/source/citation. */
export function ObjectResultCard({ hit, extra, aside }: {
  hit: SearchHit;
  /** Extra lines under the snippet. */
  extra?: ReactNode;
  /** Columns to the right of the card (View > Change Log's When/Who/What),
   * which wrap underneath it on a narrow window. Replaces the card's own
   * "Last changed" line, which they'd repeat. */
  aside?: ReactNode;
}) {
  // The snippet's dates/places follow the display settings.
  useDisplayFormatVersion();
  const icon = iconFor(hit.object_type);
  const snippet = snippetFor(hit.object_type, hit.object);
  const tagColor = hit.object_type === "tag" ? (hit.object.color as string | undefined) : undefined;
  const changed = aside ? "" : formatChange(hit.object.change);
  const card = (
    <Group align="flex-start" gap="md" wrap="nowrap" style={aside ? { flex: "1 1 360px", minWidth: 0 } : undefined}>
      <RecordThumbnail hit={hit} />
      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Group gap={6}>
          {icon && <Image src={icon} alt="" w={16} h={16} />}
          <Badge size="xs" variant="light" color="gray">{t(labelFor(hit.object_type))}</Badge>
          {/* A tag's own color is its most identifying feature -- shown as
              a small swatch next to the type badge rather than described
              in words. */}
          {tagColor && (
            <Box w={12} h={12} style={{ borderRadius: 3, backgroundColor: tagColor, flexShrink: 0 }} />
          )}
        </Group>
        <UnstyledButton onClick={() => goToHit(hit)}>
          <Text size="lg" fw={500} c="var(--mantine-color-blue-6)" style={{ wordBreak: "break-word" }}>
            {summaryLine(hit.object_type, hit.object)}
          </Text>
        </UnstyledButton>
        {snippet.map((line, i) => (
          <Text key={i} size="sm" c="dimmed">{line}</Text>
        ))}
        {changed && (
          <Text size="xs" c="dimmed" mt={2}>{t("Last changed")} {changed}</Text>
        )}
        {extra}
      </Stack>
    </Group>
  );
  if (!aside) return card;
  return (
    <Group align="flex-start" gap="xl" wrap="wrap">
      {card}
      {aside}
    </Group>
  );
}

