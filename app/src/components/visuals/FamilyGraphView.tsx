// A new, deliberately non-d3 graph: every visible person can expand "up"
// (their own parents + full sibling row -- full/half/step/adopted, since
// that's the whole point of this graph) or "down" (their own children).
// Siblings need no separate mechanism: expanding "up" always reveals the
// anchor's *complete* sibling group as part of the same step, at every
// generation, not just the root's own. Plain Mantine square cards laid out
// with nested flexbox (Group/Stack) rather than SVG/d3-hierarchy -- the
// layout is a small, self-contained tree per expansion, not a single
// fixed-size coordinate space, so the browser's own flex reflow handles
// "make room for N siblings" for free, with no manual offset math or
// variable-node-size d3 separation() needed the way the box-tree
// (charts/treeChart.ts) requires.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActionIcon, Avatar, Badge, Group, Paper, Stack, Text } from "@mantine/core";
import {
  groupSiblingsByParents, personThumbnailUrl,
  type ClusterSibling, type FamilyClusterNode, type SiblingGroup, type TreeNode, type TreePersonRaw,
} from "../../store/treeData";
type OnExpandUp = (clusterId: string, sibling: TreePersonRaw) => void;
import { t } from "../../i18n/i18n";

const CARD_WIDTH = 150;

/** Starting `visited` set for both of FamilyGraphView's own top-level trees
 * (ancestorCluster, descendantTree) -- see spouseClusterElements' own doc
 * comment on what it's for. A shared empty-set constant rather than `new
 * Set()` inline at each call site, since neither ever mutates it. */
const ROOT_VISITED: ReadonlySet<string> = new Set();

/** Just the frel/mrel part (Adopted/Step/...) -- same Birth/Step/Adopted
 * vocabulary app/src/components/related/RefBadges.tsx's RelationBadge
 * already shows elsewhere, just inlined here rather than imported since
 * that component's props are the fuller RefMeta shape, not this graph's own
 * ClusterSibling. The "half via father/mother" half of this used to live
 * here too, per-card; it's now shown once per SiblingGroup instead (see
 * groupRelationLabel) since every card in a group shares that same status
 * relative to the anchor -- no need to repeat it on every card. */
function personRelationBadge(sib: ClusterSibling): string | null {
  if (sib.isAnchor) return null;
  const relType = sib.frel && sib.frel === sib.mrel ? sib.frel : [sib.frel, sib.mrel].filter(Boolean).join("/");
  return relType && relType !== "Birth" ? relType : null;
}

/** Every member of a group shares the identical relation-to-anchor
 * classification (a function purely of the group's own shared parent pair
 * vs. the anchor's), so reading it off the first member applies to the
 * whole group. Null for the anchor's own group ("full") -- nothing to call
 * out there. */
function groupRelationLabel(group: SiblingGroup): string | null {
  const relation = group.siblings[0].relation;
  if (relation === "full") return null;
  return relation === "half-father" ? t("Half-siblings (father's side)") : t("Half-siblings (mother's side)");
}

interface LinePos { x1: number; y1: number; x2: number; y2: number }

