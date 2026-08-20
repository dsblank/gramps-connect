import { useEffect, useMemo, useState } from "react";
import { Badge, Button, CloseButton, Group, NumberInput, Paper, Stack, Text } from "@mantine/core";
import { getToken } from "../../auth/auth";
import { formatHash, type VisualSubject } from "../../hash";
import { pickerResultLabel } from "../RefPickerField";
import { RecordPicker } from "../RecordPicker";
import type { QueryItem } from "../../store/api";
import {
  buildAncestorTree, buildDescendantTree, fetchTreeData, resolveTreeRoot,
  type TreePersonRaw, type TreeRoot,
} from "../../store/treeData";
import { PERSON_VIEW } from "../../store/views";
import { TreeChart } from "./TreeChart";
import { VisualFrame } from "./VisualFrame";

const DEFAULT_ANC = 4;
const DEFAULT_DESC = 2;

/** View > Tree, and the "Tree" button on a Person or Family's own page
 * (RelatedPanel's VisualButtons.tsx). Unlike Map/Timeline this always needs
 * a root to mean anything -- there's no "whole tree" default -- so with no
 * subject it offers a person picker instead, and picking one turns straight
 * into a normal scoped route the same way every other pick-to-navigate flow
 * here works. A family's root is its father, else its mother (see
 * resolveTreeRoot) -- the same person-rooted chart as the Person button,
 * not a couple-centered shape.
 *
 * Clicking a box *selects* it into a PersonCard rather than navigating --
 * the same positional rule Map/Timeline follow (clicking in the plot
 * previews, clicking in the preview commits), and for the same reason: a
 * click is one pixel-precise gesture doing double duty as "tell me about
 * this" for a glance and "take me there" for a commit would make the more
 * common one (skimming the tree) accidentally leave it constantly. */
