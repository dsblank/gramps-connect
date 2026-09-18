// A new, deliberately non-d3 graph: every visible person can expand "up"
// (their own parents + full sibling row -- full/half/step/adopted, since
// that's the whole point of this graph) or "down" (their own children).
// Siblings need no separate mechanism: expanding "up" always reveals the
// anchor's *complete* sibling group as part of the same step, at every
// generation, not just the root's own. Plain Mantine square cards, laid out
// with flexbox (Group/Stack) rather than SVG/d3-hierarchy -- but unlike a
// nested per-branch tree (where two branches expanded to different depths
// could end up on visually different rows purely by accident, since each
// branch's own height above its box would differ), every box this graph
// renders is collected into one flat, generation-indexed set of full-width
// rows (collectAncestorCluster/collectDescendantChildren, below) so "the
// same generation always lands on the same row" is structural rather than
// incidental. Connector lines are still drawn by measuring real DOM rects
// (useConnectorLines) rather than any manual coordinate math -- the
// browser's own flex reflow still handles "make room for N siblings" for
// free, same as before, just organized by row instead of by branch.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ActionIcon, Avatar, Badge, Divider, Group, Paper, Stack, Text } from "@mantine/core";
import {
  groupChildrenByFamily, groupSiblingsByParents, personThumbnailUrl,
  type ClusterSibling, type FamilyClusterNode, type SiblingGroup, type TreeNode, type TreePersonRaw,
} from "../../store/treeData";
type OnExpandUp = (clusterId: string, sibling: TreePersonRaw) => void;
import { t } from "../../i18n/i18n";

const CARD_WIDTH = 150;
// At least 2x CARD_WIDTH: a compact card's name and dates sit on one row
// (no avatar stacked above them), so it needs the extra horizontal room
// that the normal card instead spends on vertical space, plus enough
// slack that a longer name doesn't immediately clip.
const COMPACT_CARD_WIDTH = 380;

/** Shared between the normal (stacked-under-avatar) and compact
 * (inline-with-name) card layouts, so both read a person's birth/death the
 * same way. */
function personDateBadges(person: TreePersonRaw) {
  return (
    <>
      {person.profile?.birth?.date && <Badge size="xs" variant="light">*{person.profile.birth.date}</Badge>}
      {person.profile?.death?.date && <Badge size="xs" variant="light">{"†"}{person.profile.death.date}</Badge>}
    </>
  );
}

/** Starting `visited` set for both of FamilyGraphView's own top-level trees
 * (ancestorCluster, descendantTree) -- see spouseClusterInfos' own doc
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

/** Every member of a group was found via the same family record and shares
 * that family's own blood-tie classification to the anchor (computed
 * per-child in computeClusterSiblings, not just from the family's own
 * father/mother handles -- a blended family can otherwise mix relations),
 * so reading it off the first member applies to the whole group. Null for
 * the anchor's own group ("full") -- nothing to call out there. "step"
 * covers a group with no blood tie to either of the anchor's own parents
 * even though they share this family (e.g. the anchor's father's third
 * wife's own children from her prior marriage). */
function groupRelationLabel(group: SiblingGroup): string | null {
  const relation = group.siblings[0].relation;
  if (relation === "full") return null;
  if (relation === "step") return t("Step-siblings");
  return relation === "half-father" ? t("Half-siblings (father's side)") : t("Half-siblings (mother's side)");
}

interface LinePos {
  x1: number; y1: number; x2: number; y2: number;
  /** Which edge of `from` this line actually left from -- "vertical" for
   * the usual top/bottom-center attachment, "horizontal" for compact
   * mode's left/right-edge one (see the `compact` candidates below).
   * ConnectorSvg's own compact curve needs this to know which axis to bow
   * the line's start away from; `to` (always a box, never a person card)
   * always attaches on its vertical edge either way. */
  axis: "vertical" | "horizontal";
}