function linePosEqual(a: LinePos[], b: LinePos[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((l, i) => l.x1 === b[i].x1 && l.y1 === b[i].y1 && l.x2 === b[i].x2 && l.y2 === b[i].y2);
}

/** Shared measurement logic behind every real connector line in this graph
 * (ancestor side: several parents -> one group box; descendant side: one
 * child's own card -> that child's own further-descendants box) -- draws
 * from *specific elements* (`pairs`, already resolved by the caller, e.g.
 * via the shared card registry) rather than an assumed layout, since one
 * branch can be much wider/taller than its sibling once *it's* been
 * expanded further, pushing boxes far apart. Each pair connects whichever
 * of `from`'s top/bottom edge faces `to` (so it works whether `to` sits
 * above or below `from`) to the matching edge of `to`. Re-measures on any
 * resize of the shared container (a `ResizeObserver` on it catches any
 * descendant's size change bubbling up) and on mount. Pure CSS/flexbox
 * lays out the boxes themselves; this only ever *reads* their resulting
 * positions, never influences layout.
 *
 * `pairs` is a fresh array built from live refs at every render (the
 * caller has no stable identity to memoize it against), so `recompute`
 * itself gets a new identity every render too -- harmless on its own, but
 * it means `setLines` must only fire when the *computed positions*
 * actually changed. Skipping that comparison and calling `setLines(next)`
 * unconditionally is a real bug this hit in practice: React never sees
 * `next` (a new array/object graph each time, even when every number in it
 * is identical) as "the same" as the current state, so it re-renders,
 * which reruns this effect, which computes another new-but-equal `next`,
 * forever -- "Maximum update depth exceeded." `linesRef` mirrors the state
 * without needing `lines` itself in `recompute`'s own dependency array.
 *
 * `getPairs` is a *function*, called only from inside `recompute` itself,
 * deliberately not a pre-built array evaluated by the caller up front. A
 * newly-added card (e.g. "Expand spouses" mounting a spouse's card for the
 * first time) doesn't get its `cardRef` attached until React's commit
 * phase, which runs *after* render but *before* this hook's own
 * `useLayoutEffect` -- so building the pairs array during render (looking
 * up `getCardNode(handle)` right then) permanently freezes in "not found
 * yet" for that card, even though the ref *would* resolve correctly a
 * moment later. Calling `getPairs()` only once `recompute` actually runs
 * (post-commit) reads every ref at the one moment they're all guaranteed
 * current -- this was a real bug in practice: a newly-expanded spouse's
 * line to the children box below silently never appeared. */
function useConnectorLines(
  containerRef: React.RefObject<HTMLDivElement | null>,
  getPairs: () => { from: HTMLDivElement | null | undefined; to: HTMLDivElement | null | undefined }[],
): LinePos[] {
  const [lines, setLines] = useState<LinePos[]>([]);
  const linesRef = useRef<LinePos[]>([]);

  const recompute = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      if (linesRef.current.length > 0) {
        linesRef.current = [];
        setLines([]);
      }
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const next = getPairs()
      .map(({ from, to }) => {
        if (!from || !to) return null;
        const fr = from.getBoundingClientRect();
        const tr = to.getBoundingClientRect();
        const toIsBelow = tr.top >= fr.top;
        return {
          x1: fr.left + fr.width / 2 - containerRect.left,
          y1: (toIsBelow ? fr.bottom : fr.top) - containerRect.top,
          x2: tr.left + tr.width / 2 - containerRect.left,
          y2: (toIsBelow ? tr.top : tr.bottom) - containerRect.top,
        };
      })
      .filter((l): l is LinePos => l !== null);
    if (!linePosEqual(linesRef.current, next)) {
      linesRef.current = next;
      setLines(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, getPairs]);

  useLayoutEffect(() => {
    recompute();
  }, [recompute]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    window.addEventListener("resize", recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [containerRef, recompute]);

  return lines;
}

function ConnectorSvg({ lines }: { lines: LinePos[] }) {
  return (
    <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
      {lines.map((l, i) => (
        <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="var(--mantine-color-default-border)" strokeWidth={1.5} />
      ))}
    </svg>
  );
}

/** Ancestor side: draws one line per parent, from *that specific person's
 * own card* (not the bounding box of their whole cluster, which can contain
 * several other people once their own siblings render alongside them) to
 * the sibling group's own top-center. Looks each parent's card up by
 * handle via `getCardNode` -- the exact same registry every card already
 * registers itself in for the scroll/pulse animation, so this always
 * targets the actual person, not a wrapping container. */
function ForkConnector({ parentHandles, containerRef, getCardNode, groupBoxRef }: {
  parentHandles: string[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  getCardNode: (handle: string) => HTMLDivElement | undefined;
  groupBoxRef: React.RefObject<HTMLDivElement | null>;
}) {
  const lines = useConnectorLines(
    containerRef,
    () => parentHandles.map((handle) => ({ from: getCardNode(handle), to: groupBoxRef.current })),
  );
  return <ConnectorSvg lines={lines} />;
}

/** One-time global keyframes -- injected as a plain `<style>` rather than a
 * CSS module, since this graph otherwise has no stylesheet of its own.
 * Harmless if this component mounts more than once (identical content).
 * `familyReveal` plays on every card's own *first* mount (a real DOM
 * insertion, not a re-render with new props) -- the browser does this
 * automatically for free, so newly-appearing siblings/children (a "+"
 * click) grow/fade in with no key-based remount trick needed anywhere.
 * `familyRootPulse` is applied deliberately (`pulse` prop, below) rather
 * than left to always-on. */
function FamilyGraphKeyframes() {
  return (
    <style>{`
      @keyframes familyRootPulse {
        0% { box-shadow: 0 0 0 0 var(--mantine-primary-color-filled); }
        70% { box-shadow: 0 0 0 10px transparent; }
        100% { box-shadow: 0 0 0 0 transparent; }
      }
      @keyframes familyReveal {
        from { opacity: 0; transform: scale(0.9); }
        to { opacity: 1; transform: scale(1); }
      }
    `}</style>
  );
}

/** A small filled circle with a "+", matching the box-tree's own boundary
 * marker (charts/treeChart.ts) so the two graphs read consistently even
 * though this one is plain Mantine, not SVG/d3 -- positioned right on the
 * card's own edge (top for "expand parents," bottom for "expand children")
 * instead of taking up space as a full-width button inside the card. */
function ExpandMarker({ position, onClick, expanding }: { position: "top" | "bottom"; onClick: () => void; expanding?: boolean }) {
  return (
    <ActionIcon
      size="sm"
      radius="xl"
      variant="filled"
      loading={expanding}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={position === "top" ? t("Expand parents and siblings") : t("Expand children")}
      style={{
        position: "absolute",
        [position]: -10,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1,
      }}
    >
      +
    </ActionIcon>
  );
}

interface FamilySquareCardProps {
  person: TreePersonRaw;
  token: string | null;
  selected: boolean;
  /** The cluster's own anchor -- a lighter emphasis than `selected`, so the
   * person whose siblings/parents this block is about stays identifiable
   * even once something else is selected. */
  highlighted?: boolean;
  relationText?: string | null;
  onSelect: () => void;
  onExpand?: () => void;
  canExpand?: boolean;
  expanding?: boolean;
  expandDirection?: "up" | "down";
  /** Every card registers itself under its own handle -- see
   * FamilyGraphView's own `getCardRef`/`scrollToAndPulse`, which is how
   * both the re-root recenter *and* an expand click's own recenter find the
   * right DOM node, without any card needing to know which of those two
   * triggered it. */
  cardRef: (el: HTMLDivElement | null) => void;
  /** True for a brief moment right after this specific card became the
   * thing to look at (a fresh re-root, or the card that was just clicked to
   * expand) -- plays the `familyRootPulse` ring once, timed to land just
   * after the scroll-into-view animation settles. */
  pulse: boolean;
}

function FamilySquareCard({
  person, token, selected, highlighted, relationText, onSelect, onExpand, canExpand, expanding, expandDirection, cardRef, pulse,
}: FamilySquareCardProps) {
  const name = [person.profile?.name_given, person.profile?.name_surname].filter(Boolean).join(" ") || t("(unnamed person)");
  const thumb = token ? personThumbnailUrl(token, person, 100) : null;
  return (
    <Paper
      ref={cardRef}
      withBorder
      shadow={selected ? "md" : undefined}
      p="xs"
      w={CARD_WIDTH}
      pos="relative"
      style={{
        cursor: "pointer",
        borderColor: selected ? "var(--mantine-color-text)" : highlighted ? "var(--mantine-primary-color-filled)" : undefined,
        borderWidth: selected || highlighted ? 2 : 1,
        // Unconditional -- a card that's merely re-rendering (already
        // mounted, only props changed) never replays a CSS `animation` set
        // to the same value, so this only actually plays once, on this
        // card's own first appearance.
        animation: "familyReveal 320ms ease both",
      }}
      onClick={onSelect}
    >
      {pulse && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "var(--mantine-radius-sm)",
            animation: "familyRootPulse 900ms ease-out",
            pointerEvents: "none",
          }}
        />
      )}
      <Stack align="center" gap={4}>
        <Avatar src={thumb ?? undefined} radius="sm" size={48}>
          {!thumb && name.slice(0, 1)}
        </Avatar>
        <Text size="xs" fw={600} ta="center" lineClamp={2}>{name}</Text>
        <Group gap={4} justify="center" wrap="wrap">
          {person.profile?.birth?.date && <Badge size="xs" variant="light">*{person.profile.birth.date}</Badge>}
          {person.profile?.death?.date && <Badge size="xs" variant="light">{"†"}{person.profile.death.date}</Badge>}
        </Group>
        {relationText && <Badge size="xs" variant="light" color="gray">{relationText}</Badge>}
      </Stack>
      {canExpand && onExpand && (
        <ExpandMarker position={expandDirection === "up" ? "top" : "bottom"} onClick={onExpand} expanding={expanding} />
      )}
    </Paper>
  );
}

