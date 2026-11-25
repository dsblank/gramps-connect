// The look of the Evidence Board, kept apart from everything else so another
// look can be added later (forum feedback asked for a plain one, like the
// first "research canvas" prototype): a skin only draws. What's on the
// board, what each card says, the yarn between cards, and every action are
// the same whatever the skin (EVIDENCE_BOARD_PLAN.md, Phase 3 design note).
import type { ReactNode } from "react";
import type { CardSize } from "../../store/board/caseFile";
import type { GrampsClass } from "../../store/board/records";
import type { Yarn } from "../../store/board/view";

/** What a card says, worked out by the board (store/board/view.ts). */
export interface CardView {
  handle: string;
  cls: GrampsClass;
  title: string;
  subtitle: string;
  /** Extra lines shown at the "expanded" (dossier) size. */
  details: string[];
  size: CardSize;
  /** An event with no citation. */
  unproven: boolean;
  /** A photo with no date. */
  undated: boolean;
  /** Created on this board and not saved yet. */
  draft: boolean;
  /** Changed in the tree since this case was last saved. */
  updated: boolean;
  /** A photo to show: the media record and, for a person, the region of
   * it that is their face ([l, t, r, b] percent). */
  photo: { media: string; rect: number[] | null } | null;
}

/** A card's outline, relative to its pin (0, 0). */
export interface CardBox {
  w: number;
  h: number;
  x0: number;
  y0: number;
}

export interface YarnDrawing {
  yarn: Yarn;
  /** The yarn's path through its sag. */
  d: string;
  /** Midpoint, where its tag hangs. */
  mx: number;
  my: number;
  selected: boolean;
  /** Added on this board and not saved yet. */
  isNew: boolean;
  /** Snipped on this board and not saved yet: drawn cut, ends dangling. */
  cut: boolean;
  showTag: boolean;
  /** For a cut piece: its two ends, which dangle from each pin. */
  ends?: { x1: number; y1: number; x2: number; y2: number };
}

export interface BoardSkin {
  key: string;
  /** Class on the board's root element (the skin's colours and fonts). */
  className: string;
  cardBox(view: CardView): CardBox;
  /** Drawn inside the card's swinging group, origin at the pin. */
  renderCard(view: CardView, box: CardBox, opts: { selected: boolean; photoUrl: string | null }): ReactNode;
  /** Drawn above the yarn, not swinging, origin at the pin. */
  renderPin(view: CardView): ReactNode;
  /** One piece of yarn. Paths that wobble must carry class "yp", the tag
   * group class "ytag" (physics.ts moves them). */
  renderYarn(drawing: YarnDrawing): ReactNode;
  /** <defs> and the background, in board coordinates. */
  renderBackground(): ReactNode;
  /** Drawn over the background but under the cards, fixed to the screen
   * (not panned or zoomed): light and shade on the board itself. */
  renderLighting?(): ReactNode;
  /** The yarn being pulled from a pin to the pointer. */
  renderPull(d: string): ReactNode;
}