function linePosEqual(a: LinePos[], b: LinePos[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((l, i) => l.x1 === b[i].x1 && l.y1 === b[i].y1 && l.x2 === b[i].x2 && l.y2 === b[i].y2 && l.axis === b[i].axis);
}

/** Shared measurement logic behind every real connector line in this graph
 * (ancestor side: several parents -> one group box; descendant side: one
 * child's own card -> that child's own further-descendants box) -- draws
 * from *specific elements* (`pairs`, already resolved by the caller, e.g.
 * via the shared card/box registries) rather than an assumed layout, since
 * one branch can be much wider/taller than its sibling once *it's* been
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
 * line to the children box below silently never appeared.
 *
 * `compact` picks the "from" endpoint (the card's own edge, not the box's):
 * normally always the vertical (top/bottom) edge facing `to`, but a compact
 * card is wide (COMPACT_CARD_WIDTH) and several sibling groups can end up
 * offset well to one side of the parent box they connect to, making a
 * center-bottom line needlessly diagonal across the whole card's width.
 * With `compact`, the left and right edge midpoints are also considered as
 * candidates and whichever of the three yields the shortest line to `to`'s
 * own fixed point wins -- `to` itself (a box, not a person card) still
 * always uses its vertical edge, unaffected either way. */
function useConnectorLines(
  containerRef: React.RefObject<HTMLDivElement | null>,
  getPairs: () => { from: HTMLDivElement | null | undefined; to: HTMLDivElement | null | undefined }[],
  compact: boolean,
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
        const toX = tr.left + tr.width / 2;
        const toY = toIsBelow ? tr.top : tr.bottom;
        const fromCandidates: { x: number; y: number; axis: LinePos["axis"] }[] = [
          { x: fr.left + fr.width / 2, y: toIsBelow ? fr.bottom : fr.top, axis: "vertical" },
          ...(compact ? [
            { x: fr.left, y: fr.top + fr.height / 2, axis: "horizontal" as const },
            { x: fr.right, y: fr.top + fr.height / 2, axis: "horizontal" as const },
          ] : []),
        ];
        const from2 = fromCandidates.reduce((a, b) => (
          Math.hypot(a.x - toX, a.y - toY) <= Math.hypot(b.x - toX, b.y - toY) ? a : b
        ));
        return {
          x1: from2.x - containerRect.left,
          y1: from2.y - containerRect.top,
          x2: toX - containerRect.left,
          y2: toY - containerRect.top,
          axis: from2.axis,
        };
      })
      .filter((l): l is LinePos => l !== null);
    if (!linePosEqual(linesRef.current, next)) {
      linesRef.current = next;
      setLines(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, getPairs, compact]);

  useLayoutEffect(() => {
    recompute();
  }, [recompute]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    window.addEventListener("resize", recompute);
    // A card's own `familyReveal` mount animation (FamilySquareCard) is a
    // `transform: scale(...)` -- it changes the card's *painted* box, which
    // `getBoundingClientRect()` reflects while the animation is still
    // running, but never its actual layout size, so the ResizeObserver
    // above never fires once it finishes. The very first `recompute()`
    // (the useLayoutEffect below, right after mount) can land mid-animation
    // and freeze in that not-yet-settled position -- nothing re-measures it
    // afterward unless something unrelated happens to re-render this graph
    // first. `animationend` bubbles up from every card inside `container`,
    // so listening here (rather than per-card) catches every one of them
    // and re-measures right as each settles, with no arbitrary delay guess.
    container.addEventListener("animationend", recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recompute);
      container.removeEventListener("animationend", recompute);
    };
  }, [containerRef, recompute]);

  return lines;
}

/** A cubic Bezier's two control points, bowed away from each endpoint along
 * *that* endpoint's own edge (so the curve leaves each shape roughly
 * perpendicular to it) rather than one generic curve formula -- `to` is
 * always a box, attached on its vertical edge, so its own control point
 * always bows vertically; `from`'s own control point follows whichever
 * edge `l.axis` says it actually left from (see LinePos's own doc comment).
 * The offset is a fraction of the *relevant* axis's own span, clamped so a
 * very short or very long line still curves by a sane amount. */
function connectorCurvePath(l: LinePos): string {
  const dx = l.x2 - l.x1;
  const dy = l.y2 - l.y1;
  const clamp = (v: number) => Math.max(16, Math.min(Math.abs(v) * 0.5, 60));
  const cp2 = { x: l.x2, y: l.y2 - Math.sign(dy || 1) * clamp(dy) };
  const cp1 = l.axis === "horizontal"
    ? { x: l.x1 + Math.sign(dx || 1) * clamp(dx), y: l.y1 }
    : { x: l.x1, y: l.y1 + Math.sign(dy || 1) * clamp(dy) };
  return `M ${l.x1} ${l.y1} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${l.x2} ${l.y2}`;
}

