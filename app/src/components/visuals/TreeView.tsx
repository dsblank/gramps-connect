import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, CloseButton, Group, Paper, Stack, Switch, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { getToken } from "../../auth/auth";
import { formatHash, type VisualSubject } from "../../hash";
import { pickerResultLabel } from "../RefPickerField";
import { RecordPicker } from "../RecordPicker";
import type { QueryItem } from "../../store/api";
import {
  buildAncestorTree, buildDescendantTree, fetchPersonExpansion, fetchTreeData, mergeTreeData, resolveTreeRoot,
  type TreeNode, type TreePersonRaw, type TreeRoot,
} from "../../store/treeData";
import { isManualExpandEnabled, setManualExpandEnabled } from "../../store/treeExpandPreference";
import { PERSON_VIEW } from "../../store/views";
import { TreeChart } from "./TreeChart";
import { VisualFrame } from "./VisualFrame";
import { t } from "../../i18n/i18n";

// Small on purpose: auto-expand-on-reveal (TreeChart.tsx's own
// IntersectionObserver) grows the tree to fill whatever's visible anyway, so
// the *initial* fetch should stay cheap rather than front-loading
// generations nobody's looked at yet.
const BASE_ANC = 3;
const BASE_DESC = 2;

// Manual is the default and currently the only mode a user can reach --
// this just hides the "Manual expand only" toggle itself (store/
// treeExpandPreference.ts already defaults to manual either way) since
// manual is the preferred mode for now. Flip to re-show it.
const SHOW_MANUAL_EXPAND_TOGGLE = false;

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
/** Every node in `tree` whose person is `handle` and that's currently
 * showing children -- whether those children came from base-depth
 * auto-expansion or a manual "+" -- i.e. everywhere "collapse" has
 * something to revert back to a "+". A person can legitimately appear more
 * than once (remarriage, cousin marriage), so this collapses all of them
 * rather than guessing which one the user meant. */
function collectExpandableLabelsForHandle(node: TreeNode, handle: string, acc: string[]) {
  if (node.id && node.person?.handle === handle && node.children && node.children.length > 0) acc.push(node.id);
  node.children?.forEach((child) => collectExpandableLabelsForHandle(child, handle, acc));
}

