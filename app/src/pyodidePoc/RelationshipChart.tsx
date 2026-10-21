// relationship_chart(path)'s block (pyodideWorker.ts): one path from
// db.get_relationship_paths() as the genealogist's "inverted V" -- the
// common ancestor (or ancestor couple) on top, the first person's line down
// the left, the last person's down the right, one row per generation, so
// "once removed" is simply one leg being a row longer.
//
// The Gramplet decides who is on the path and what each card says; names
// and dates come from the local person cache here, so they follow the
// tree's name format and the user's date settings, and cost no request.
// Cards are HTML (the browser wraps names properly); only the connecting
// lines are SVG, drawn underneath.
import { Paper, Text, UnstyledButton, useComputedColorScheme } from "@mantine/core";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { useEffect, useState } from "react";
import { GENDER_LABEL, genderAccent } from "../charts/genderColors";
import { t } from "../i18n/i18n";
import { formatDisplayDate } from "../store/placeIndex";
import { getViewStore } from "../store/registry";
import type { PathNode, RelationshipPath } from "../store/relationshipPath";
import { displayName } from "../store/views";
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

function usePeople(handles: string[]): Map<string, PersonInfo> {
  const [people, setPeople] = useState(new Map<string, PersonInfo>());
  const key = handles.join(",");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const store = getViewStore("person");
      await store.ensureLoaded();
      const next = new Map<string, PersonInfo>();
      for (const handle of key.split(",")) {
        const row = store.readRowByHandle(handle, ["primary_name", "birth_date", "death_date"]);
        if (row) next.set(handle, { name: displayName(row[0]), birth: parseDate(row[1]), death: parseDate(row[2]) });
      }
      if (!cancelled) setPeople(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);
  return people;
}

type CardKind = "end" | "top" | "mid";

interface PlacedCard {
  node: PathNode;
  label: string;
  kind: CardKind;
  x: number;
  y: number;
}

interface Layout {
  cards: PlacedCard[];
  /** SVG path data for every connecting line. */
  lines: string[];
  /** Centres of the marriage rings. */
  rings: [number, number][];
  width: number;
  height: number;
}

/** Positions only -- no names or dates needed, so this is the part a
 * test can check. */
export function layoutRelationshipChart(path: RelationshipPath, startLabel: string): Layout {
  const nodes = path.people;
  const anc = path.common_ancestors;
  const last = nodes.length - 1;
  const labelOf = (i: number) => (i === 0 ? startLabel : nodes[i].relationship_string);

  if (anc.length === 0 || nodes.length < 2) {
    // A spouse (or a lone person): side by side, joined.
    const cards: PlacedCard[] = nodes.map((node, i) => ({
      node,
      label: labelOf(i),
      kind: "end",
      x: PAD + i * (CARD_W + LEG_GAP),
      y: PAD,
    }));
    const mid = PAD + CARD_H / 2;
    const joined = nodes.length === 2;
    return {
      cards,
      lines: joined ? [`M${PAD + CARD_W},${mid} H${PAD + CARD_W + LEG_GAP}`] : [],
      rings: joined ? [[PAD + CARD_W + LEG_GAP / 2, mid]] : [],
      width: PAD * 2 + nodes.length * CARD_W + (nodes.length - 1) * LEG_GAP,
      height: PAD * 2 + CARD_H,
    };
  }

  const top = Math.max(0, nodes.findIndex((n) => n.handle === anc[0]));
  const leftLeg = nodes.slice(0, top).reverse(); // just below the ancestor, down to the first person
  const rightLeg = nodes.slice(top + 1); // just below the ancestor, down to the last person
  const legs = [leftLeg, rightLeg].filter((leg) => leg.length > 0);
  const couple = anc.length === 2 && path.partner !== null;
  const across = Math.max(legs.length, couple ? 2 : 1);
  const width = PAD * 2 + CARD_W * across + LEG_GAP * (across - 1);
  const height = PAD * 2 + CARD_H + ROW_H * Math.max(leftLeg.length, rightLeg.length);
  const centre = width / 2;
  const cards: PlacedCard[] = [];
  const lines: string[] = [];
  const rings: [number, number][] = [];
  const kindOf = (i: number): CardKind => (i === 0 || i === last ? "end" : "mid");

  // The ancestor row: one card, or the couple side by side with the legs
  // hanging from the middle of their line, like a family tree's drop line.
  let drop: [number, number];
  if (couple) {
    const mid = PAD + CARD_H / 2;
    const leftX = centre - LEG_GAP / 2 - CARD_W;
    const rightX = centre + LEG_GAP / 2;
    lines.push(`M${leftX + CARD_W},${mid} H${rightX}`);
    rings.push([centre, mid]);
    cards.push({ node: nodes[top], label: labelOf(top), kind: "top", x: leftX, y: PAD });
    cards.push({ node: path.partner!, label: path.partner!.relationship_string, kind: "top", x: rightX, y: PAD });
    drop = [centre, mid];
  } else {
    cards.push({
      node: nodes[top],
      label: labelOf(top),
      kind: kindOf(top) === "end" ? "end" : "top",
      x: centre - CARD_W / 2,
      y: PAD,
    });
    drop = [centre, PAD + CARD_H];
  }

  // Each leg: a column of cards, the first joined to the ancestor row by an
  // elbow, the rest by straight lines.
  const columns: [PathNode[], number][] =
    legs.length === 2
      ? [
          [leftLeg, centre - LEG_GAP / 2 - CARD_W / 2],
          [rightLeg, centre + LEG_GAP / 2 + CARD_W / 2],
        ]
      : legs.map((leg) => [leg, centre]);
  const elbowY = PAD + CARD_H + ROW_GAP / 2;
  for (const [leg, cx] of columns) {
    lines.push(`M${drop[0]},${drop[1]} V${elbowY} H${cx} V${PAD + ROW_H}`);
    leg.forEach((node, i) => {
      const y = PAD + ROW_H * (i + 1);
      if (i > 0) lines.push(`M${cx},${y - ROW_GAP} V${y}`);
      const index = nodes.indexOf(node);
      cards.push({ node, label: labelOf(index), kind: kindOf(index), x: cx - CARD_W / 2, y });
    });
  }
  return { cards, lines, rings, width, height };
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
  path,
  startLabel,
  interactive,
}: {
  path: RelationshipPath;
  startLabel: string | null;
  interactive: boolean;
}) {
  const dark = useComputedColorScheme("light") === "dark";
  const layout = layoutRelationshipChart(path, startLabel ?? t("Home person"));
  const people = usePeople(layout.cards.map((c) => c.node.handle));
  return (
    <div style={{ overflowX: "auto", marginBottom: "var(--mantine-spacing-xs)" }}>
      <div style={{ position: "relative", width: layout.width, height: layout.height }}>
        <svg width={layout.width} height={layout.height} style={{ position: "absolute", inset: 0 }} aria-hidden>
          {layout.lines.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="var(--mantine-color-dimmed)" strokeWidth={1.5} />
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
        {layout.cards.map((card) => (
          <PersonCard
            key={card.node.handle}
            card={card}
            info={people.get(card.node.handle)}
            dark={dark}
            interactive={interactive}
          />
        ))}
      </div>
    </div>
  );
}