/** `curved` -- compact mode only, for now -- draws each connector as a
 * smooth cubic-Bezier path (connectorCurvePath) instead of a straight
 * `<line>`. Left as a per-call flag rather than baked into `lines` itself,
 * since the underlying measurement (useConnectorLines) doesn't care how
 * its endpoints end up drawn. */
function ConnectorSvg({ lines, curved }: { lines: LinePos[]; curved?: boolean }) {
  return (
    <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
      {lines.map((l, i) => (curved ? (
        <path key={i} d={connectorCurvePath(l)} fill="none" stroke="var(--mantine-color-default-border)" strokeWidth={1.5} />
      ) : (
        <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="var(--mantine-color-default-border)" strokeWidth={1.5} />
      )))}
      {/* One small dot at each end of every line, marking exactly where it
          attaches (a card's own edge, or a box's) -- separate from the
          line/path loop above so a line's own stroke never draws on top of
          either dot regardless of curved vs. straight. */}
      {lines.map((l, i) => (
        <g key={i}>
          <circle cx={l.x1} cy={l.y1} r={3} fill="var(--mantine-color-gray-5)" />
          <circle cx={l.x2} cy={l.y2} r={3} fill="var(--mantine-color-gray-5)" />
        </g>
      ))}
    </svg>
  );
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
  /** Compact mode (TreeView.tsx's own checkbox, same spot/style as fan
   * mode's "Show lifespan"): drops the avatar/fallback-initial entirely and
   * puts birth/death right beside the name instead of in their own row
   * below it, so each card is shorter and reads as one line. */
  compact?: boolean;
}

function FamilySquareCard({
  person, token, selected, highlighted, relationText, onSelect, onExpand, canExpand, expanding, expandDirection, cardRef, pulse, compact,
}: FamilySquareCardProps) {
  const name = [person.profile?.name_given, person.profile?.name_surname].filter(Boolean).join(" ") || t("(unnamed person)");
  const thumb = !compact && token ? personThumbnailUrl(token, person, 100) : null;
  return (
    <Paper
      ref={cardRef}
      withBorder
      shadow={selected ? "md" : undefined}
      p="xs"
      w={compact ? COMPACT_CARD_WIDTH : CARD_WIDTH}
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
      {compact ? (
        <Stack gap={2}>
          <Group gap={6} justify="space-between" wrap="nowrap">
            <Text size="xs" fw={600} lineClamp={1} style={{ flex: 1, minWidth: 0 }}>{name}</Text>
            <Group gap={4} wrap="nowrap">
              {personDateBadges(person)}
            </Group>
          </Group>
          {relationText && <Badge size="xs" variant="light" color="gray">{relationText}</Badge>}
        </Stack>
      ) : (
        <Stack align="center" gap={4}>
          <Avatar src={thumb ?? undefined} radius="sm" size={48}>
            {!thumb && name.slice(0, 1)}
          </Avatar>
          <Text size="xs" fw={600} ta="center" lineClamp={2}>{name}</Text>
          <Group gap={4} justify="center" wrap="wrap">
            {personDateBadges(person)}
          </Group>
          {relationText && <Badge size="xs" variant="light" color="gray">{relationText}</Badge>}
        </Stack>
      )}
      {canExpand && onExpand && (
        <ExpandMarker position={expandDirection === "up" ? "top" : "bottom"} onClick={onExpand} expanding={expanding} />
      )}
    </Paper>
  );
}

/** `personHandle` plus that specific family's `otherParentHandle` -- but
 * only if that other parent is actually visible in the graph right now (an
 * "Expand spouses" click made a card for them). Each children-box's
 * connector uses this as its set of *sources*, so a box only ever gets a
 * line from the two parents who are actually that family's own -- e.g.
 * wife #1's box never gets a line from wife #2's card, even once she's been
 * expanded too. Without the other parent expanded, only `personHandle`'s
 * own line is drawn, same as before spouses existed in this graph at all. */