/** `person`'s own spouse(s) -- see PersonCard's "Expand spouses"
 * (TreeView.tsx) -- each rendered as their *own* full sibling-group cluster
 * (AncestorClusterBlock, the same component every other person in this
 * graph goes through), not a bare leaf card: every person belongs in a
 * sibling group, spouses included, so a spouse gets its own "+" and can be
 * expanded "up" just like the person they married. Rendered *beside* --
 * never inside -- whichever dashed box `person`'s own card sits in (see the
 * two call sites): a spouse isn't a blood sibling or child of that group,
 * and nesting a card in that same box was also what broke the box's own
 * connector line on "Expand spouses" -- the box is exactly what
 * ForkConnector/useConnectorLines measures, so adding a card *inside* it
 * moved its boundary (or a specific card's position within it) out from
 * under an already-drawn line. Keeping spouse clusters outside the box
 * means adding one never moves anything the connector logic depends on in
 * the first place. */
/** `visited` is every handle already rendered somewhere above this point in
 * the current spouse-cluster descent -- e.g. once A's "Expand spouses" has
 * shown B, and B's own "Expand spouses" has shown A back, `expandedSpouses`
 * holds both, and `spouseClustersByHandle` has a cluster for each pointing
 * at the other. Without this guard, rendering A's cluster draws B's card,
 * whose own spouse cluster draws A's card again, forever -- an infinite
 * React tree (and, longer chains aside, any cycle at all through repeated
 * "Expand spouses" clicks). A cluster whose anchor is already in `visited`
 * is simply not drawn a second time. */