export function TreeView({ subject }: { subject: VisualSubject | null }) {
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

  // See store/treeExpandPreference.ts -- persisted across sessions, not
  // reset on a new root/subject the way selection/expansion state below is,
  // since it's a standing preference about how this view behaves, not
  // something scoped to what's currently open.
  const [manualExpandOnly, setManualExpandOnly] = useState(isManualExpandEnabled);

  // Per-node lazy-expand state: which branch labels (buildAncestorTree's own
  // "pf"/"pfm"-style ids) have been expanded past BASE_ANC/BASE_DESC, and
  // which `${direction}:${handle}` fetches are in flight (mirrored into
  // state so TreeChart can show a loading marker) versus already resolved
  // (a ref -- guards re-entry/re-fetch only, never needs to trigger a
  // render itself).
  const [expandedAncestor, setExpandedAncestor] = useState<Set<string>>(new Set());
  const [expandedDescendant, setExpandedDescendant] = useState<Set<string>>(new Set());
  // The reverse of the above: labels forced back to a "+" by the
  // "Collapse ancestors"/"Collapse descendants" buttons, overriding even
  // base-depth auto-expansion -- see treeData.ts's ancestorNode/
  // descendantNode. A later re-expand of that exact label (click or
  // auto-reveal) wins over a stale collapse, so these never need to be
  // cleared from here -- only added.
  const [collapsedAncestor, setCollapsedAncestor] = useState<Set<string>>(new Set());
  const [collapsedDescendant, setCollapsedDescendant] = useState<Set<string>>(new Set());
  const [expandingKeys, setExpandingKeys] = useState<Set<string>>(new Set());
  const fetchedExpansionsRef = useRef<Set<string>>(new Set());
  const expandingRef = useRef<Set<string>>(new Set());

  // The handle whose boundary marker was most recently *clicked* (never an
  // auto-expand-on-reveal) -- TreeChart.tsx re-centers the view on it once
  // the resulting rebuild lands, the same "pan to the thing that just
  // became relevant" treatment a fresh selection gets, so the node the user
  // clicked to expand doesn't drift out of view as new boxes appear around
  // it. Left set after that (rather than cleared) is fine: TreeChart.tsx
  // only reacts to it *changing*, same as `selectedHandle`.
  const [expandCenterHandle, setExpandCenterHandle] = useState<string | null>(null);

  useEffect(() => {
    setRoot(null);
    // A new root (a different record's Tree button, or a fresh pick) makes
    // whatever was selected/expanded under the old one meaningless -- same
    // guard TimelineView/MapView apply when their own underlying set
    // changes.
    setSelectedHandle(null);
    setExpandedAncestor(new Set());
    setExpandedDescendant(new Set());
    setCollapsedAncestor(new Set());
    setCollapsedDescendant(new Set());
    setExpandingKeys(new Set());
    setExpandCenterHandle(null);
    fetchedExpansionsRef.current = new Set();
    expandingRef.current = new Set();
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
      const rows = await fetchTreeData(t, root.grampsId, BASE_ANC, BASE_DESC);
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
  }, [root]);

  const trees = useMemo(() => {
    if (!data || !root) return null;
    return {
      ancestorTree: buildAncestorTree(data, root.handle, BASE_ANC, expandedAncestor, collapsedAncestor),
      descendantTree: buildDescendantTree(data, root.handle, BASE_DESC, expandedDescendant, collapsedDescendant),
    };
  }, [data, root, expandedAncestor, expandedDescendant, collapsedAncestor, collapsedDescendant]);

  // The single funnel auto-expand-on-reveal (TreeChart.tsx's own
  // IntersectionObserver) calls through -- there's no click affordance, so
  // this is the only trigger. Guards at most one in-flight/one-ever fetch
  // per `${direction}:${handle}`, regardless of how many branch labels or
  // reveal events reference that same person (pedigree collapse, or a
  // repeat intersection crossing) -- and if another branch already pulled
  // this person's next generation into `data`, marks the label expanded for
  // free with no network round-trip at all.
  const expandNode = useCallback(
    async (label: string, handle: string, direction: "ancestor" | "descendant", source: "click" | "auto") => {
      const key = `${direction}:${handle}`;
      if (!fetchedExpansionsRef.current.has(key)) {
        if (expandingRef.current.has(key)) return;
        expandingRef.current.add(key);
        setExpandingKeys(new Set(expandingRef.current));
        try {
          const person = data?.find((p) => p.handle === handle);
          if (!person) return;
          // Always go through getToken() rather than reusing the `token`
          // state below -- that state is set once from the initial fetch and
          // read here has no idea whether it's since gone stale. getToken()
          // itself already knows (EXPIRY_TOLERANCE_MS) and transparently
          // refreshes, which is exactly what a click well into a long
          // browsing session needs.
          const t = await getToken();
          const rows = await fetchPersonExpansion(t, person.gramps_id, direction);
          setData((prev) => mergeTreeData(prev ?? [], rows));
          setToken(t);
          fetchedExpansionsRef.current.add(key);
        } catch (err) {
          notifications.show({
            color: "red",
            title: "Couldn't load more of the tree",
            message: err instanceof Error ? err.message : String(err),
          });
          return; // leave it un-fetched/un-expanded -- a later reveal retries it
        } finally {
          expandingRef.current.delete(key);
          setExpandingKeys(new Set(expandingRef.current));
        }
      }
      const setExpanded = direction === "ancestor" ? setExpandedAncestor : setExpandedDescendant;
      setExpanded((prev) => (prev.has(label) ? prev : new Set(prev).add(label)));
      // Only a direct click re-centers -- an auto-expand-on-reveal already
      // happened because the user panned that node into view themselves, so
      // yanking the view back to it would fight the very pan that caused it.
      if (source === "click") setExpandCenterHandle(handle);
    },
    [data],
  );

  // Resolved from `data` (not carried as its own object in state) so a new
  // root clearing `data` out from under the selected person clears the card
  // for free -- there's no separate person object to go stale.
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

  // Same navigation pickRoot uses -- re-rooting the tree on the clicked
  // person is a fresh subject, not local state, so it goes through the same
  // hash-driven load as picking from the empty-state search.
  function makeRoot(handle: string) {
    window.location.hash = formatHash({ viewKey: "tree", subject: { type: "person", handle } });
  }

  function collapseDescendants(handle: string) {
    if (!trees) return;
    const labels: string[] = [];
    collectExpandableLabelsForHandle(trees.descendantTree, handle, labels);
    if (labels.length === 0) return;
    // Both sides: drop from `expanded` (it would otherwise override the
    // collapse) and add to `collapsed` (forces the "+" even within base
    // depth) -- see treeData.ts's descendantNode.
    setExpandedDescendant((prev) => {
      const next = new Set(prev);
      labels.forEach((l) => next.delete(l));
      return next;
    });
    setCollapsedDescendant((prev) => {
      const next = new Set(prev);
      labels.forEach((l) => next.add(l));
      return next;
    });
  }

  function collapseAncestors(handle: string) {
    if (!trees) return;
    const labels: string[] = [];
    collectExpandableLabelsForHandle(trees.ancestorTree, handle, labels);
    if (labels.length === 0) return;
    setExpandedAncestor((prev) => {
      const next = new Set(prev);
      labels.forEach((l) => next.delete(l));
      return next;
    });
    setCollapsedAncestor((prev) => {
      const next = new Set(prev);
      labels.forEach((l) => next.add(l));
      return next;
    });
  }

  // Whether the selected person actually has anything to collapse -- greys
  // out the option when this node isn't currently showing any children in
  // that direction (a true leaf, or already collapsed).
  const canCollapseDescendants = useMemo(() => {
    if (!trees || !selectedHandle) return false;
    const labels: string[] = [];
    collectExpandableLabelsForHandle(trees.descendantTree, selectedHandle, labels);
    return labels.length > 0;
  }, [trees, selectedHandle]);
  const canCollapseAncestors = useMemo(() => {
    if (!trees || !selectedHandle) return false;
    const labels: string[] = [];
    collectExpandableLabelsForHandle(trees.ancestorTree, selectedHandle, labels);
    return labels.length > 0;
  }, [trees, selectedHandle]);

  // A subject that resolved to nothing: a family with neither parent set, or
  // a handle this cache doesn't have yet (stale link, still syncing).
  const notFound = subject !== null && !rootLoading && root === null;

  return (
    <VisualFrame
      title={t("Tree")}
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
            <Text size="sm" fw={600}>{t("Open a tree")}</Text>
            <Text size="xs" c="dimmed" ta="center">
              {t("Pick a person to see their ancestors and descendants.")}
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
        subject && root && SHOW_MANUAL_EXPAND_TOGGLE ? (
          <Switch
            size="xs"
            label={t("Manual expand only")}
            checked={manualExpandOnly}
            onChange={(e) => {
              const checked = e.currentTarget.checked;
              setManualExpandOnly(checked);
              setManualExpandEnabled(checked);
            }}
          />
        ) : undefined
      }
      status={
        trees ? (
          <Text size="xs" c="dimmed">
            drag to pan · scroll to zoom · click a person for details ·{" "}
            {manualExpandOnly ? "click + to reveal more" : "pan toward the edges to reveal more, or click +"}
          </Text>
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
          onExpand={expandNode}
          expandingKeys={expandingKeys}
          autoExpandEnabled={!manualExpandOnly}
          expandCenterHandle={expandCenterHandle}
        />
      )}
      {selectedPerson && (
        <PersonCard
          person={selectedPerson}
          onOpen={() => openPerson(selectedPerson.handle)}
          onClose={() => setSelectedHandle(null)}
          onMakeRoot={() => makeRoot(selectedPerson.handle)}
          onCollapseDescendants={() => collapseDescendants(selectedPerson.handle)}
          onCollapseAncestors={() => collapseAncestors(selectedPerson.handle)}
          canMakeRoot={selectedPerson.handle !== root?.handle}
          canCollapseDescendants={canCollapseDescendants}
          canCollapseAncestors={canCollapseAncestors}
        />
      )}
    </VisualFrame>
  );
}