function familyParentHandles(
  personHandle: string,
  otherParentHandle: string | undefined,
  spouseClustersByHandle: ReadonlyMap<string, FamilyClusterNode[]>,
): string[] {
  if (!otherParentHandle) return [personHandle];
  const otherParentExpanded = (spouseClustersByHandle.get(personHandle) ?? [])
    .some((c) => c.siblings.find((s) => s.isAnchor)?.person.handle === otherParentHandle);
  return otherParentExpanded ? [personHandle, otherParentHandle] : [personHandle];
}

interface SharedProps {
  token: string | null;
  selectedHandle: string | null;
  onSelectPerson: (handle: string) => void;
  getCardRef: (handle: string) => (el: HTMLDivElement | null) => void;
  /** Read-only lookup into the exact same registry `getCardRef` populates --
   * connector lines use this to find a specific person's own card by
   * handle, rather than a wrapping container that might hold several
   * people. */
  getCardNode: (handle: string) => HTMLDivElement | undefined;
  pulsingHandle: string | null;
  /** Each spouse's own pre-built cluster, for whichever handles have had
   * "Expand spouses" clicked (TreeView.tsx's PersonCard) -- collected via
   * spouseClusterInfos right alongside that person's own box, at the same
   * generation, wherever it appears. Provided externally since this
   * component has no access to the flat person list (or
   * `buildFamilyClusterTree`) needed to build one. */
  spouseClustersByHandle: ReadonlyMap<string, FamilyClusterNode[]>;
  /** See FamilySquareCardProps' own doc comment. Threaded through every
   * level the same way `token`/`selectedHandle` already are, since compact
   * mode applies uniformly across the whole graph, not per-branch. */
  compact: boolean;
  /** Every rendered box (SiblingGroupBox: keyed `${clusterId}:${group.key}`;
   * ChildrenGroupBox: keyed `desc:${parentHandle}:${familyKey}`, one per
   * family/marriage) registers itself here --
   * FamilyGraphView's single connector overlay looks boxes up by this same
   * key. Boxes no longer nest inside whichever box is one generation over
   * (see this file's own top doc comment on generation rows), so there's no
   * more local container a box's own incoming line could be scoped to. */
  getBoxRef: (key: string) => (el: HTMLDivElement | null) => void;
  getBoxNode: (key: string) => HTMLDivElement | undefined;
}

/** One SiblingGroup's own bordered box -- everyone inside shares the exact
 * same parents, so one "+" (spanning the group, not per-card) expands all
 * of them at once. A group that isn't the anchor's own primary family (i.e.
 * a half-sibling branch) gets a small label identifying which side it's on.
 * Parent clusters and spouse clusters are never rendered as children of
 * this component -- collectAncestorCluster places each in its own
 * generation's row instead -- so this only ever draws the one box. */
function SiblingGroupBox({
  boxKey, group, label, canExpand, expanding, onExpand, shared,
}: {
  boxKey: string;
  group: SiblingGroup;
  label: string | null;
  canExpand: boolean;
  expanding: boolean;
  onExpand: () => void;
  shared: SharedProps;
}) {
  return (
    <Stack align="center" gap={4}>
      {label && <Text size="xs" c="dimmed">{label}</Text>}
      <div
        ref={shared.getBoxRef(boxKey)}
        style={{ position: "relative", border: "1px dashed var(--mantine-color-default-border)", borderRadius: 10, padding: 10 }}
      >
        {/* Compact mode lists this sibling group as a vertical Stack
            instead, per the "Compact" checkbox (TreeView.tsx). */}
        {shared.compact ? (
          <Stack gap="xs">
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
                compact
              />
            ))}
          </Stack>
        ) : (
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
        )}
        {canExpand && <ExpandMarker position="top" onClick={onExpand} expanding={expanding} />}
      </div>
    </Stack>
  );
}

/** Descendant-side mirror of SiblingGroupBox: one bordered box holding a
 * row of siblings-as-children -- all direct kids of whichever person this
 * level is about. */
