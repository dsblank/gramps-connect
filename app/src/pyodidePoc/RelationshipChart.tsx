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

/** "wife's father": an in-law label, relative to the person married into
 * the family. The pattern is translatable, so a language can put the two
 * the other way round. */
export function composeInLaw(anchor: string, relationship: string): string {
  return t("{0}'s {1}").replace("{0}", anchor).replace("{1}", relationship);
}

/** Positions only -- no names or dates needed, so this is the part a
 * test can check. */
export function layoutRelationshipChart(path: RelationshipPath, startLabel: string): Layout {
  const all = path.people;
  const via = path.via ?? null;
  const viaIndex = via ? all.findIndex((n) => n.handle === via.handle) : -1;
  // After an in-law path's marriage, labels are relative to the person
  // married into the family -- "father" becomes "wife's father".
  const labels = all.map((n) => n.relationship_string);
  labels[0] = startLabel;
  for (let i = viaIndex + 1; viaIndex >= 0 && i < all.length; i++) labels[i] = composeInLaw(labels[viaIndex], labels[i]);
  const labelOf = new Map(all.map((n, i) => [n.handle, labels[i]]));
  const isEnd = (h: string) => h === all[0].handle || h === all[all.length - 1].handle;
  // The blood part is everyone but the one who married in; they're added
  // beside their spouse at the end. The partner is on the blood side, so
  // relative to `via` exactly when the blood side comes after it.
  const marriedIn = via ? all.find((n) => n.handle === via.married_to) ?? null : null;
  const nodes = marriedIn ? all.filter((n) => n !== marriedIn) : all;
  const partnerAfterVia = via !== null && via.married_to === all[0].handle;
  const partnerLabel = path.partner
    ? partnerAfterVia
      ? composeInLaw(labelOf.get(via!.handle) ?? "", path.partner.relationship_string)
      : path.partner.relationship_string
    : "";

  const anc = path.common_ancestors;
  const cards: PlacedCard[] = [];
  const lines: Point[][] = [];
  const rings: Point[] = [];
  const place = (node: PathNode, x: number, y: number, top = false) =>
    cards.push({ node, label: labelOf.get(node.handle) ?? "", kind: isEnd(node.handle) ? "end" : top ? "top" : "mid", x, y });
  let height = PAD * 2 + CARD_H;

  if (anc.length === 0 || nodes.length < 2) {
    // A spouse (or a lone person): side by side, joined.
    nodes.forEach((node, i) => place(node, PAD + i * (CARD_W + LEG_GAP), PAD));
    if (nodes.length === 2) {
      const mid = PAD + CARD_H / 2;
      lines.push([[PAD + CARD_W, mid], [PAD + CARD_W + LEG_GAP, mid]]);
      rings.push([PAD + CARD_W + LEG_GAP / 2, mid]);
    }
  } else {
    const top = Math.max(0, nodes.findIndex((n) => n.handle === anc[0]));
    const leftLeg = nodes.slice(0, top).reverse(); // just below the ancestor, down to the first person
    const rightLeg = nodes.slice(top + 1); // just below the ancestor, down to the last person
    const legs = [leftLeg, rightLeg].filter((leg) => leg.length > 0);
    const couple = anc.length === 2 && path.partner !== null;
    const across = Math.max(legs.length, couple ? 2 : 1);
    const centre = PAD + (CARD_W * across + LEG_GAP * (across - 1)) / 2;
    height = PAD * 2 + CARD_H + ROW_H * Math.max(leftLeg.length, rightLeg.length);

    // The ancestor row: one card, or the couple side by side with the legs
    // hanging from the middle of their line, like a family tree's drop line.
    let drop: Point;
    if (couple) {
      const mid = PAD + CARD_H / 2;
      const leftX = centre - LEG_GAP / 2 - CARD_W;
      const rightX = centre + LEG_GAP / 2;
      lines.push([[leftX + CARD_W, mid], [rightX, mid]]);
      rings.push([centre, mid]);
      place(nodes[top], leftX, PAD, true);
      cards.push({ node: path.partner!, label: partnerLabel, kind: "top", x: rightX, y: PAD });
      drop = [centre, mid];
    } else {
      place(nodes[top], centre - CARD_W / 2, PAD, true);
      drop = [centre, PAD + CARD_H];
    }

    // Each leg: a column of cards, the first joined to the ancestor row by
    // an elbow, the rest by straight lines.
    const columns: [PathNode[], number][] =
      legs.length === 2
        ? [
            [leftLeg, centre - LEG_GAP / 2 - CARD_W / 2],
            [rightLeg, centre + LEG_GAP / 2 + CARD_W / 2],
          ]
        : legs.map((leg) => [leg, centre]);
    const elbowY = PAD + CARD_H + ROW_GAP / 2;
    for (const [leg, cx] of columns) {
      lines.push([drop, [drop[0], elbowY], [cx, elbowY], [cx, PAD + ROW_H]]);
      leg.forEach((node, i) => {
        const y = PAD + ROW_H * (i + 1);
        if (i > 0) lines.push([[cx, y - ROW_GAP], [cx, y]]);
        place(node, cx - CARD_W / 2, y);
      });
    }
  }

  // An in-law path: the one who married in sits beside their spouse --
  // on the left when they're the first person, on the right when the last.
  if (via && marriedIn) {
    const spouse = cards.find((c) => c.node.handle === via.handle);
    if (spouse) {
      const onLeft = marriedIn === all[0];
      const x = onLeft ? spouse.x - LEG_GAP - CARD_W : spouse.x + CARD_W + LEG_GAP;
      const mid = spouse.y + CARD_H / 2;
      const gapStart = onLeft ? x + CARD_W : spouse.x + CARD_W;
      lines.push([[gapStart, mid], [gapStart + LEG_GAP, mid]]);
      rings.push([gapStart + LEG_GAP / 2, mid]);
      place(marriedIn, x, spouse.y);
    }
  }

  // Shift everything right if a card landed left of the margin.
  const dx = PAD - Math.min(...cards.map((c) => c.x));
  if (dx !== 0) {
    for (const c of cards) c.x += dx;
    for (const line of lines) for (const p of line) p[0] += dx;
    for (const r of rings) r[0] += dx;
  }
  return { cards, lines, rings, width: Math.max(...cards.map((c) => c.x)) + CARD_W + PAD, height };
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