function spouseClusterElements(
  person: TreePersonRaw,
  shared: SharedProps,
  onExpandUp: OnExpandUp,
  expandedUpKeys: ReadonlySet<string>,
  expandingUpKeys: ReadonlySet<string>,
  visited: ReadonlySet<string>,
) {
  return (shared.spouseClustersByHandle.get(person.handle) ?? [])
    .map((cluster) => ({ cluster, anchorHandle: cluster.siblings.find((s) => s.isAnchor)?.person.handle }))
    .filter(({ anchorHandle }) => !anchorHandle || !visited.has(anchorHandle))
    .map(({ cluster, anchorHandle }) => {
      const nextVisited = new Set(visited);
      nextVisited.add(person.handle);
      if (anchorHandle) nextVisited.add(anchorHandle);
      return (
        <AncestorClusterBlock
          key={cluster.id}
          cluster={cluster}
          onExpandUp={onExpandUp}
          expandedUpKeys={expandedUpKeys}
          expandingUpKeys={expandingUpKeys}
          visited={nextVisited}
          {...shared}
        />
      );
    });
}

/** `personHandle` plus the anchor handle of each of their expanded spouse
 * clusters -- every "line down to this person's children" connector uses
 * this as its set of *sources*, not just `personHandle` alone, so that
 * expanding a spouse correctly adds a second line converging on the same
 * children box instead of leaving it looking like only one parent connects
 * to kids that are actually both of theirs. */
function parentAndSpouseHandles(personHandle: string, spouseClustersByHandle: ReadonlyMap<string, FamilyClusterNode[]>): string[] {
  const spouseHandles = (spouseClustersByHandle.get(personHandle) ?? [])
    .map((c) => c.siblings.find((s) => s.isAnchor)?.person.handle)
    .filter((h): h is string => !!h);
  return [personHandle, ...spouseHandles];
}

interface SharedProps {
  token: string | null;
  selectedHandle: string | null;
  onSelectPerson: (handle: string) => void;
  getCardRef: (handle: string) => (el: HTMLDivElement | null) => void;
  /** Read-only lookup into the exact same registry `getCardRef` populates --
   * ForkConnector uses this to find a specific parent's own card by handle,
   * rather than a wrapping container that might hold several people. */
  getCardNode: (handle: string) => HTMLDivElement | undefined;
  pulsingHandle: string | null;
  /** Each spouse's own pre-built cluster, for whichever handles have had
   * "Expand spouses" clicked (TreeView.tsx's PersonCard) -- rendered via
   * spouseClusterElements right alongside that person's own card, wherever
   * it appears (a sibling group's box, or a children box). Provided
   * externally since this component has no access to the flat person list
   * (or `buildFamilyClusterTree`) needed to build one. */
  spouseClustersByHandle: ReadonlyMap<string, FamilyClusterNode[]>;
}

/** One cluster = one or more sibling groups side by side (almost always
 * just one -- the anchor's own primary family -- but a half-sibling branch
 * that's also been expanded elsewhere gets its own). Each group draws its
 * *own* ancestry above it (SiblingGroupWithAncestry) rather than pooling
 * every group's parents into one shared row, since two different groups
 * can have entirely different parents. */
