// German. Strings: ./de.generated.ts. Layouts: Gramps' DateDisplayDE
// (gen/datehandler/_date_de.py) -- "Tag. Monat Jahr" with a dot after the
// day, a numeric format that keeps a zero day ("0.3.1854") and the signed
// year, and format 6, numeric with leading zeros.

import { BASE_LAYOUTS } from "../layouts";
import { DateFormat } from "../formats";
import { deStrings } from "./de.generated";
import { fromGramps } from "./fromGramps";

export const de = fromGramps(deStrings, {
  gregorianLayouts: [
    BASE_LAYOUTS[0],
    { kind: "numeric", pad: false, isoWhenBce: false },
    BASE_LAYOUTS[2],
    BASE_LAYOUTS[3],
    { kind: "text", order: "dmy", months: "long", dayDot: true },
    { kind: "text", order: "dmy", months: "short", dayDot: true },
    { kind: "numeric", pad: true, isoWhenBce: false },
  ],
  formatIndex: {
    [DateFormat.ISO]: 0,
    [DateFormat.NUMERIC]: 1,
    [DateFormat.LONG_MONTH_DAY_YEAR]: 2,
    [DateFormat.SHORT_MONTH_DAY_YEAR]: 3,
    [DateFormat.DAY_LONG_MONTH_YEAR]: 4,
    [DateFormat.DAY_SHORT_MONTH_YEAR]: 5,
  },
});
