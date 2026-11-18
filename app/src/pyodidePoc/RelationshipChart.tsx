// relationship_chart(paths)'s block (pyodideWorker.ts): paths from
// db.get_relationship_paths() drawn the way a family tree shows them --
// for an ordinary relationship the genealogist's "inverted V", the common
// ancestor (or ancestor couple) on top, the first person's line down the
// left, the last person's down the right, one row per generation; for a
// chain through marriages, several of those side by side, joined by rings
// (see layoutRelationshipChart). More than one path: a pager above.
//
// The Gramplet decides who is on the path and what each card says; names
// and dates come from the local person cache here, so they follow the
// tree's name format and the user's date settings, and cost no request.
// Cards are HTML (the browser wraps names properly); only the connecting
// lines are SVG, drawn underneath.
import { Group, Pagination, Paper, Text, UnstyledButton, useComputedColorScheme } from "@mantine/core";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getToken } from "../auth/auth";
import { GENDER_LABEL, genderAccent } from "../charts/genderColors";
import { t } from "../i18n/i18n";
import { formatDisplayDate } from "../store/placeIndex";
import { getViewStore } from "../store/registry";
import type { PathLink, PathNode, PathStep, RelationshipPath } from "../store/relationshipPath";
import { fetchPage } from "../store/api";
import { displayName, PERSON_VIEW } from "../store/views";
import { ObjectMenu } from "./ObjectCellButton";

const CARD_W = 188;
const CARD_H = 76; // room for a name on two lines
const ROW_GAP = 34; // between one generation's cards and the next
const LEG_GAP = 24; // between the two legs' cards
const PAD = 8;
const ROW_H = CARD_H + ROW_GAP;

interface PersonInfo {
  name: string;
  birth: GrampsDate | null;
  death: GrampsDate | null;
}

function parseDate(json: unknown): GrampsDate | null {
  if (typeof json !== "string" || !json) return null;
  try {
    return JSON.parse(json) as GrampsDate;
  } catch {
    return null;
  }
}

/** Just the year -- the cards are small; the full dates are in the
 * tooltip. */
function yearOf(date: GrampsDate | null): string {
  const year = date?.dateval?.[2];
  if (!year) return "";
  return date.modifier === 3 ? `${t("c.")}${year}` : String(year);
}

const INFO_COLUMNS = ["primary_name", "birth_date", "death_date"];

function toInfo(row: unknown[]): PersonInfo {
  return { name: displayName(row[0]), birth: parseDate(row[1]), death: parseDate(row[2]) };
}

/** The same three columns for people the People cache doesn't hold, from
 * the server, in the cache's own stored form (each column's toSql) so
 * toInfo() reads both alike. The cache holds only what the People list
 * shows -- while that list is filtered, everyone on the path outside the
 * filter is missing from it. */
async function fetchInfo(handles: string[]): Promise<Map<string, PersonInfo>> {
  const columns = PERSON_VIEW.columns.filter((c) => INFO_COLUMNS.includes(c.key));
  const where = `handle in [${handles.map((h) => `'${h}'`).join(", ")}]`;
  const { page } = await fetchPage(PERSON_VIEW, await getToken(), null, false, where, PERSON_VIEW.orderBy, handles.length, columns);
  const found = new Map<string, PersonInfo>();
  for (const item of page.items) {
    const row = INFO_COLUMNS.map((key) => {
      const column = columns.find((c) => c.key === key)!;
      return column.toSql ? column.toSql(item[key], item) : item[key];
    });
    found.set(item.handle, toInfo(row));
  }
  return found;
}

/** Name and dates for each card. Read from the People cache first (it
 * follows edits and costs no request), re-read whenever that cache
 * changes -- a filter applied or cleared, a live-sync update -- and for
 * anyone it doesn't hold, fetched once from the server. */
