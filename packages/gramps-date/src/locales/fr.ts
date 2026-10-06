// French. Strings: ./fr.generated.ts. Layouts: Gramps' DateDisplayFR
// (gen/datehandler/_date_fr.py) -- nine formats: day-first with and
// without a dot after the day, month-first at 6/7, and numeric ones that
// fall back to ISO for BCE and dual (slash) years.

import { BASE_LAYOUTS } from "../layouts";
import { DateFormat } from "../formats";
import { frStrings } from "./fr.generated";
import { fromGramps } from "./fromGramps";

export const fr = fromGramps(frStrings, {
  gregorianLayouts: [
    BASE_LAYOUTS[0],
    { kind: "numeric", pad: false, isoWhenBce: true },
    { kind: "text", order: "dmy", months: "long", dayDot: false },
    { kind: "text", order: "dmy", months: "short", dayDot: false },
    { kind: "text", order: "dmy", months: "long", dayDot: true },
    { kind: "text", order: "dmy", months: "short", dayDot: true },
    BASE_LAYOUTS[2],
    BASE_LAYOUTS[3],
    { kind: "numeric", pad: true, isoWhenBce: true },
  ],
  formatIndex: {
    [DateFormat.ISO]: 0,
    [DateFormat.NUMERIC]: 1,
    [DateFormat.LONG_MONTH_DAY_YEAR]: 6,
    [DateFormat.SHORT_MONTH_DAY_YEAR]: 7,
    [DateFormat.DAY_LONG_MONTH_YEAR]: 2,
    [DateFormat.DAY_SHORT_MONTH_YEAR]: 3,
  },
});
