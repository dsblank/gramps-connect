import { useEffect, useState, type ReactNode } from "react";
import { Alert, Group, Loader, ScrollArea, Stack, Text, Title, UnstyledButton } from "@mantine/core";
import { getToken } from "../auth/auth";
import { fetchObjectExtended, zipRefs } from "../store/objectDetail";
import type { ObjectDetail } from "../store/objectDetail";
import type { ViewConfig } from "../store/views";
import { RELATED_CONFIG } from "./related/config";
import { DetailFields } from "./related/DetailFields";
import { MediaThumbnail } from "./related/MediaThumbnail";
import { SECTION_COMPONENTS } from "./related/sections";
import { summaryLine } from "./related/summary";
import { isCurrentPage, useCurrentPage } from "./related/CurrentPageContext";
import type { OnNavigate, OnViewGallery } from "./related/types";

interface RelatedPanelProps {
  view: ViewConfig;
  handle: string;
  /** Bumped by ViewStore.applyLiveChange on any live-sync update to this
   * view's table -- included so the effect below re-fetches when a poll
   * picks up a change to the selected row, not just when the user selects
   * a different one (same treatment PersonDetail.tsx's `revision` prop
   * already had). */
  revision: number;
  onNavigate: OnNavigate;
  /** Omitted entirely for the bottom pane's own nested RelatedPanel (see
   * AsideSplit) -- MediaSection falls back to a plain count when this
   * isn't provided, since there's no third pane to hand a gallery off to
   * from there. */
  onViewGallery?: OnViewGallery;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; detail: ObjectDetail };

const SEX_SYMBOL: Record<string, string> = { M: "♂", F: "♀", X: "⚧", U: "" };

/** The first *image* (not video/PDF -- those make poor static avatars)
 * among this object's own attached media, if any -- MediaSection already
 * lists every attached photo further down; this is just the first one of
 * them, pulled out for the profile-picture treatment. */
function firstImageRef(detail: ObjectDetail): { handle: string; mime?: string } | null {
  const rows = zipRefs<{ mime?: string }>(detail.media_list, detail.extended?.media);
  const first = rows.find((r) => r.target?.mime?.startsWith("image/"));
  return first ? { handle: first.ref.ref, mime: first.target?.mime } : null;
}

/** A Title that's also a real clickable element -- `component="button"`
 * keeps the Title's own font-size/weight styling (a wrapped Anchor would
 * need to duplicate that by hand) while rendering an actual `<button>`.
 * Renders as plain (non-interactive) bold text when `onClick` is omitted
 * -- the panel showing its own current-page record (see
 * CurrentPageContext): a link back to the record already on screen would
 * be a pointless round trip, same treatment RefRow gives a self-reference
 * inside a section. */
function ClickableTitle({ onClick, children }: { onClick?: () => void; children: ReactNode }) {
  if (!onClick) return <Title order={4}>{children}</Title>;
  return (
    <Title
      order={4}
      component="button"
      onClick={onClick}
      style={{ cursor: "pointer", background: "none", border: "none", padding: 0, textAlign: "left" }}
    >
      {children}
    </Title>
  );
}

/** The header block above a type's sections. Two types need something other
 * than summaryLine's compact one-liner (which every *reference row*
 * correctly uses, but is too lossy for the panel's own title):
 * - Note: summaryLine truncates to 80 chars for use inline in a reference
 *   row: fine when a note is *listed*, but means a selected/promoted note's
 *   own full text was never shown anywhere -- shown here in full instead,
 *   not run through summaryLine at all.
 * - Person: summaryLine only has the name; the old PersonDetail.tsx also
 *   showed a sex symbol (profile.sex, "M"/"F"/"U"/"X" -- see the removed
 *   personProfile.ts's PersonProfile interface) next to it.
 * - Media: a large preview above the title -- the same MediaThumbnail
 *   MediaSection uses inline for a media *reference*, just bigger, since
 *   here the media object itself is what's selected.
 * - Everything else with its own attached media (media_list -- Person,
 *   Family, Event, Place, Source, Citation, Repository): the first photo
 *   as a "profile picture" beside the title, the way a social profile
 *   page's header photo sits next to the person's name -- rounded-square
 *   rather than a circular crop, since not every photo (a scanned
 *   document, a group photo, a landscape-oriented shot) survives being
 *   cropped to a circle. Not a second copy of MediaSection's own list
 *   further down, just a preview of its first entry -- and, like the
 *   title, clickable to preview that photo's own details.
 *
 * The title itself (in every branch) and the profile picture both go
 * through `onNavigate` -- previously the header was the one place in a
 * pane with no way to actually select/promote the record it's showing
 * (every *reference* inside a section was clickable, but not the subject
 * of the section list itself). */
