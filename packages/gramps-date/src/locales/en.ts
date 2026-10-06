// English. Strings: ./en.generated.ts (Gramps' base DateDisplay/DateParser
// in an en_US locale -- month-first numeric dates, "%m/%d/%Y"). Layouts:
// Gramps' base ones.

import { BASE_LAYOUTS } from "../layouts";
import { enStrings } from "./en.generated";
import { fromGramps, IDENTITY_FORMAT_INDEX } from "./fromGramps";

export const en = fromGramps(enStrings, { gregorianLayouts: BASE_LAYOUTS, formatIndex: IDENTITY_FORMAT_INDEX });
