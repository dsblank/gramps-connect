import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Group, Loader, ScrollArea, Stack, Text, Title, Tooltip, UnstyledButton } from "@mantine/core";
import { getToken } from "../auth/auth";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { fetchObjectExtended, zipRefs } from "../store/objectDetail";
import type { ObjectDetail } from "../store/objectDetail";
import type { ViewConfig } from "../store/views";
import { RELATED_CONFIG } from "./related/config";
import { DetailFields } from "./related/DetailFields";
import { MediaThumbnail } from "./related/MediaThumbnail";
import { NoteText } from "./related/NoteText";
import { SECTION_COMPONENTS } from "./related/sections";
import { summaryLine } from "./related/summary";
import { gtkColorToCss } from "./related/color";
import { GeneratedItemActions } from "./related/GeneratedItemActions";
import { MediaMapButton } from "./related/MediaMapButton";
import { MessageButton } from "./related/MessageButton";
import { EditButton } from "./related/EditButton";
import { DeleteButton } from "./related/DeleteButton";
import { VisualButtons } from "./related/VisualButtons";
import { MessageActions } from "./related/MessageActions";
import { StoryActions } from "./related/StoryActions";
import { isCurrentPage, useCurrentPage } from "./related/CurrentPageContext";
import type { OnNavigate, OnViewGallery } from "./related/types";
import type { UseDraftStack } from "../store/draftStack";
import { t } from "../i18n/i18n";

interface RelatedPanelProps {
  view: ViewConfig;
  handle: string;
  /** Owned by App.tsx, threaded down through AsideSplit/ReferenceDetail --
   * optional because not every mount of this component (e.g. a future one
   * with no edit affordance planned) needs it; EditButton itself renders
   * nothing when it's absent. */
  draftStack?: UseDraftStack;
  /** ViewStore's selectedRevision -- bumped only when a live-sync
   * notification's handle matches this exact `handle`, so the effect
   * below re-fetches when a poll picks up a change to *this* row, not
   * every time any other row in the table gets live-patched (that used
   * to be table-wide `revision`, which fired the loading-flash below for
   * unrelated rows too). */
  revision: number;
  onNavigate: OnNavigate;
  /** Omitted entirely for the bottom pane's own nested RelatedPanel (see
   * AsideSplit) -- MediaSection falls back to a plain count when this
   * isn't provided, since there's no third pane to hand a gallery off to
   * from there. */
  onViewGallery?: OnViewGallery;
  /** True only for the top pane's mounting (see AsideSplit) -- the bottom
   * pane shows a *preview*, not a navigation, so it must never touch
   * document.title (browser history should only ever reflect what's
   * actually in the URL hash, which the bottom pane deliberately doesn't
   * change). */
  updateDocumentTitle?: boolean;
  /** Size to content instead of filling a fixed-height container with a
   * scrollbar of its own. Set by the narrow, stacked layout (App.tsx),
   * where the panes sit in Main's normal flow under the table and the
   * *page* is what scrolls -- nesting a scroller inside a scroller there
   * just hides content behind a second, easily-missed scrollbar. */
  flow?: boolean;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; detail: ObjectDetail };

const SEX_SYMBOL: Record<string, string> = { M: "♂", F: "♀", X: "⚧", U: "" };

/** This *record's own* private flag -- distinct from RefBadges' private
 * indicator, which is about a *reference's* private flag (a ChildRef,
 * EventRef, ...). Every primary object type has one; shown next to the ID
 * line in every PanelHeader branch since it applies uniformly. */
function PrivateIndicator({ detail }: { detail: ObjectDetail }) {
  if (!detail.private) return null;
  return (
    <Tooltip label={t("Marked private")} withArrow>
      <Text component="span" size="sm">🔒</Text>
    </Tooltip>
  );
}

/** Tag.color as an actual swatch (not just the hex text DetailFields would
 * show) -- the same color every TagsSection badge elsewhere already
 * renders with, just bigger, next to the tag's own name when it's the
 * type being viewed rather than referenced from another record. */