interface PersonCardProps {
  person: TreePersonRaw;
  onOpen: () => void;
  onClose: () => void;
  onMakeRoot: () => void;
  onCollapseDescendants: () => void;
  onCollapseAncestors: () => void;
  canMakeRoot: boolean;
  canCollapseDescendants: boolean;
  canCollapseAncestors: boolean;
}

/** The clicked box's details, and the one control that leaves the tree for
 * the People view -- same corner, shape and commit button as
 * TimelineView's EventCard/MapView's PlaceCard, because all three plots now
 * answer a click the same way. Bottom-left, clear of the status strip
 * below and the zoom controls a pointer might reach for at the right.
 * The three re-shape-this-view actions above "Open in People" are
 * `variant="default"` (this app's secondary-button convention, see
 * DeleteButton.tsx/RefPickerField.tsx) precisely because they don't leave
 * the tree the way that filled button does. */
function PersonCard({
  person, onOpen, onClose, onMakeRoot, onCollapseDescendants, onCollapseAncestors,
  canMakeRoot, canCollapseDescendants, canCollapseAncestors,
}: PersonCardProps) {
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
      <Stack gap={4} mb={4}>
        <Button size="xs" fullWidth variant="default" onClick={onMakeRoot} disabled={!canMakeRoot}>
          {t("Make this person the root")}
        </Button>
        <Button size="xs" fullWidth variant="default" onClick={onCollapseDescendants} disabled={!canCollapseDescendants}>
          {t("Collapse descendants")}
        </Button>
        <Button size="xs" fullWidth variant="default" onClick={onCollapseAncestors} disabled={!canCollapseAncestors}>
          {t("Collapse ancestors")}
        </Button>
      </Stack>
      <Button size="xs" fullWidth onClick={onOpen}>{t("Open in People")}</Button>
    </Paper>
  );
}