function AncestorClusterBlock({
  cluster, onExpandUp, expandedUpKeys, expandingUpKeys, visited, ...shared
}: SharedProps & {
  cluster: FamilyClusterNode;
  onExpandUp: (clusterId: string, sibling: TreePersonRaw) => void;
  expandedUpKeys: ReadonlySet<string>;
  expandingUpKeys: ReadonlySet<string>;
  /** See spouseClusterElements' own doc comment -- threaded through
   * unchanged to every sibling group here so their own spouse-cluster
   * rendering can detect a cycle back to a handle already on screen above. */
  visited: ReadonlySet<string>;
}) {
  return (
    // `nowrap` -- same reasoning as the parent row's own `nowrap` below:
    // different sibling-groups here are still peers at the same generation,
    // and the graph is free to grow as wide as it needs to (the outer
    // wrapper already scrolls both ways) rather than wrapping them onto a
    // second row, which would visually read as a different generation.
    <Group gap="xl" wrap="nowrap" justify="center" align="flex-end">
      {groupSiblingsByParents(cluster.siblings).map((group) => (
        <SiblingGroupWithAncestry
          key={group.key}
          group={group}
          clusterId={cluster.id}
          parentClusters={cluster.parentClustersByGroup[group.key] ?? []}
          onExpandUp={onExpandUp}
          expandedUpKeys={expandedUpKeys}
          expandingUpKeys={expandingUpKeys}
          visited={visited}
          {...shared}
        />
      ))}
    </Group>
  );
}

/** One SiblingGroup's own bordered box, plus (if expanded) its own parent
 * clusters directly above it and real measured lines (ForkConnector)
 * connecting each parent box to this group's box -- rather than one
 * generic vertical line in the middle, which reads as ambiguous once the
 * two parents' own boxes end up far apart (one side expanded much further
 * than the other). Everyone inside the group shares the exact same
 * parents, so one "+" (spanning the group, not per-card) expands all of
 * them at once. A group that isn't the anchor's own primary family (i.e. a
 * half-sibling branch) gets a small label identifying which side it's on. */
function SiblingGroupWithAncestry({
  group, clusterId, parentClusters, onExpandUp, expandedUpKeys, expandingUpKeys, visited, ...shared
}: SharedProps & {
  group: SiblingGroup;
  clusterId: string;
  parentClusters: FamilyClusterNode[];
  onExpandUp: (clusterId: string, sibling: TreePersonRaw) => void;
  expandedUpKeys: ReadonlySet<string>;
  expandingUpKeys: ReadonlySet<string>;
  visited: ReadonlySet<string>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const groupBoxRef = useRef<HTMLDivElement>(null);

  const key = `${clusterId}:${group.key}`;
  const canExpand = group.key !== "-:-" && !expandedUpKeys.has(key);
  const label = groupRelationLabel(group);
  // The specific person each parent cluster is about (its own anchor,
  // always present -- computeClusterSiblings always includes the person it
  // was built from) -- what ForkConnector's lines actually target, not the
  // cluster's own (possibly multi-person) bounding box.
  const parentHandles = parentClusters
    .map((pc) => pc.siblings.find((s) => s.isAnchor)?.person.handle)
    .filter((h): h is string => !!h);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <Stack align="center" gap="xs">
        {parentClusters.length > 0 && (
          // `nowrap`, deliberately: father and mother must always stay on
          // the same row, even if one side's own further expansion makes
          // the combined width exceed the viewport -- the outer graph is
          // already horizontally scrollable, so overflow there is fine,
          // but wrapping to a second line would separate them entirely.
          <Group gap="md" align="flex-end" wrap="nowrap" justify="center">
            {parentClusters.map((pc) => (
              <AncestorClusterBlock
                key={pc.id}
                cluster={pc}
                onExpandUp={onExpandUp}
                expandedUpKeys={expandedUpKeys}
                expandingUpKeys={expandingUpKeys}
                visited={visited}
                {...shared}
              />
            ))}
          </Group>
        )}
        {parentClusters.length > 0 && <div style={{ height: 20 }} />}
        <Stack align="center" gap={4}>
          {label && <Text size="xs" c="dimmed">{label}</Text>}
          {/* Spouse clusters sit beside this Group, never inside
              `groupBoxRef`'s own div -- see spouseClusterElements' own doc
              comment on why: that div's boundary is exactly what
              ForkConnector measures below, so anything added inside it
              would move the very thing an already-drawn line depends on.
              `align="flex-end"`, not "center": a spouse's own cluster can be
              taller than this box (their own further ancestors extend
              upward above them), and center-aligning two different-height
              flex items pushes their actual "this generation" cards out of
              line with each other -- bottom-aligning keeps both anchors on
              the same row regardless, exactly like the father/mother row
              above already does for the same reason. */}
          <Group gap="md" align="flex-end" wrap="nowrap">
            <div
              ref={groupBoxRef}
              style={{ position: "relative", border: "1px dashed var(--mantine-color-default-border)", borderRadius: 10, padding: 10 }}
            >
              {/* `nowrap` too -- a group box is exactly as wide as its
                  members need, never reflowing with viewport width, which
                  also keeps ForkConnector's own "top-center of this box"
                  measurement stable rather than jumping between one and two
                  rows as the window resizes. */}
              <Group gap="xs" wrap="nowrap" justify="center">
                {group.siblings.map((sib) => (
                  <FamilySquareCard
                    key={sib.person.handle}
                    person={sib.person}
                    token={shared.token}
                    selected={sib.person.handle === shared.selectedHandle}
                    highlighted={sib.isAnchor}
                    relationText={personRelationBadge(sib)}
                    onSelect={() => shared.onSelectPerson(sib.person.handle)}
                    cardRef={shared.getCardRef(sib.person.handle)}
                    pulse={shared.pulsingHandle === sib.person.handle}
                  />
                ))}
              </Group>
              {canExpand && (
                <ExpandMarker
                  position="top"
                  onClick={() => onExpandUp(clusterId, group.siblings[0].person)}
                  expanding={expandingUpKeys.has(key)}
                />
              )}
            </div>
            {group.siblings.flatMap((sib) => spouseClusterElements(sib.person, shared, onExpandUp, expandedUpKeys, expandingUpKeys, visited))}
          </Group>
        </Stack>
      </Stack>
      {parentClusters.length > 0 && (
        <ForkConnector parentHandles={parentHandles} containerRef={containerRef} getCardNode={shared.getCardNode} groupBoxRef={groupBoxRef} />
      )}
    </div>
  );
}