function ChildrenGroupBox({
  boxKey, childNodes, onExpandDown, expandingDownKeys, shared,
}: {
  boxKey: string;
  childNodes: TreeNode[];
  onExpandDown: (label: string, handle: string) => void;
  expandingDownKeys: ReadonlySet<string>;
  shared: SharedProps;
}) {
  return (
    <div
      ref={shared.getBoxRef(boxKey)}
      style={{ border: "1px dashed var(--mantine-color-default-border)", borderRadius: 10, padding: 10 }}
    >
      {shared.compact ? (
        <Stack gap="xs">
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
              compact
            />
          ) : null))}
        </Stack>
      ) : (
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
      )}
    </div>
  );
}

/** `person`'s own spouse cluster(s) -- see PersonCard's "Expand spouses"
 * (TreeView.tsx) -- each one is its own full sibling-group cluster (the
 * same shape collectAncestorCluster already walks for any other cluster in
 * this graph), collected at the *same* generation as `person` themselves,
 * so it lands right alongside their own box in that generation's row.
 *
 * `visited` is every handle already collected somewhere earlier in the
 * current spouse-cluster descent -- e.g. once A's "Expand spouses" has
 * shown B, and B's own "Expand spouses" has shown A back,
 * `spouseClustersByHandle` has a cluster for each pointing at the other.
 * Without this guard, collecting A's cluster reaches B's card, whose own
 * spouse cluster reaches A's card again, forever -- an infinite recursion
 * (and, longer chains aside, any cycle at all through repeated "Expand
 * spouses" clicks). A cluster whose anchor is already in `visited` is
 * simply skipped. */
function spouseClusterInfos(person: TreePersonRaw, shared: SharedProps, visited: ReadonlySet<string>) {
  return (shared.spouseClustersByHandle.get(person.handle) ?? [])
    .map((cluster) => ({ cluster, anchorHandle: cluster.siblings.find((s) => s.isAnchor)?.person.handle }))
    .filter(({ anchorHandle }) => !anchorHandle || !visited.has(anchorHandle));
}

/** One line per (specific person's card) -> (specific box, top-center) --
 * collected while walking the tree (collectAncestorCluster/
 * collectDescendantChildren) rather than drawn locally by whichever box is
 * involved, since boxes no longer nest inside each other closely enough to
 * share a local coordinate space. FamilyGraphView draws every spec here as
 * one shared overlay. */
interface ConnectorSpec {
  fromHandles: string[];
  toBoxKey: string;
}

function pushRow(rows: Map<number, ReactNode[]>, generation: number, node: ReactNode) {
  const list = rows.get(generation);
  if (list) list.push(node);
  else rows.set(generation, [node]);
}

/** Walks one ancestor cluster (the anchor's own sibling groups, plus
 * however many parent-clusters have been expanded) into `rows` (bucketed by
 * generation: 0 = this cluster's own anchor, +1 = their parents, +2 = their
 * grandparents, ...) and `connectors`, rather than returning a nested JSX
 * tree -- see this file's own top doc comment on why generation needs to be
 * explicit rather than implied by nesting depth. Every sibling's own
 * expanded spouse cluster is walked right after that sibling's own group
 * (same generation, `generation` unchanged), and every parent cluster one
 * generation further out (`generation + 1`). */
function collectAncestorCluster(
  cluster: FamilyClusterNode,
  generation: number,
  shared: SharedProps,
  onExpandUp: OnExpandUp,
  expandedUpKeys: ReadonlySet<string>,
  expandingUpKeys: ReadonlySet<string>,
  visited: ReadonlySet<string>,
  rows: Map<number, ReactNode[]>,
  connectors: ConnectorSpec[],
) {
  for (const group of groupSiblingsByParents(cluster.siblings)) {
    const boxKey = `${cluster.id}:${group.key}`;
    const parentClusters = cluster.parentClustersByGroup[group.key] ?? [];
    if (parentClusters.length > 0) {
      // The specific person each parent cluster is about (its own anchor,
      // always present -- computeClusterSiblings always includes the
      // person it was built from) -- what the connector line actually
      // targets, not the cluster's own (possibly multi-person) box.
      const parentHandles = parentClusters
        .map((pc) => pc.siblings.find((s) => s.isAnchor)?.person.handle)
        .filter((h): h is string => !!h);
      connectors.push({ fromHandles: parentHandles, toBoxKey: boxKey });
    }

    pushRow(rows, generation, (
      <SiblingGroupBox
        key={boxKey}
        boxKey={boxKey}
        group={group}
        label={groupRelationLabel(group)}
        canExpand={group.key !== "-:-" && !expandedUpKeys.has(boxKey)}
        expanding={expandingUpKeys.has(boxKey)}
        onExpand={() => onExpandUp(cluster.id, group.siblings[0].person)}
        shared={shared}
      />
    ));

    for (const sib of group.siblings) {
      for (const { cluster: spouseCluster, anchorHandle } of spouseClusterInfos(sib.person, shared, visited)) {
        const nextVisited = new Set(visited);
        nextVisited.add(sib.person.handle);
        if (anchorHandle) nextVisited.add(anchorHandle);
        collectAncestorCluster(
          spouseCluster, generation, shared, onExpandUp, expandedUpKeys, expandingUpKeys, nextVisited, rows, connectors,
        );
      }
    }

    for (const pc of parentClusters) {
      collectAncestorCluster(pc, generation + 1, shared, onExpandUp, expandedUpKeys, expandingUpKeys, visited, rows, connectors);
    }
  }
}

