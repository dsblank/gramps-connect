// Where gramps-date deliberately shows something other than Gramps, although
// Gramps' own text reads back: Gramps bugs whose output parses but isn't
// what Gramps intends. The tests accept our text for these (it must still
// read back). Each is also listed for reporting upstream.

import { Modifier } from "../types";

export interface DisplayCase {
  lang: string;
  /** Gramps' format number. */
  index: number;
  modifier: Modifier;
  /** Our text and Gramps'. */
  ours: string;
  gramps: string;
}

const BUGS: { why: string; applies: (c: DisplayCase) => boolean }[] = [
  {
    // dd_dformat01 signs a bare year ("-44 B.C.E."): in most languages that
    // doesn't read back, and the BCE marker already says it.
    why: "numeric BCE year shown signed as well as marked",
    applies: ({ ours, gramps }) => /(^|\s)-\d/.test(gramps) && gramps.replace(/(^|\s)-(?=\d)/, "$1") === ours,
  },
  {
    // DateDisplayRU.dd_dformat05 tests hasattr(month, "f") (for "forms"),
    // so a day date never takes the genitive its long-month twin does.
    why: "Russian short-month day dates not inflected (hasattr typo)",
    applies: ({ lang, index }) => lang === "ru" && index === 5,
  },
  {
    // DateDisplaySK.display() predates inflection and never passes the
    // context, so "od január" where sk.po asks for "od januára".
    why: "Slovak display() ignores the from/to inflection its translation sets",
    applies: ({ lang, modifier }) => lang === "sk" && (modifier === Modifier.SPAN || modifier === Modifier.FROM || modifier === Modifier.TO),
  },
];

/** The Gramps bug that explains a display difference, if any. */
export function knownGrampsBug(c: DisplayCase): string | null {
  return BUGS.find((bug) => bug.applies(c))?.why ?? null;
}