/** Descendant side, mirroring SiblingGroupWithAncestry: one bordered box
 * holding a row of siblings-as-children -- all direct kids of whichever
 * person this level is about, visually grouped the same way the ancestor
 * side's own sibling groups are (previously this side had no such box at
 * all, and successive children with different amounts of their own content
 * below them could end up looking like they were on different rows).
 * Each *individually* expanded child's own further-descendants box renders
 * below, connected by its own measured line from that specific child's own
 * card -- not one generic line in the middle -- and every such subtree is
 * top-aligned (`align="flex-start"`) so multiple children's own subtrees
 * always start at the same row regardless of how much content is below
 * each one. */
function DescendantChildrenBox({
  children: childNodes, onExpandDown, expandingDownKeys, onExpandUp, expandedUpKeys, expandingUpKeys, visited, ...shared
}: SharedProps & {
  children: TreeNode[];
  onExpandDown: (label: string, handle: string) => void;
  expandingDownKeys: ReadonlySet<string>;
  // Threaded through purely so a descendant-side child's own "Expand
  // spouses" can render that spouse's cluster (spouseClusterElements needs
  // these three, same as the ancestor side already has in scope).
  onExpandUp: OnExpandUp;
  expandedUpKeys: ReadonlySet<string>;
  expandingUpKeys: ReadonlySet<string>;
  /** See spouseClusterElements' own doc comment -- the same cycle guard the
   * ancestor side threads through, kept separately per recursive call here
   * (each nested DescendantChildrenBox gets the unchanged set its own
   * caller had; spouseClusterElements grows it locally per spouse cluster
   * it actually renders). */
  visited: ReadonlySet<string>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const subtreeRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const expandedChildren = childNodes.filter((c) => !!c.person && !!c.children && c.children.length > 0);
  // One line per (child or expanded spouse of that child) -> that child's
  // own further-descendants box -- a fork, exactly like the ancestor
  // side's own ForkConnector, once a spouse has been expanded for that
  // child (both of them are that box's own children, after all).
  const lines = useConnectorLines(
    containerRef,
    () => expandedChildren.flatMap((c) =>
      parentAndSpouseHandles(c.person!.handle, shared.spouseClustersByHandle).map((h) => ({
        from: shared.getCardNode(h),
        to: subtreeRefs.current.get(c.person!.handle),
      })),
    ),
  );

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <Stack align="center" gap="xs">
        {/* Spouse clusters render in their own Group beside this box, never
            inside it -- see spouseClusterElements' own doc comment: the
            connector above targets a *specific child's own card*, and that
            card's position inside this box must stay stable regardless of
            how many spouse clusters get added anywhere, which nesting
            content in the same row broke (adding anything shifts a
            centered flex row's other members). `align="flex-end"`, not
            "center" -- same reasoning as SiblingGroupWithAncestry's own
            identical fix: a spouse's own cluster can be taller (their own
            further ancestors extend upward above them), and centering two
            different-height flex items misaligns their actual cards. */}
        <Group gap="md" align="flex-end" wrap="nowrap">
          <div style={{ border: "1px dashed var(--mantine-color-default-border)", borderRadius: 10, padding: 10 }}>
            <Group gap="xs" wrap="nowrap" justify="center">
              {childNodes.map((child) => (child.person ? (
                <FamilySquareCard
                  key={child.person.handle}
                  person={child.person}
                  token={shared.token}
                  selected={child.person.handle === shared.selectedHandle}
                  onSelect={() => shared.onSelectPerson(child.person!.handle)}
                  onExpand={() => onExpandDown(child.id!, child.person!.handle)}
                  canExpand={!!child.hasMore}
                  expanding={expandingDownKeys.has(`descendant:${child.person.handle}`)}
                  expandDirection="down"
                  cardRef={shared.getCardRef(child.person.handle)}
                  pulse={shared.pulsingHandle === child.person.handle}
                />
              ) : null))}
            </Group>
          </div>
          {childNodes.flatMap((child) => (
            child.person ? spouseClusterElements(child.person, shared, onExpandUp, expandedUpKeys, expandingUpKeys, visited) : []
          ))}
        </Group>
        {expandedChildren.length > 0 && <div style={{ height: 20 }} />}
        {expandedChildren.length > 0 && (
          <Group gap="md" wrap="nowrap" justify="center" align="flex-start">
            {expandedChildren.map((child) => (
              <div
                key={child.id}
                ref={(el) => {
                  if (el) subtreeRefs.current.set(child.person!.handle, el);
                  else subtreeRefs.current.delete(child.person!.handle);
                }}
              >
                <DescendantChildrenBox
                  children={child.children!}
                  onExpandDown={onExpandDown}
                  expandingDownKeys={expandingDownKeys}
                  onExpandUp={onExpandUp}
                  expandedUpKeys={expandedUpKeys}
                  expandingUpKeys={expandingUpKeys}
                  visited={visited}
                  {...shared}
                />
              </div>
            ))}
          </Group>
        )}
      </Stack>
      {expandedChildren.length > 0 && <ConnectorSvg lines={lines} />}
    </div>
  );
}

