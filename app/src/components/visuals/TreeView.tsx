import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Checkbox, CloseButton, Group, Paper, SegmentedControl, Stack, Switch, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { getToken } from "../../auth/auth";
import { formatHash, type VisualSubject } from "../../hash";
import { pickerResultLabel } from "../RefPickerField";
import { RecordPicker } from "../RecordPicker";
import type { QueryItem } from "../../store/api";
import {
  buildAncestorTree, buildDescendantTree, fetchBatchAncestorExpansion, fetchPersonExpansion, fetchTreeData,
  mergeTreeData, resolveTreeRoot,
  type TreeNode, type TreePersonRaw, type TreeRoot,
} from "../../store/treeData";
import { isManualExpandEnabled, setManualExpandEnabled } from "../../store/treeExpandPreference";
import { PERSON_VIEW } from "../../store/views";
import { FanChart } from "./FanChart";
import type { FanColorScheme } from "../../charts/fanChart";
import { TreeChart } from "./TreeChart";
import { VisualFrame } from "./VisualFrame";
import { t } from "../../i18n/i18n";

// Small on purpose: auto-expand-on-reveal (TreeChart.tsx's own
// IntersectionObserver) grows the tree to fill whatever's visible anyway, so
// the *initial* fetch should stay cheap rather than front-loading
// generations nobody's looked at yet.
const BASE_ANC = 3;
const BASE_DESC = 2;
// Fan mode's own initial depth -- deliberately its own constant rather than
// reusing BASE_ANC: it has no auto-expand-on-reveal to lean on (there's no
// IntersectionObserver for a fan's curved wedges) and no incremental
// per-node cost the way a box tree's dozens of boxes-with-thumbnails does,
// so it can afford to open deeper up front. "+ Increase depth" (below) is
// still there for whatever a tree runs past this.
const FAN_BASE_ANC = 6;

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

/** Every node across the whole tree with real further ancestors not yet
 * fetched (TreeNode.hasMore) -- fan mode's own "Increase depth" button
 * fires an expand for all of these at once, rather than a marker per
 * branch. A person can appear more than once (pedigree collapse), so this
 * doesn't dedupe by handle -- each occurrence is its own branch label and
 * needs its own `expandedAncestor` entry to stay expanded. */
