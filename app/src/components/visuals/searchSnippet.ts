// The detail line(s) under each SearchView result's title -- the
// Google-results-page "snippet". Built mostly off `hit.object.profile`
// (searchApi.ts's fetchSearch always sends profile=all). The exception is
// dates and event places: the profile's strings are formatted with the
// *server's* Gramps preferences, so those are re-derived from the raw
// object (and the Events/Places caches) per the tree's display settings,
// falling back to the profile's text when the caches can't answer. Six of the ten
// object types get a `profile` at all (person/family/event/citation/
// place/media, confirmed against SearchResource.get_object_from_handle in
// gramps-web-api's resources/search.py); the other four (repository/
// source/note/tag) fall back to their own raw fields, same ones
// summary.ts's summaryText() already reads for their titles.
import { lifeEventDate, lifeEventPlace } from "../../store/lifeEventDates";
import { displayPlaceTitle, formatDisplayDate } from "../../store/placeIndex";

function joinNonEmpty(parts: (string | null | undefined | false)[], sep = " · "): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(sep);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// Citation.CONF_* in gramps/gen/lib/citation.py -- 0..4, Very Low..Very
// High. Gramps' own confidence scale, not something this app invents.
const CONFIDENCE_LABELS = ["Very Low", "Low", "Normal", "High", "Very High"];

/** The spouse in a person's own primary family: whichever of
 * father/mother isn't this person, by gramps_id (profile people don't
 * carry a "which one is me" flag, so identity is the only way to tell
 * them apart). Undefined for an unmarried person, a family with only one
 * resolved parent, or before the person's own gramps_id is known. */
function spouseName(profile: any): string | undefined {
  const family = profile?.families?.[0];
  if (!family) return undefined;
  const other = [family.father, family.mother].find(
    (p: any) => p && p.gramps_id !== profile.gramps_id
  );
  return other?.name_display;
}

/** Returns the snippet as separate lines -- callers render one <Text> per
 * line rather than joining them, so a multi-part snippet wraps as short
 * lines instead of one long one. Empty array means "nothing worth
 * showing", not an error -- e.g. an event with no date and no place
 * recorded, or a source with neither author nor pubinfo filled in. */
export function snippetFor(objectType: string, obj: any): string[] {
  const profile = obj?.profile;
  switch (objectType) {
    case "person": {
      // Dates/places per the tree's display settings (lifeEvent*), falling
      // back to the profile's server-formatted text when the Events cache
      // can't answer.
      const birthPlace = lifeEventPlace(obj, "birth");
      const deathPlace = lifeEventPlace(obj, "death");
      const born = joinNonEmpty([lifeEventDate(obj, "birth"), birthPlace && `in ${birthPlace}`], " ");
      const died = joinNonEmpty([lifeEventDate(obj, "death"), deathPlace && `in ${deathPlace}`], " ");
      const spouse = spouseName(profile);
      return [
        born && `Born ${born}`,
        died && `Died ${died}`,
        spouse && `Spouse: ${spouse}`,
      ].filter((l): l is string => Boolean(l));
    }
    case "family": {
      const parents = joinNonEmpty([profile?.father?.name_display, profile?.mother?.name_display], " & ");
      const children = Array.isArray(profile?.children) && profile.children.length > 0
        ? `${profile.children.length} ${profile.children.length === 1 ? "child" : "children"}`
        : "";
      const marriagePlace = lifeEventPlace(obj, "marriage");
      const marriage = joinNonEmpty([lifeEventDate(obj, "marriage"), marriagePlace && `in ${marriagePlace}`], " ");
      const second = joinNonEmpty([marriage && `Married ${marriage}`, children]);
      return [parents, second].filter((l): l is string => Boolean(l));
    }
    case "event": {
      // The hit is the raw Event itself: its own date and place handle.
      const date = obj?.date ? formatDisplayDate(obj.date) : profile?.date;
      const place = (obj?.place && displayPlaceTitle(obj.place, obj.date)) || profile?.place;
      const line = joinNonEmpty([date, place && `at ${place}`], " ");
      const people: string[] = Array.isArray(profile?.participants?.people)
        ? profile.participants.people.map((p: any) => p?.person?.name_display).filter(Boolean)
        : [];
      const withLine = people.length > 0 ? `With: ${people.slice(0, 3).join(", ")}` : "";
      return [line, withLine].filter((l): l is string => Boolean(l));
    }
    case "place": {
      const parents: string[] = Array.isArray(profile?.parent_places)
        ? profile.parent_places.map((p: any) => p?.name).filter(Boolean)
        : [];
      const breadcrumb = parents.length > 0 ? [profile?.name, ...parents].filter(Boolean).join(" › ") : "";
      const type = obj?.place_type && obj.place_type !== "Unknown" ? obj.place_type : "";
      const coords = obj?.lat && obj?.long ? `${obj.lat}, ${obj.long}` : "";
      const second = joinNonEmpty([type, coords]);
      return [breadcrumb, second].filter((l): l is string => Boolean(l));
    }
    case "repository": {
      const address = obj?.address_list?.[0];
      const addressLine = address
        ? joinNonEmpty([address.city, address.state, address.country], ", ")
        : "";
      const line = joinNonEmpty([obj?.type, obj?.urls?.[0]?.path]);
      return [line, addressLine].filter((l): l is string => Boolean(l));
    }
    case "source": {
      const line = joinNonEmpty([obj?.author, obj?.pubinfo]);
      const abbrev = obj?.abbrev ? `(${obj.abbrev})` : "";
      return [line, abbrev].filter((l): l is string => Boolean(l));
    }
    case "citation": {
      const line = joinNonEmpty([profile?.source?.title, profile?.page && `p. ${profile.page}`, profile?.date]);
      const confidence = typeof obj?.confidence === "number" ? CONFIDENCE_LABELS[obj.confidence] : undefined;
      return [line, confidence && `Confidence: ${confidence}`].filter((l): l is string => Boolean(l));
    }
    case "media": {
      const line = joinNonEmpty([obj?.mime, profile?.date]);
      return [line, obj?.path].filter((l): l is string => Boolean(l));
    }
    case "note": {
      // Unlike every other type, a Note's own "title" (summaryLine's 60-
      // char truncation) *is* its content -- so the snippet re-truncates
      // the same text.string at a longer length rather than showing
      // something else, the same way a Google result's title and snippet
      // both come from the same page.
      const text = obj?.text?.string ?? "";
      return [text && truncate(text, 220), obj?.type].filter((l): l is string => Boolean(l));
    }
    case "tag":
      return typeof obj?.priority === "number" ? [`Priority ${obj.priority}`] : [];
    default:
      return [];
  }
}