function usePeople(handles: string[]): Map<string, PersonInfo> {
  const [people, setPeople] = useState(new Map<string, PersonInfo>());
  const fetched = useRef(new Map<string, PersonInfo>());
  const requested = useRef(new Set<string>());
  const store = getViewStore("person");
  const revision = useSyncExternalStore(store.subscribe, () => store.getSnapshot().revision);
  const key = handles.join(",");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await store.ensureLoaded();
      if (cancelled) return;
      const wanted = key ? key.split(",") : [];
      const read = () => {
        const next = new Map<string, PersonInfo>();
        for (const handle of wanted) {
          const row = store.readRowByHandle(handle, INFO_COLUMNS, { unfiltered: true });
          const info = row ? toInfo(row) : fetched.current.get(handle);
          if (info) next.set(handle, info);
        }
        return next;
      };
      const local = read();
      setPeople((prev) => (sameInfo(prev, local) ? prev : local));
      const missing = wanted.filter((h) => !local.has(h) && !requested.current.has(h));
      if (missing.length === 0) return;
      for (const h of missing) requested.current.add(h);
      try {
        for (const [h, info] of await fetchInfo(missing)) fetched.current.set(h, info);
      } catch {
        // Left as "(unknown)"; a later change to the cache retries.
        for (const h of missing) requested.current.delete(h);
        return;
      }
      if (!cancelled) setPeople(read());
    })();
    return () => {
      cancelled = true;
    };
  }, [key, revision, store]);
  return people;
}

function sameInfo(a: Map<string, PersonInfo>, b: Map<string, PersonInfo>): boolean {
  if (a.size !== b.size) return false;
  for (const [h, info] of b) {
    const other = a.get(h);
    if (!other || other.name !== info.name || JSON.stringify(other.birth) !== JSON.stringify(info.birth) || JSON.stringify(other.death) !== JSON.stringify(info.death)) return false;
  }
  return true;
}

type CardKind = "end" | "top" | "mid";
type Point = [number, number];

interface PlacedCard {
  node: PathNode;
  label: string;
  kind: CardKind;
  x: number;
  y: number;
}

interface Layout {
  cards: PlacedCard[];
  /** Every connecting line, as the points it runs through. */
  lines: Point[][];
  /** Centres of the marriage rings. */
  rings: Point[];
  width: number;
  height: number;
}

const COL_W = CARD_W + LEG_GAP;
const vertical = (link: PathLink | null) => link === "parent" || link === "child";

/** Where the chain turns round: up then down (a peak, the common ancestor)
 * or down then up (a valley). */
function isTurn(steps: PathStep[], i: number): boolean {
  return i > 0 && i < steps.length - 1 && vertical(steps[i].link) && vertical(steps[i + 1].link) && steps[i].link !== steps[i + 1].link;
}

/** A card before it's put in pixels: `v` counts columns (a turn sits half
 * way between two), `row` generations, up being negative. */
interface Slot {
  node: PathNode;
  label: string;
  kind: CardKind;
  v: number;
  row: number;
}

/** Positions only -- no names or dates needed, so this is the part a test
 * can check.
 *
 * The chain is drawn the way a family tree would show it, one link at a
 * time: a run of parents (or children) is one column, one row per
 * generation; at a turn the chain moves on to a new column, with the
 * ancestor (or ancestor couple) centred above the two, or the shared child
 * below; a marriage moves across with rings; a sibling link moves across
 * with the pair's parents above. So an ordinary relationship is the
 * genealogist's "inverted V", and a chain through marriages is several of
 * them side by side. If anything would overlap (a chain that doubles back
 * on itself), every person gets a column of their own instead. */
export function layoutRelationshipChart(path: RelationshipPath, startLabel: string): Layout {
  return layout(path, startLabel, false) ?? layout(path, startLabel, true)!;
}