function PanelHeader({ view, detail, onNavigate }: { view: ViewConfig; detail: ObjectDetail; onNavigate: OnNavigate }) {
  const currentPage = useCurrentPage();
  const isSelf = isCurrentPage(currentPage, view.key, detail.handle);
  const navigateToSelf = isSelf ? undefined : () => onNavigate(view.key, detail.handle);

  if (view.key === "media") {
    return (
      <div>
        <MediaThumbnail handle={detail.handle} mime={detail.mime as string | undefined} size={240} />
        <div style={{ marginTop: "var(--mantine-spacing-xs)" }}>
          <ClickableTitle onClick={navigateToSelf}>{summaryLine(view.key, detail) || view.label}</ClickableTitle>
        </div>
        {typeof detail.gramps_id === "string" && (
          <Text size="sm" c="dimmed">ID: {detail.gramps_id}</Text>
        )}
      </div>
    );
  }

  if (view.key === "note") {
    const text = (detail.text as { string?: string } | undefined)?.string ?? "";
    return (
      <div>
        <Text size="sm" c="dimmed" fw={600}>
          {view.label}{typeof detail.gramps_id === "string" ? ` — ${detail.gramps_id}` : ""}
        </Text>
        {isSelf ? (
          <Text fw={700} style={{ whiteSpace: "pre-wrap" }}>{text || "(empty note)"}</Text>
        ) : (
          <Text
            component="button"
            type="button"
            onClick={navigateToSelf}
            style={{ whiteSpace: "pre-wrap", cursor: "pointer", background: "none", border: "none", padding: 0, textAlign: "left", display: "block" }}
          >
            {text || "(empty note)"}
          </Text>
        )}
      </div>
    );
  }

  const sex = view.key === "person" ? (detail.profile as { sex?: string } | undefined)?.sex : undefined;
  const profilePic = firstImageRef(detail);
  return (
    <Group align="center" gap="md" wrap="nowrap">
      {profilePic && (
        <UnstyledButton onClick={() => onNavigate("media", profilePic.handle)}>
          <MediaThumbnail handle={profilePic.handle} mime={profilePic.mime} size={72} radius="md" />
        </UnstyledButton>
      )}
      <div>
        <ClickableTitle onClick={navigateToSelf}>
          {summaryLine(view.key, detail) || view.label}
          {sex && SEX_SYMBOL[sex] ? ` ${SEX_SYMBOL[sex]}` : ""}
        </ClickableTitle>
        {typeof detail.gramps_id === "string" && (
          <Text size="sm" c="dimmed">ID: {detail.gramps_id}</Text>
        )}
      </div>
    </Group>
  );
}

/** The upper-right ("Related") pane's per-type dispatcher -- replaces the
 * old DetailPanel.tsx. Fetches the selected row's full extended detail once
 * and renders whichever sections RELATED_CONFIG lists for this view, in
 * order. Also reused, unmodified, inside ReferenceDetail.tsx for the lower
 * pane (mounted for the sub-selected target instead of the main table's
 * selection) -- the only difference between the two mountings is which
 * onNavigate callback AsideSplit wires in. */
export function RelatedPanel({ view, handle, revision, onNavigate, onViewGallery }: RelatedPanelProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      try {
        const token = await getToken();
        const detail = await fetchObjectExtended(token, view, handle);
        if (!cancelled) setState({ status: "ready", detail });
      } catch (err: any) {
        if (!cancelled) setState({ status: "error", message: err.message ?? String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, handle, revision]);

  if (state.status === "loading") {
    return (
      <Group p="md">
        <Loader size="sm" />
      </Group>
    );
  }
  if (state.status === "error") {
    return (
      <Alert color="red" m="md" title={`Failed to load ${view.label.toLowerCase()}`}>
        {state.message}
      </Alert>
    );
  }

  const { detail } = state;
  const sections = RELATED_CONFIG[view.key] ?? [];

  return (
    <ScrollArea h="100%" type="auto">
      <Stack gap="md" p="md">
        <PanelHeader view={view} detail={detail} onNavigate={onNavigate} />
        <DetailFields type={view.key} detail={detail} />
        {sections.map((section) => {
          const Section = SECTION_COMPONENTS[section];
          return <Section key={section} type={view.key} detail={detail} onNavigate={onNavigate} onViewGallery={onViewGallery} />;
        })}
      </Stack>
    </ScrollArea>
  );
}