/** Descendant-side mirror of collectAncestorCluster: one box per *family*
 * (marriage) among a person's own children, bucketed the same way by
 * generation (-1 = this person's own children, -2 = grandchildren, ...),
 * each keyed `desc:${parentHandle}:${familyKey}` so FamilyGraphView's
 * connector overlay can target it. `groupChildrenByFamily` is what keeps
 * three marriages' worth of children from landing in the same box -- see
 * its own doc comment (treeData.ts) and TreeNode.familyHandle. */
function collectDescendantChildren(
  childNodes: TreeNode[],
  generation: number,
  parentHandle: string,
  shared: SharedProps,
  onExpandDown: (label: string, handle: string) => void,
  expandingDownKeys: ReadonlySet<string>,
  onExpandUp: OnExpandUp,
  expandedUpKeys: ReadonlySet<string>,
  expandingUpKeys: ReadonlySet<string>,
  visited: ReadonlySet<string>,
  rows: Map<number, ReactNode[]>,
  connectors: ConnectorSpec[],
) {
  for (const group of groupChildrenByFamily(childNodes)) {
    const boxKey = `desc:${parentHandle}:${group.key}`;
    connectors.push({
      fromHandles: familyParentHandles(parentHandle, group.otherParentHandle, shared.spouseClustersByHandle),
      toBoxKey: boxKey,
    });
    pushRow(rows, generation, (
      <ChildrenGroupBox
        key={boxKey}
        boxKey={boxKey}
        childNodes={group.children}
        onExpandDown={onExpandDown}
        expandingDownKeys={expandingDownKeys}
        shared={shared}
      />
    ));

    for (const child of group.children) {
      if (!child.person) continue;
      for (const { cluster: spouseCluster, anchorHandle } of spouseClusterInfos(child.person, shared, visited)) {
        const nextVisited = new Set(visited);
        nextVisited.add(child.person.handle);
        if (anchorHandle) nextVisited.add(anchorHandle);
        collectAncestorCluster(
          spouseCluster, generation, shared, onExpandUp, expandedUpKeys, expandingUpKeys, nextVisited, rows, connectors,
        );
      }
    }

    for (const child of group.children) {
      if (!child.person || !child.children || child.children.length === 0) continue;
      // The recursive call below pushes this child's own family-grouped
      // connector(s) itself (same per-family loop, one level down) -- no
      // separate connector push needed here the way a single flat box used
      // to require.
      collectDescendantChildren(
        child.children, generation - 1, child.person.handle, shared, onExpandDown, expandingDownKeys,
        onExpandUp, expandedUpKeys, expandingUpKeys, visited, rows, connectors,
      );
    }
  }
}

