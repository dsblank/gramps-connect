// Spanish. Strings: ./es.generated.ts. Layouts: Gramps' base ones --
// DateDisplayES only overrides the range/span wording, which the generated
// templates already carry.

import { BASE_LAYOUTS } from "../layouts";
import { esStrings } from "./es.generated";
import { fromGramps, IDENTITY_FORMAT_INDEX } from "./fromGramps";

export const es = fromGramps(esStrings, { gregorianLayouts: BASE_LAYOUTS, formatIndex: IDENTITY_FORMAT_INDEX });