export interface FamilyGraphViewProps extends Omit<SharedProps, "getCardRef" | "getCardNode" | "pulsingHandle"> {
  /** The root's own cluster (their siblings, `isAnchor` on the root itself)
   * plus however many parent-clusters have been expanded so far. Null while
   * still loading. */
  ancestorCluster: FamilyClusterNode | null;
  /** The root's own descendant TreeNode -- only its `children` are rendered
   * (the root itself already appears, highlighted, within
   * `ancestorCluster`'s own bottom-most sibling row). */
  descendantTree: TreeNode | null;
  /** The graph's current root/focus handle -- a change here (a genuine
   * re-root, or `focusFamilyOn`'s own local recenter) triggers the
   * scroll-to-center-and-pulse treatment on that card. Both callbacks below
   * may return a Promise (they do fetch first): this graph awaits it before
   * recentering on the clicked card, so the scroll lands after the newly
   * revealed content has actually rendered. */
  rootHandle: string | null;
  onExpandUp: (clusterId: string, sibling: TreePersonRaw) => void | Promise<void>;
  onExpandDown: (label: string, handle: string) => void | Promise<void>;
  expandedUpKeys: ReadonlySet<string>;
  expandingUpKeys: ReadonlySet<string>;
  expandingDownKeys: ReadonlySet<string>;
}

/** Ancestors read top-to-bottom as physically "up," the root's own sibling
 * row sits in the middle (the bottom of `ancestorCluster`'s own stack), and
 * descendants continue below -- a literal spatial match for "ancestors/up,
 * descendants/down." No pan/zoom for v1: a plain scrollable wrapper handles
 * a diagram that outgrows the viewport.
 *
 * Two things animate, both driven by `scrollToAndPulse` below -- smooth-
 * scroll a specific card into the center of the view and give it one brief
 * highlight pulse, mirroring the box-tree's own "pan/animate onto the node
 * that just became relevant" treatment (charts/treeChart.ts's
 * `centerHandle`/`centerOnSelect`):
 *  - **Re-root/recenter**: `rootHandle` changing (a genuine re-root, or
 *    `focusFamilyOn`'s own local recenter in TreeView.tsx) recenters on that
 *    card.
 *  - **Expand click**: clicking a card's own "+" recenters on *that* card
 *    once the newly revealed content has rendered around it -- the same
 *    "pan to the thing you just told the graph to grow" idea, just per-card
 *    instead of per-root.
 * Every card also registers itself (`getCardRef`) so `scrollToAndPulse` can
 * find whichever one needs it -- crucially, none of this ever remounts any
 * part of the tree (no `key`-driven resets): the same DOM nodes just get
 * scrolled to and briefly highlighted in place, which is what makes the
 * motion visible at all instead of being masked by a hard redraw. */