export interface FamilyGraphViewProps extends Omit<SharedProps, "getCardRef" | "getCardNode" | "pulsingHandle" | "getBoxRef" | "getBoxNode"> {
  /** The root's own cluster (their siblings, `isAnchor` on the root itself)
   * plus however many parent-clusters have been expanded so far. Null while
   * still loading. */
  ancestorCluster: FamilyClusterNode | null;
  /** The root's own descendant TreeNode -- only its `children` are rendered
   * (the root itself already appears, highlighted, within
   * `ancestorCluster`'s own generation-0 row). */
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

/** Ancestors read top-to-bottom as physically "up," the root's own
 * generation sits in the middle, and descendants continue below -- a
 * literal spatial match for "ancestors/up, descendants/down." Every box is
 * collected (collectAncestorCluster/collectDescendantChildren, above) into
 * one flat, generation-indexed set of rows rather than a nested per-branch
 * tree, so two boxes at the same generation always land on the same
 * full-width row, with a full-width divider between each row -- see this
 * file's own top doc comment. No pan/zoom for v1: a plain scrollable
 * wrapper handles a diagram that outgrows the viewport.
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

  // Same registry pattern as cardNodes/getCardRef above, just for boxes
  // (SiblingGroupBox/ChildrenGroupBox) instead of individual person cards --
  // see SharedProps' own doc comment on why boxes need this now.
  const boxNodes = useRef<Map<string, HTMLDivElement>>(new Map());
  const boxRefCallbacks = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map());
  const getBoxRef = useCallback((key: string) => {
    let cb = boxRefCallbacks.current.get(key);
    if (!cb) {
      cb = (el) => {
        if (el) boxNodes.current.set(key, el);
        else boxNodes.current.delete(key);
      };
      boxRefCallbacks.current.set(key, cb);
    }
    return cb;
  }, []);
  const getBoxNode = useCallback((key: string) => boxNodes.current.get(key), []);

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

  const graphContainerRef = useRef<HTMLDivElement>(null);

  // Plain derived values, not hooks -- safe to compute after the hooks
  // above regardless of `ancestorCluster` (unlike a hook, a function call
  // being conditionally skipped some renders doesn't break React's "same
  // hooks, same order, every render" rule). `useConnectorLines` just below
  // still runs unconditionally either way, same as every render.
  const sharedProps: SharedProps = {
    token: shared.token, selectedHandle: shared.selectedHandle, onSelectPerson: shared.onSelectPerson,
    getCardRef, getCardNode, pulsingHandle, spouseClustersByHandle: shared.spouseClustersByHandle,
    compact: shared.compact, getBoxRef, getBoxNode,
  };
  const rows = new Map<number, ReactNode[]>();
  const connectors: ConnectorSpec[] = [];
  if (ancestorCluster) {
    collectAncestorCluster(ancestorCluster, 0, sharedProps, handleExpandUp, expandedUpKeys, expandingUpKeys, ROOT_VISITED, rows, connectors);
    if (rootHandle && descendantTree?.children && descendantTree.children.length > 0) {
      // collectDescendantChildren pushes each family group's own connector
      // itself (per-family loop), so no separate connector push is needed
      // here the way a single flat box used to require.
      collectDescendantChildren(
        descendantTree.children, -1, rootHandle, sharedProps, handleExpandDown, expandingDownKeys,
        handleExpandUp, expandedUpKeys, expandingUpKeys, ROOT_VISITED, rows, connectors,
      );
    }
  }
  // Oldest ancestors first (largest generation number) down to the deepest
  // descendants (most negative) -- literally top-to-bottom reading order.
  const generations = Array.from(rows.keys()).sort((a, b) => b - a);

  const lines = useConnectorLines(
    graphContainerRef,
    () => connectors.flatMap((c) => c.fromHandles.map((h) => ({ from: getCardNode(h), to: getBoxNode(c.toBoxKey) }))),
    shared.compact,
  );

  if (!ancestorCluster) return null;

  return (
    <div style={{ width: "100%", height: "100%", overflow: "auto", padding: 24 }}>
      <FamilyGraphKeyframes />
      <div ref={graphContainerRef} style={{ position: "relative" }}>
        <Stack gap={0} style={{ minWidth: "fit-content", margin: "0 auto" }}>
          {generations.map((gen, i) => (
            <div key={gen}>
              {/* Full-width by construction: a plain block-level child of
                  this Stack, not nested inside any one row's own
                  shrink-to-fit width, so it always spans the widest row in
                  the whole graph -- see this file's own top doc comment. */}
              {i > 0 && <Divider my="md" />}
              <Group gap="xl" wrap="nowrap" justify="center" align="flex-start" py="xs">
                {rows.get(gen)}
              </Group>
            </div>
          ))}
        </Stack>
        <ConnectorSvg lines={lines} curved={shared.compact} />
      </div>
    </div>
  );
}