function TagSwatch({ color }: { color: string | undefined }) {
  const css = gtkColorToCss(color);
  if (!css) return null;
  return (
    <span
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        borderRadius: "50%",
        background: css,
        border: "1px solid var(--mantine-color-default-border)",
      }}
    />
  );
}

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

  if (view.key === "media" || view.key === "generated") {
    return (
      <div>
        <MediaThumbnail handle={detail.handle} mime={detail.mime as string | undefined} size={240} />
        <div style={{ marginTop: "var(--mantine-spacing-xs)" }}>
          <ClickableTitle onClick={navigateToSelf}>{summaryLine(view.key, detail) || t(view.label)}</ClickableTitle>
        </div>
        <PrivateIndicator detail={detail} />
      </div>
    );
  }

  if (view.key === "story") {
    // A story note's text.string is a JSON-stringified StorySpec
    // (storyBuilder.ts), not free text -- the note/messages branch below
    // would otherwise dump raw JSON here. NoteText's embedded gramps://...
    // link handling doesn't apply (a spec's title and point text are plain
    // text),
    // so ClickableTitle covers the isSelf/navigate distinction on its own
    // without that branch's button-can't-nest-in-button workaround.
    let spec: { title?: string; points?: { text?: string }[] } | null = null;
    try {
      spec = JSON.parse((detail.text as { string?: string } | undefined)?.string ?? "");
    } catch {
      spec = null;
    }
    const intro = spec?.points?.[0]?.text;
    return (
      <div>
        <Text size="sm" c="dimmed" fw={600}>
          {typeof detail.gramps_id === "string" ? `[${detail.gramps_id}] ` : ""}{t(view.label)} <PrivateIndicator detail={detail} />
        </Text>
        <ClickableTitle onClick={navigateToSelf}>{spec?.title || "(story)"}</ClickableTitle>
        {intro && <Text c="dimmed">{intro}</Text>}
      </div>
    );
  }

  if (view.key === "note" || view.key === "messages") {
    const text = (detail.text as { string: string; tags?: { name: string; ranges: [number, number][]; value: string }[] } | undefined) ?? { string: "" };
    return (
      <div>
        <Text size="sm" c="dimmed" fw={600}>
          {typeof detail.gramps_id === "string" ? `[${detail.gramps_id}] ` : ""}{t(view.label)} <PrivateIndicator detail={detail} />
        </Text>
        {isSelf ? (
          <Text fw={700}>{text.string ? <NoteText text={text} onNavigate={onNavigate} /> : "(empty note)"}</Text>
        ) : (
          // A plain div, not component="button" -- NoteText's embedded
          // gramps://... links render as real <button>s (via Anchor), and
          // a <button> can't legally nest inside another <button> (the
          // browser would silently break the DOM/click handling). Their
          // own onClick already stops propagation, so a click that lands
          // on a link fires only that link's onNavigate, not this div's.
          <Text
            component="div"
            role="button"
            tabIndex={0}
            onClick={navigateToSelf}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") navigateToSelf?.(); }}
            style={{ cursor: "pointer" }}
          >
            {text.string ? <NoteText text={text} onNavigate={onNavigate} /> : "(empty note)"}
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
        <Group gap={6} align="center">
          {view.key === "tag" && <TagSwatch color={detail.color as string | undefined} />}
          <ClickableTitle onClick={navigateToSelf}>
            {summaryLine(view.key, detail) || t(view.label)}
            {sex && SEX_SYMBOL[sex] ? ` ${SEX_SYMBOL[sex]}` : ""}
          </ClickableTitle>
        </Group>
        <PrivateIndicator detail={detail} />
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
export function RelatedPanel({
  view, handle, draftStack, revision, onNavigate, onViewGallery, updateDocumentTitle, flow,
}: RelatedPanelProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  // Bumped by MessageActions after a Mark done/Reopen toggle -- that write
  // goes through notesApi.ts directly, not through anything that changes
  // `handle` or waits on `revision` (only bumped by a *live-sync*
  // notification matching this handle, which could be up to
  // POLL_INTERVAL_MS away), so without this, the just-toggled tag stays
  // stale in both this panel's title/button and the Tags section below it.
  const [refetchNonce, setRefetchNonce] = useState(0);

  // EditButton opens a draft into `draftStack` but has no way to tell this
  // panel when the resulting save actually lands -- saveAll() isn't called
  // from here, it's wired at App.tsx's dialog-shell level, covering every
  // open draft at once, not just this handle's. So: catch the
  // saving-true -> saving-false transition instead, and refetch (same as
  // MessageActions' own refetchNonce bump above) whenever it resolves
  // without error. Fires for every panel currently mounted regardless of
  // which handle was actually saved -- an extra fetchObjectExtended for an
  // unrelated record is cheap, and it's the same "just refetch, don't try
  // to be precise" tradeoff getViewStore(type).requeryDebounced() already
  // makes for the list caches.
  const wasSavingRef = useRef(false);
  useEffect(() => {
    if (!draftStack) return;
    if (draftStack.saving) {
      wasSavingRef.current = true;
      return;
    }
    if (wasSavingRef.current) {
      wasSavingRef.current = false;
      if (!draftStack.error) setRefetchNonce((n) => n + 1);
    }
  }, [draftStack, draftStack?.saving, draftStack?.error]);

  useDocumentTitle(
    updateDocumentTitle && state.status === "ready"
      ? `${summaryLine(view.key, state.detail) || t(view.label)} — Gramps Connect`
      : undefined
  );

  // Tracks which (view, handle) the currently-held `state` belongs to, so a
  // same-record refetch (revision/refetchNonce bumped by a live-sync poll
  // tick, or by this very panel's own AttachControl/DeleteButton actions)
  // can be told apart from an actual navigation to a different record.
  // Only the latter should reset to the loading spinner below -- swapping
  // it in for a same-record refresh unmounted the ScrollArea and remounted
  // a fresh one once data landed, snapping the user's scroll position back
  // to the top on every poll tick even though nothing they were looking at
  // had moved.
  const loadedForRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const key = `${view.key}:${handle}`;
    const isNewRecord = loadedForRef.current !== key;
    if (isNewRecord) setState({ status: "loading" });
    (async () => {
      try {
        const token = await getToken();
        const detail = await fetchObjectExtended(token, view, handle);
        if (!cancelled) {
          loadedForRef.current = key;
          setState({ status: "ready", detail });
        }
      } catch (err: any) {
        if (!cancelled) setState({ status: "error", message: err.message ?? String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, handle, revision, refetchNonce]);

  if (state.status === "loading") {
    return (
      <Group p="md">
        <Loader size="sm" />
      </Group>
    );
  }
  if (state.status === "error") {
    return (
      <Alert color="red" m="md" title={`${t("Failed to load")} ${t(view.label)}`}>
        {state.message}
      </Alert>
    );
  }

  const { detail } = state;
  const sections = RELATED_CONFIG[view.key] ?? [];

  const body = (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div style={{ flex: 1, minWidth: 0 }}>
          <PanelHeader view={view} detail={detail} onNavigate={onNavigate} />
        </div>
        {/* The header's action slot: things that act on the record itself
            (edit it, delete it, start a message about it) rather than ways
            of looking at it. Kept as a Group so more can sit beside
            MessageButton without disturbing the title's own layout. */}
        <Group gap="xs" wrap="nowrap" style={{ flex: "none" }}>
          {draftStack && <EditButton view={view} detail={detail} draftStack={draftStack} />}
          <DeleteButton view={view} detail={detail} />
          <MessageButton view={view} detail={detail} onAttached={() => setRefetchNonce((n) => n + 1)} />
        </Group>
      </Group>
      {/* Directly under the title, not up in the header slot above: these
          are ways of *viewing* this record rather than actions on it, and
          they only exist for four of the types -- on their own row and at
          full size they read as an offer, which a compact icon tucked into
          a corner shared with the record's own controls did not. */}
      <VisualButtons view={view} detail={detail} />
      {view.key === "media" && <MediaMapButton detail={detail} />}
      {view.key === "generated" && <GeneratedItemActions detail={detail} />}
      {view.key === "messages" && (
        <MessageActions detail={detail} onToggled={() => setRefetchNonce((n) => n + 1)} />
      )}
      {view.key === "story" && <StoryActions detail={detail} />}
      <DetailFields type={view.key} detail={detail} />
      {sections.map((section) => {
        const Section = SECTION_COMPONENTS[section];
        return (
          <Section
            key={section}
            type={view.key}
            view={view}
            detail={detail}
            onNavigate={onNavigate}
            onViewGallery={onViewGallery}
            onRefetch={() => setRefetchNonce((n) => n + 1)}
          />
        );
      })}
    </Stack>
  );

  return flow ? body : <ScrollArea h="100%" type="auto">{body}</ScrollArea>;
}