function layout(path: RelationshipPath, startLabel: string, staircase: boolean): Layout | null {
  const steps = path.steps;
  const last = steps.length - 1;
  const turn = (i: number) => !staircase && isTurn(steps, i);
  const labelOf = (node: PathNode) => node.label || node.relationship_string || "";

  // Each person's row and column.
  const rows: number[] = [];
  const cols: number[] = [];
  let c = 0;
  let r = 0;
  steps.forEach((step, i) => {
    if (i > 0) {
      r += step.link === "parent" ? -1 : step.link === "child" ? 1 : 0;
      if (staircase || turn(i - 1) || step.link === "spouse" || step.link === "sibling") c += 1;
    }
    rows.push(r);
    cols.push(turn(i) ? c + 0.5 : c);
  });

  const slots: Slot[] = steps.map((node, i) => ({
    node,
    label: i === 0 ? startLabel : labelOf(node),
    kind: i === 0 || i === last ? "end" : turn(i) && node.link === "parent" ? "top" : "mid",
    v: cols[i],
    row: rows[i],
  }));
  // An ancestor couple: the one on the chain on the left, their spouse on
  // the right, together centred over the turn.
  const couples: { i: number; v: number; row: number; two: boolean }[] = [];
  steps.forEach((step, i) => {
    if (staircase) return;
    if (turn(i) && step.link === "parent" && step.partner) {
      slots[i].v -= 0.5;
      slots.push({ node: step.partner, label: labelOf(step.partner), kind: "top", v: cols[i] + 0.5, row: rows[i] });
    }
    if (step.link === "sibling" && step.parents?.length) {
      const mid = (cols[i - 1] + cols[i]) / 2;
      const two = step.parents.length > 1;
      step.parents.slice(0, 2).forEach((parent, j) =>
        slots.push({ node: parent, label: labelOf(parent), kind: "top", v: two ? mid - 0.5 + j : mid, row: rows[i] - 1 }),
      );
      couples.push({ i, v: mid, row: rows[i] - 1, two });
    }
  });

  // Two cards in one row closer than a card's width would overlap.
  for (let a = 0; a < slots.length; a++)
    for (let b = a + 1; b < slots.length; b++)
      if (slots[a].row === slots[b].row && Math.abs(slots[a].v - slots[b].v) * COL_W < CARD_W) return null;

  const minV = Math.min(...slots.map((s) => s.v));
  const minRow = Math.min(...slots.map((s) => s.row));
  const maxRow = Math.max(...slots.map((s) => s.row));
  const X = (v: number) => PAD + (v - minV) * COL_W;
  const cx = (v: number) => X(v) + CARD_W / 2;
  const top = (row: number) => PAD + (row - minRow) * ROW_H;
  const bottom = (row: number) => top(row) + CARD_H;
  const mid = (row: number) => top(row) + CARD_H / 2;

  const lines: Point[][] = [];
  const rings: Point[] = [];
  /** A marriage between the cards at columns v and v + 1. */
  const marriage = (v: number, row: number) => {
    lines.push([[X(v) + CARD_W, mid(row)], [X(v + 1), mid(row)]]);
    rings.push([X(v + 1) - LEG_GAP / 2, mid(row)]);
  };
  /** From under someone (or a couple) down to the tops of two people. */
  const branchDown = (from: Point, row: number, to: number[]) => {
    const elbow = bottom(row) + ROW_GAP / 2;
    for (const k of to) lines.push([from, [from[0], elbow], [cx(cols[k]), elbow], [cx(cols[k]), top(rows[k])]]);
  };
  /** From above someone up to the bottoms of two people. */
  const branchUp = (from: Point, row: number, to: number[]) => {
    const elbow = top(row) - ROW_GAP / 2;
    for (const k of to) lines.push([from, [from[0], elbow], [cx(cols[k]), elbow], [cx(cols[k]), bottom(rows[k])]]);
  };

  steps.forEach((step, i) => {
    if (turn(i)) {
      if (step.link === "parent") {
        // The ancestor (or couple) above both sides.
        let from: Point = [cx(cols[i]), bottom(rows[i])];
        if (step.partner) {
          marriage(cols[i] - 0.5, rows[i]);
          from = [cx(cols[i]), mid(rows[i])];
        }
        branchDown(from, rows[i], [i - 1, i + 1]);
      } else {
        branchUp([cx(cols[i]), top(rows[i])], rows[i], [i - 1, i + 1]);
      }
      return;
    }
    if (i === 0 || turn(i - 1)) return;
    const prev = i - 1;
    if (step.link === "spouse") {
      marriage(cols[prev], rows[i]);
    } else if (step.link === "sibling") {
      const couple = couples.find((k) => k.i === i);
      if (!couple) {
        lines.push([[X(cols[prev]) + CARD_W, mid(rows[i])], [X(cols[i]), mid(rows[i])]]);
      } else if (couple.two) {
        marriage(couple.v - 0.5, couple.row);
        branchDown([cx(couple.v), mid(couple.row)], couple.row, [prev, i]);
      } else {
        branchDown([cx(couple.v), bottom(couple.row)], couple.row, [prev, i]);
      }
    } else {
      // A parent above a child: straight down in one column, or an elbow
      // between two (the staircase).
      const [upper, lower] = rows[prev] < rows[i] ? [prev, i] : [i, prev];
      if (cols[upper] === cols[lower]) {
        lines.push([[cx(cols[upper]), bottom(rows[upper])], [cx(cols[lower]), top(rows[lower])]]);
      } else {
        branchDown([cx(cols[upper]), bottom(rows[upper])], rows[upper], [lower]);
      }
    }
  });

  const cards = slots.map((s) => ({ node: s.node, label: s.label, kind: s.kind, x: X(s.v), y: top(s.row) }));
  return {
    cards,
    lines,
    rings,
    width: Math.max(...cards.map((c) => c.x)) + CARD_W + PAD,
    height: top(maxRow) + CARD_H + PAD,
  };
}