export function TreeView({ subject }: { subject: VisualSubject | null }) {
  const [nAnc, setNAnc] = useState(DEFAULT_ANC);
  const [nDesc, setNDesc] = useState(DEFAULT_DESC);

  const [root, setRoot] = useState<TreeRoot | null>(null);
  const [rootLoading, setRootLoading] = useState(false);

  const [data, setData] = useState<TreePersonRaw[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept for TreeChart's thumbnail URLs (personThumbnailUrl's `jwt` query
  // param) -- the same token the data fetch below already has to resolve,
  // just not thrown away afterward.
  const [token, setToken] = useState<string | null>(null);

  const [selectedHandle, setSelectedHandle] = useState<string | null>(null);

  useEffect(() => {
    setRoot(null);
    // A new root (a different record's Tree button, or a fresh pick) makes
    // whatever was selected under the old one meaningless -- same guard
    // TimelineView/MapView apply when their own underlying set changes.
    setSelectedHandle(null);
    if (!subject) return;
    let cancelled = false;
    setRootLoading(true);
    resolveTreeRoot(subject)
      .then((r) => {
        if (!cancelled) setRoot(r);
      })
      .catch(() => {
        if (!cancelled) setRoot(null);
      })
      .finally(() => {
        if (!cancelled) setRootLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject?.type, subject?.handle]);

  useEffect(() => {
    if (!root) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const t = await getToken();
      const rows = await fetchTreeData(t, root.grampsId, nAnc, nDesc);
      if (!cancelled) {
        setData(rows);
        setToken(t);
      }
    })()
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [root, nAnc, nDesc]);

  const trees = useMemo(() => {
    if (!data || !root) return null;
    return {
      ancestorTree: buildAncestorTree(data, root.handle, nAnc),
      descendantTree: buildDescendantTree(data, root.handle, nDesc),
    };
  }, [data, root, nAnc, nDesc]);

  // Resolved from `data` (not carried as its own object in state) so a
  // generation-count change that drops the selected person out of the
  // fetched window clears the card for free -- there's no separate person
  // to go stale.
  const selectedPerson = useMemo(
    () => (selectedHandle ? data?.find((p) => p.handle === selectedHandle) ?? null : null),
    [selectedHandle, data],
  );

  function pickRoot(item: QueryItem) {
    window.location.hash = formatHash({ viewKey: "tree", subject: { type: "person", handle: item.handle } });
  }

  function openPerson(handle: string) {
    // Hand off to the People view, the one control that leaves the tree --
    // mirrors TimelineView's EventCard/MapView's PlaceCard onOpen.
    window.location.hash = formatHash({ viewKey: "person", handle });
  }

  // A subject that resolved to nothing: a family with neither parent set, or
  // a handle this cache doesn't have yet (stale link, still syncing).
  const notFound = subject !== null && !rootLoading && root === null;

  return (
    <VisualFrame
      title="Tree"
      scope={
        subject && root ? (
          <Text size="xs" c="dimmed">
            {subject.type === "family" ? `Rooted on ${root.label}` : root.label}
          </Text>
        ) : undefined
      }
      loading={rootLoading || (root !== null && loading)}
      loadingText="Loading the tree…"
      error={error}
      empty={
        !subject ? (
          <Stack align="center" gap="xs" maw={360}>
            <Text size="sm" fw={600}>Open a tree</Text>
            <Text size="xs" c="dimmed" ta="center">
              Pick a person to see their ancestors and descendants.
            </Text>
            <RecordPicker
              view={PERSON_VIEW}
              searchField="gramps_id"
              placeholder={PERSON_VIEW.simpleSearch?.placeholder ?? "Search…"}
              buildExpr={PERSON_VIEW.simpleSearch?.buildExpr}
              renderLabel={(item) => pickerResultLabel(PERSON_VIEW.key, item)}
              onPick={pickRoot}
            />
          </Stack>
        ) : notFound ? (
          <Text size="sm" c="dimmed" ta="center">
            {subject!.type === "family"
              ? "This family has no parents to show a tree from."
              : "This record isn't in the local cache yet -- try again once it finishes syncing."}
          </Text>
        ) : undefined
      }
      toolbar={
        subject && root ? (
          <Group gap="md" wrap="wrap">
            <NumberInput
              label="Ancestor generations"
              size="xs"
              w={170}
              min={0}
              max={15}
              value={nAnc}
              onChange={(v) => setNAnc(typeof v === "number" ? v : Number(v) || 0)}
            />
            <NumberInput
              label="Descendant generations"
              size="xs"
              w={170}
              min={0}
              max={15}
              value={nDesc}
              onChange={(v) => setNDesc(typeof v === "number" ? v : Number(v) || 0)}
            />
          </Group>
        ) : undefined
      }
      status={
        trees ? (
          <Text size="xs" c="dimmed">drag to pan · scroll to zoom · click a person for details</Text>
        ) : undefined
      }
    >
      {trees && (
        <TreeChart
          ancestorTree={trees.ancestorTree}
          descendantTree={trees.descendantTree}
          selectedHandle={selectedHandle}
          onSelectPerson={setSelectedHandle}
          token={token}
        />
      )}
      {selectedPerson && (
        <PersonCard
          person={selectedPerson}
          onOpen={() => openPerson(selectedPerson.handle)}
          onClose={() => setSelectedHandle(null)}
        />
      )}
    </VisualFrame>
  );
}

interface PersonCardProps {
  person: TreePersonRaw;
  onOpen: () => void;
  onClose: () => void;
}

/** The clicked box's details, and the one control that leaves the tree for
 * the People view -- same corner, shape and commit button as
 * TimelineView's EventCard/MapView's PlaceCard, because all three plots now
 * answer a click the same way. Bottom-left, clear of the status strip
 * below and the zoom controls a pointer might reach for at the right. */
function PersonCard({ person, onOpen, onClose }: PersonCardProps) {
  const name = [person.profile?.name_given, person.profile?.name_surname].filter(Boolean).join(" ") || "(unnamed person)";
  return (
    <Paper
      withBorder
      shadow="md"
      p="sm"
      style={{ position: "absolute", left: 12, bottom: 42, width: 280, zIndex: 3 }}
    >
      <Group justify="space-between" wrap="nowrap" gap="xs" mb={4}>
        <Text size="sm" fw={600} lineClamp={2}>{name}</Text>
        <CloseButton size="sm" onClick={onClose} aria-label="Close person details" />
      </Group>
      <Group gap="xs" mb="xs">
        <Badge size="xs" variant="light" color="gray">{person.gramps_id}</Badge>
        {person.profile?.birth?.date && <Badge size="xs" variant="light">*{person.profile.birth.date}</Badge>}
        {person.profile?.death?.date && <Badge size="xs" variant="light">†{person.profile.death.date}</Badge>}
      </Group>
      <Button size="xs" fullWidth onClick={onOpen}>Open in People</Button>
    </Paper>
  );
}
