import { useEffect, useState } from "react";
import { Alert, Group, Loader, ScrollArea, Stack, Text, Title } from "@mantine/core";
import { getToken } from "../auth/auth";
import { fetchObjectExtended } from "../store/objectDetail";
import type { ObjectDetail } from "../store/objectDetail";
import type { ViewConfig } from "../store/views";
import { RELATED_CONFIG } from "./related/config";
import { DetailFields } from "./related/DetailFields";
import { SECTION_COMPONENTS } from "./related/sections";
import { summaryLine } from "./related/summary";
import type { OnNavigate } from "./related/types";

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
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; detail: ObjectDetail };

const SEX_SYMBOL: Record<string, string> = { M: "♂", F: "♀", X: "⚧", U: "" };

/** The header block above a type's sections. Two types need something other
 * than summaryLine's compact one-liner (which every *reference row*
 * correctly uses, but is too lossy for the panel's own title):
 * - Note: summaryLine truncates to 80 chars for use inline in a reference
 *   row: fine when a note is *listed*, but means a selected/promoted note's
 *   own full text was never shown anywhere -- shown here in full instead,
 *   not run through summaryLine at all.
 * - Person: summaryLine only has the name; the old PersonDetail.tsx also
 *   showed a sex symbol (profile.sex, "M"/"F"/"U"/"X" -- see the removed
 *   personProfile.ts's PersonProfile interface) next to it. */
function PanelHeader({ view, detail }: { view: ViewConfig; detail: ObjectDetail }) {
  if (view.key === "note") {
    const text = (detail.text as { string?: string } | undefined)?.string ?? "";
    return (
      <div>
        <Text size="sm" c="dimmed" fw={600}>
          {view.label}{typeof detail.gramps_id === "string" ? ` — ${detail.gramps_id}` : ""}
        </Text>
        <Text style={{ whiteSpace: "pre-wrap" }}>{text || "(empty note)"}</Text>
      </div>
    );
  }

  const sex = view.key === "person" ? (detail.profile as { sex?: string } | undefined)?.sex : undefined;
  return (
    <div>
      <Title order={4}>
        {summaryLine(view.key, detail) || view.label}
        {sex && SEX_SYMBOL[sex] ? ` ${SEX_SYMBOL[sex]}` : ""}
      </Title>
      {typeof detail.gramps_id === "string" && (
        <Text size="sm" c="dimmed">ID: {detail.gramps_id}</Text>
      )}
    </div>
  );
}

/** The upper-right ("Related") pane's per-type dispatcher -- replaces the
 * old DetailPanel.tsx. Fetches the selected row's full extended detail once
 * and renders whichever sections RELATED_CONFIG lists for this view, in
 * order. Also reused, unmodified, inside ReferenceDetail.tsx for the lower
 * pane (mounted for the sub-selected target instead of the main table's
 * selection) -- the only difference between the two mountings is which
 * onNavigate callback AsideSplit wires in. */
export function RelatedPanel({ view, handle, revision, onNavigate }: RelatedPanelProps) {
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
        <PanelHeader view={view} detail={detail} />
        <DetailFields type={view.key} detail={detail} />
        {sections.map((section) => {
          const Section = SECTION_COMPONENTS[section];
          return <Section key={section} type={view.key} detail={detail} onNavigate={onNavigate} />;
        })}
      </Stack>
    </ScrollArea>
  );
}