function collectBoundaryNodes(node: TreeNode, acc: { label: string; handle: string }[]) {
  if (node.hasMore && node.id && node.person) acc.push({ label: node.id, handle: node.person.handle });
  node.children?.forEach((child) => collectBoundaryNodes(child, acc));
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

  // Which chart style is showing -- deliberately *not* reset by the
  // subject-change effect below (unlike selection/expansion state), so
  // re-rooting (Make root, or picking a new person) stays in whichever
  // style the user was already looking at.
  const [chartStyle, setChartStyle] = useState<"box" | "fan">("box");
  // Fan mode's own "Show lifespan" toggle -- wedge radial thickness
  // becomes death year minus birth year (fanChart.ts's own
  // lifespanThickness) instead of a fixed per-generation width.
  const [sizeByLifespan, setSizeByLifespan] = useState(false);
  // Fan mode's own wedge-color scheme -- "Age at death" is the only other
  // one wired up so far (fanChart.ts's own doc comment on why: harrywind.nl
  // has several more, but generation/age-at-death are the two computable
  // from data this app already fetches with no further plumbing).
  const [colorScheme, setColorScheme] = useState<FanColorScheme>("gen");

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
    // Fan mode's own baseline fetch is ancestor-only, and deeper than box
    // mode's own default (FAN_BASE_ANC, see its own doc comment) -- further
    // generations still come from "+ Increase depth" (TreeView's own
    // increaseFanDepth), the same per-node lazy-expand box mode already has,
    // just fired for every boundary node at once. Merged into `data` rather
    // than replacing it (mergeTreeData, same as expandNode's own merge
    // below): switching chart style must never discard rows an earlier
    // expand click already fetched, since box and fan mode share one
    // `expandedAncestor` label set (see fanTree's own doc comment) and a
    // label marked expanded has to keep finding the person it points at
    // regardless of which style asks.
    const nAnc = chartStyle === "fan" ? FAN_BASE_ANC : BASE_ANC;
    const nDesc = chartStyle === "fan" ? 0 : BASE_DESC;
    (async () => {
      const t = await getToken();
      const rows = await fetchTreeData(t, root.grampsId, nAnc, nDesc);
      if (!cancelled) {
        setData((prev) => mergeTreeData(prev ?? [], rows));
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
  }, [root, chartStyle]);

  const trees = useMemo(() => {
    if (!data || !root || chartStyle !== "box") return null;
    return {
      ancestorTree: buildAncestorTree(data, root.handle, BASE_ANC, expandedAncestor, collapsedAncestor),
      descendantTree: buildDescendantTree(data, root.handle, BASE_DESC, expandedDescendant, collapsedDescendant),
    };
  }, [data, root, chartStyle, expandedAncestor, expandedDescendant, collapsedAncestor, collapsedDescendant]);

  // Fan mode's own tree: ancestors only, `includeEmpty` true so an
  // unresearched branch still draws a placeholder wedge instead of a gap --
  // the case treeData.ts's own doc comment on that param anticipated a Fan
  // Chart needing (charts/fanChart.ts's collectWedges carries that past
  // what this one level reserves). Shares `expandedAncestor`/
  // `collapsedAncestor` with box mode's own ancestorTree above rather than
  // keeping a separate set: a label means "this branch has been researched
  // past its default depth" regardless of which chart style asked for it,
  // and since the fetch effect above merges rather than replaces `data`,
  // whatever a label's expansion needs is there no matter which style
  // fetched it first.
  const fanTree = useMemo(() => {
    if (!data || !root || chartStyle !== "fan") return null;
    return buildAncestorTree(data, root.handle, FAN_BASE_ANC, expandedAncestor, collapsedAncestor, true);
  }, [data, root, chartStyle, expandedAncestor, collapsedAncestor]);

  // Every currently-loaded fan-mode node with real further ancestors not
  // yet fetched -- what "Increase depth" (below, in the status bar) expands
  // all at once, rather than a marker per branch.
  const fanBoundaryNodes = useMemo(() => {
    if (!fanTree) return [];
    const acc: { label: string; handle: string }[] = [];
    collectBoundaryNodes(fanTree, acc);
    return acc;
  }, [fanTree]);

  // The single funnel every expand trigger calls through: a marker click
  // (TreeChart.tsx's box), "Increase depth" below firing one call per
  // fanBoundaryNodes entry (fan mode has no per-wedge marker), and, box
  // mode only, TreeChart.tsx's own auto-expand-on-reveal
  // IntersectionObserver (`source: "auto"`). Guards at most one in-flight/
  // one-ever fetch per `${direction}:${handle}`, regardless of how many
  // branch labels or reveal events reference that same person (pedigree
  // collapse, or a repeat intersection crossing) -- and if another branch
  // (or the other chart style) already pulled this person's next generation
  // into `data`, marks the label expanded for free with no network
  // round-trip at all.
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

  // "Increase depth": grows every currently-loaded fan-mode boundary node at
  // once (fanBoundaryNodes above) in a *single* request
  // (fetchBatchAncestorExpansion), rather than expandNode's usual one
  // fetchPersonExpansion per node -- box mode's per-node "+" click only
  // ever expands one boundary at a time, but a fan's "Increase depth" can
  // easily be growing dozens at once, and firing that many individual GETs
  // serialized behind the browser's own per-origin connection cap was the
  // whole reason this felt slow. Reuses expandNode's own
  // fetchedExpansionsRef/expandingRef bookkeeping so the two mechanisms
  // never redundantly re-fetch the same person.
  async function increaseFanDepth() {
    const targets = fanBoundaryNodes.filter(({ handle }) => !fetchedExpansionsRef.current.has(`ancestor:${handle}`));
    if (targets.length === 0) return;
    const keys = targets.map(({ handle }) => `ancestor:${handle}`);
    keys.forEach((key) => expandingRef.current.add(key));
    setExpandingKeys(new Set(expandingRef.current));
    try {
      const grampsIds = targets
        .map(({ handle }) => data?.find((p) => p.handle === handle)?.gramps_id)
        .filter((id): id is string => !!id);
      const t = await getToken();
      const rows = await fetchBatchAncestorExpansion(t, grampsIds);
      setData((prev) => mergeTreeData(prev ?? [], rows));
      setToken(t);
      keys.forEach((key) => fetchedExpansionsRef.current.add(key));
    } catch (err) {
      notifications.show({
        color: "red",
        title: "Couldn't load more of the tree",
        message: err instanceof Error ? err.message : String(err),
      });
      return; // leave it un-fetched/un-expanded -- a later click retries it
    } finally {
      keys.forEach((key) => expandingRef.current.delete(key));
      setExpandingKeys(new Set(expandingRef.current));
    }
    setExpandedAncestor((prev) => {
      const next = new Set(prev);
      targets.forEach(({ label }) => next.add(label));
      return next;
    });
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
      title={t("Graphs")}
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
        subject && root ? (
          <Group gap="sm" wrap="nowrap">
            <SegmentedControl
              size="xs"
              value={chartStyle}
              onChange={(v) => setChartStyle(v as "box" | "fan")}
              data={[
                { value: "box", label: t("Tree") },
                { value: "fan", label: t("Fan") },
              ]}
            />
            {chartStyle === "box" && SHOW_MANUAL_EXPAND_TOGGLE && (
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
            )}
          </Group>
        ) : undefined
      }
      status={
        chartStyle === "fan" ? (
          fanTree ? (
            // A `Group` rather than a bare `Text` -- unlike box mode's own
            // status line, this one already holds a real control, and more
            // are coming (a "we'll have more controls soon" ask), so this
            // is meant to keep growing rather than staying single-purpose.
            <Group justify="space-between" wrap="wrap" gap="xs">
              <Text size="xs" c="dimmed">
                drag to pan · scroll to zoom · click a wedge for details
              </Text>
              <Group gap="sm" wrap="nowrap">
                <Text size="xs" c="dimmed">{t("Color:")}</Text>
                <SegmentedControl
                  size="xs"
                  value={colorScheme}
                  onChange={(v) => setColorScheme(v as FanColorScheme)}
                  data={[
                    { value: "gen", label: t("Generation") },
                    { value: "death", label: t("Age at death") },
                  ]}
                />
                <Checkbox
                  size="xs"
                  label={t("Show lifespan")}
                  checked={sizeByLifespan}
                  onChange={(e) => setSizeByLifespan(e.currentTarget.checked)}
                />
                <Button
                  size="xs"
                  variant="default"
                  onClick={increaseFanDepth}
                  disabled={fanBoundaryNodes.length === 0}
                  loading={fanBoundaryNodes.some(({ handle }) => expandingKeys.has(`ancestor:${handle}`))}
                >
                  {t("+ Increase depth")}
                </Button>
              </Group>
            </Group>
          ) : undefined
        ) : trees ? (
          <Text size="xs" c="dimmed">
            drag to pan · scroll to zoom · click a person for details ·{" "}
            {manualExpandOnly ? "click + to reveal more" : "pan toward the edges to reveal more, or click +"}
          </Text>
        ) : undefined
      }
    >
      {chartStyle === "fan" && fanTree && (
        <FanChart
          ancestorTree={fanTree}
          selectedHandle={selectedHandle}
          onSelectPerson={setSelectedHandle}
          sizeByLifespan={sizeByLifespan}
          colorScheme={colorScheme}
        />
      )}
      {chartStyle === "box" && trees && (
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
          showCollapseControls={chartStyle === "box"}
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
  /** False in fan mode -- it has no expand/collapse concept (charts/
   * fanChart.ts's generation count is a fixed upfront pick, not a lazily
   * revealed edge), so those two buttons would have nothing to do. */
  showCollapseControls: boolean;
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
  canMakeRoot, showCollapseControls, canCollapseDescendants, canCollapseAncestors,
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
        {showCollapseControls && (
          <>
            <Button size="xs" fullWidth variant="default" onClick={onCollapseDescendants} disabled={!canCollapseDescendants}>
              {t("Collapse descendants")}
            </Button>
            <Button size="xs" fullWidth variant="default" onClick={onCollapseAncestors} disabled={!canCollapseAncestors}>
              {t("Collapse ancestors")}
            </Button>
          </>
        )}
      </Stack>
      <Button size="xs" fullWidth onClick={onOpen}>{t("Open in People")}</Button>
    </Paper>
  );
}
