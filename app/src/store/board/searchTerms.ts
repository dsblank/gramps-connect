// External Search terms for a person on the Evidence Board. The board
// holds Gramps' own record form, with changes that may not be saved yet
// (a corrected name, a new birth event), so the terms come from its
// records first and from the app's caches only for what it doesn't hold.
import { searchTermsFor, type SearchTerms } from "../externalSearch";
import type { EventLookup } from "../lifeEventDates";
import type { ObjectDetail } from "../objectDetail";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { titleOf } from "./view";
import type { Records } from "./records";

export function boardSearchTerms(person: string, records: Records): SearchTerms {
  const lookup: EventLookup = (handle) => {
    const event = records[handle];
    if (event?._class !== "Event") return undefined;
    const place = (event.place as string) || null;
    return {
      date: (event.date as GrampsDate | null) ?? null,
      type: (event.type as { value?: number } | undefined)?.value ?? null,
      place,
      placeTitle: place && records[place] ? titleOf(place, records) : undefined,
    };
  };
  return searchTermsFor(records[person] as unknown as ObjectDetail, lookup);
}
