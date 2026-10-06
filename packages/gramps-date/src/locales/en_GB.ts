// British English. Strings: ./en_GB.generated.ts (Gramps' DateDisplayGB --
// day-first numeric dates, "%d/%m/%Y"). Layouts: Gramps' base ones.

import { BASE_LAYOUTS } from "../layouts";
import { en_GBStrings } from "./en_GB.generated";
import { fromGramps, IDENTITY_FORMAT_INDEX } from "./fromGramps";

export const en_GB = fromGramps(en_GBStrings, { gregorianLayouts: BASE_LAYOUTS, formatIndex: IDENTITY_FORMAT_INDEX });