function PersonCard({
  card,
  info,
  dark,
  interactive,
}: {
  card: PlacedCard;
  info: PersonInfo | undefined;
  dark: boolean;
  interactive: boolean;
}) {
  const name = info?.name || t("(unknown)");
  const years = info && (info.birth || info.death) ? `${yearOf(info.birth)}–${yearOf(info.death)}` : "";
  const fullDates = info ? [formatDisplayDate(info.birth), formatDisplayDate(info.death)].filter(Boolean).join(" – ") : "";
  const tooltip = [name, fullDates, t(GENDER_LABEL[card.node.gender] ?? "")].filter(Boolean).join("\n");
  const accent = genderAccent(card.node.gender, dark);
  const body = (
    <UnstyledButton
      title={tooltip}
      style={{ position: "absolute", left: card.x, top: card.y, width: CARD_W, height: CARD_H }}
    >
      <Paper
        withBorder
        radius="md"
        h="100%"
        style={{
          display: "flex",
          overflow: "hidden",
          background: card.kind === "top" ? "var(--mantine-color-default-hover)" : undefined,
          borderColor: card.kind === "end" ? "var(--mantine-primary-color-filled)" : undefined,
          borderWidth: card.kind === "end" ? 2 : undefined,
        }}
      >
        <div style={{ width: 4, margin: "6px 0", borderRadius: 2, background: accent ?? "transparent", flex: "none" }} />
        <div style={{ padding: "4px 8px 4px 10px", minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <Text size="sm" fw={600} lineClamp={2} lh={1.25}>
            {name}
          </Text>
          <Text size="xs" c="dimmed" lh={1.4}>
            {years}
          </Text>
          <Text size="xs" fs="italic" truncate lh={1.4} style={{ color: "var(--mantine-primary-color-light-color)" }}>
            {card.label}
          </Text>
        </div>
      </Paper>
    </UnstyledButton>
  );
  return interactive ? (
    <ObjectMenu objectType="person" handle={card.node.handle} label={name}>
      {body}
    </ObjectMenu>
  ) : (
    body
  );
}

export function RelationshipChart({
  paths,
  startLabel,
  interactive,
}: {
  paths: RelationshipPath[];
  startLabel: string | null;
  interactive: boolean;
}) {
  const dark = useComputedColorScheme("light") === "dark";
  const [index, setIndex] = useState(0);
  const path = paths[Math.min(index, paths.length - 1)];
  const layout = layoutRelationshipChart(path, startLabel ?? t("Home person"));
  const people = usePeople(layout.cards.map((c) => c.node.handle));
  const end = path.steps[path.steps.length - 1];
  return (
    <div style={{ marginBottom: "var(--mantine-spacing-xs)" }}>
      {paths.length > 1 && (
        <Group gap="xs" mb={4}>
          <Pagination size="xs" total={paths.length} value={index + 1} onChange={(page) => setIndex(page - 1)} />
          <Text size="xs" c="dimmed">
            {end.label || end.relationship_string}
          </Text>
        </Group>
      )}
      <div style={{ overflowX: "auto" }}>
        <div style={{ position: "relative", width: layout.width, height: layout.height }}>
          <svg width={layout.width} height={layout.height} style={{ position: "absolute", inset: 0 }} aria-hidden>
            {layout.lines.map((points, i) => (
              <path
                key={i}
                d={points.map(([x, y], j) => `${j === 0 ? "M" : "L"}${x},${y}`).join(" ")}
                fill="none"
                stroke="var(--mantine-color-dimmed)"
                strokeWidth={1.5}
              />
            ))}
            {/* Two linked rings: the first is filled so it hides the line
                behind it, the second isn't, so they look linked. */}
            {layout.rings.map(([x, y], i) => (
              <g key={i} stroke="var(--mantine-color-dimmed)" strokeWidth={1.5}>
                <circle cx={x - 3.5} cy={y} r={5.5} fill="var(--mantine-color-body)" />
                <circle cx={x + 3.5} cy={y} r={5.5} fill="none" />
              </g>
            ))}
          </svg>
          {layout.cards.map((card, i) => (
            <PersonCard
              key={`${card.node.handle}-${i}`}
              card={card}
              info={people.get(card.node.handle)}
              dark={dark}
              interactive={interactive}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
