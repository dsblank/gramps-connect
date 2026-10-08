// English -- the one language built in rather than loaded on demand (the
// default, and the fallback for any language not loaded). Strings:
// ./en.generated.ts (Gramps' base DateDisplay/DateParser in an en_US
// locale -- month-first numeric dates). Layouts: Gramps' base ones.

import { strings } from "./en.generated";
import { fromGramps } from "./fromGramps";

export const en = fromGramps(strings, null);