export function FamilyGraphView({
  ancestorCluster, descendantTree, onExpandUp, onExpandDown, expandedUpKeys, expandingUpKeys, expandingDownKeys, rootHandle, ...shared
}: FamilyGraphViewProps) {
  const cardNodes = useRef<Map<string, HTMLDivElement>>(new Map());
  const refCallbacks = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map());
  const getCardRef = useCallback((handle: string) => {
    let cb = refCallbacks.current.get(handle);
    if (!cb) {
      cb = (el) => {
        if (el) cardNodes.current.set(handle, el);
        else cardNodes.current.delete(handle);
      };
      refCallbacks.current.set(handle, cb);
    }
    return cb;
  }, []);
  const getCardNode = useCallback((handle: string) => cardNodes.current.get(handle), []);

  const [pulsingHandle, setPulsingHandle] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const scrollToAndPulse = useCallback((handle: string) => {
    requestAnimationFrame(() => {
      cardNodes.current.get(handle)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    });
    setPulsingHandle(handle);
    setTimeout(() => {
      if (mountedRef.current) setPulsingHandle((h) => (h === handle ? null : h));
    }, 900);
  }, []);

  const prevRootRef = useRef<string | null>(null);
  useEffect(() => {
    if (!rootHandle || !ancestorCluster) return;
    if (prevRootRef.current === rootHandle) return;
    prevRootRef.current = rootHandle;
    scrollToAndPulse(rootHandle);
  }, [rootHandle, ancestorCluster, scrollToAndPulse]);

  const handleExpandUp = useCallback(
    (clusterId: string, sibling: TreePersonRaw) => {
      Promise.resolve(onExpandUp(clusterId, sibling)).then(() => scrollToAndPulse(sibling.handle));
    },
    [onExpandUp, scrollToAndPulse],
  );
  const handleExpandDown = useCallback(
    (label: string, handle: string) => {
      Promise.resolve(onExpandDown(label, handle)).then(() => scrollToAndPulse(handle));
    },
    [onExpandDown, scrollToAndPulse],
  );

  // The root's own card, plus any of *its* expanded spouses, connect down
  // to the root's children box -- a measured fork (same reasoning as
  // DescendantChildrenBox's own `pairs` above), replacing what used to be
  // one static, unmeasured `ClusterConnector` line that only ever pointed
  // at the root alone. `rootChildrenWrapperRef` wraps the whole
  // `DescendantChildrenBox` call the same way each recursive call's own
  // `subtreeRefs` entry does -- its top edge coincides with the children
  // box's own top edge (the box is the first thing rendered inside it).
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const rootChildrenWrapperRef = useRef<HTMLDivElement>(null);
  const hasChildren = !!descendantTree?.children && descendantTree.children.length > 0;
  const rootLines = useConnectorLines(
    graphContainerRef,
    () => (hasChildren && rootHandle
      ? parentAndSpouseHandles(rootHandle, shared.spouseClustersByHandle).map((h) => ({
          from: getCardNode(h),
          to: rootChildrenWrapperRef.current,
        }))
      : []),
  );

  if (!ancestorCluster) return null;
  const sharedProps: SharedProps = {
    token: shared.token, selectedHandle: shared.selectedHandle, onSelectPerson: shared.onSelectPerson, getCardRef, getCardNode, pulsingHandle,
    spouseClustersByHandle: shared.spouseClustersByHandle,
  };
  return (
    <div style={{ width: "100%", height: "100%", overflow: "auto", padding: 24 }}>
      <FamilyGraphKeyframes />
      <div ref={graphContainerRef} style={{ position: "relative" }}>
        <Stack align="center" gap="md" style={{ minWidth: "fit-content", margin: "0 auto" }}>
          <AncestorClusterBlock
            cluster={ancestorCluster}
            onExpandUp={handleExpandUp}
            expandedUpKeys={expandedUpKeys}
            expandingUpKeys={expandingUpKeys}
            visited={ROOT_VISITED}
            {...sharedProps}
          />
          {hasChildren && (
            <>
              <div style={{ height: 20 }} />
              <div ref={rootChildrenWrapperRef}>
                <DescendantChildrenBox
                  children={descendantTree!.children!}
                  onExpandDown={handleExpandDown}
                  expandingDownKeys={expandingDownKeys}
                  onExpandUp={handleExpandUp}
                  expandedUpKeys={expandedUpKeys}
                  expandingUpKeys={expandingUpKeys}
                  visited={ROOT_VISITED}
                  {...sharedProps}
                />
              </div>
            </>
          )}
        </Stack>
        {hasChildren && <ConnectorSvg lines={rootLines} />}
      </div>
    </div>
  );
}
