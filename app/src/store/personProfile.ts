// Fetches gramps-web-api's pre-formatted Person "profile" -- display-ready
// name/date/place strings and a father/mother/children family tree, all
// computed server-side (see get_person_profile_for_object in
// gramps-web-api's resources/util.py) -- rather than reassembling that
// from the row data already cached locally, which only carries the flat
// columns DataTable shows (see views.ts's PERSON_VIEW.columns).
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";

export interface EventProfile {
  type?: string;
  date?: string;
  place?: string;
  place_name?: string;
  summary?: string;
}

export interface FamilyProfile {
  handle: string;
  gramps_id: string;
  // Empty ({}), not absent, when a family has no father/mother -- see
  // hasPerson() in PersonDetail.tsx.
  father?: PersonProfile;
  mother?: PersonProfile;
  relationship: string;
  marriage?: EventProfile;
  divorce?: EventProfile;
  children: PersonProfile[];
  family_surname: string;
}

export interface PersonProfile {
  handle: string;
  gramps_id: string;
  sex: "M" | "F" | "U" | "X";
  birth?: EventProfile;
  death?: EventProfile;
  name_given: string;
  name_surname: string;
  name_display: string;
  name_suffix: string;
  // Only present on the top-level fetched person, not on father/mother/
  // children entries nested inside a FamilyProfile (the server only
  // recurses one level -- see PersonResourceHelper.object_extend).
  primary_parent_family?: FamilyProfile;
  other_parent_families?: FamilyProfile[];
  families?: FamilyProfile[];
}

/** GET /api/people/<handle> (note: no trailing slash -- unlike the
 * .../query/ list endpoint's route, gramps-web-api registers this one
 * without one; a trailing slash 404s). */
export async function fetchPersonDetail(token: string, handle: string): Promise<PersonProfile> {
  const res = await fetch(`${API_BASE}/api/people/${encodeURIComponent(handle)}?profile=all`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await parseErrorMessage(res));
  }
  const data = await res.json();
  return data.profile as PersonProfile;
}

/** The subset of a Person's own (unprofiled) fields needed to resolve
 * which Event a "birth"/"death" line actually points at -- the `profile`
 * shortcuts (birth/death above) are display-ready strings with no handle
 * attached, so a click needs this separate, plain-object fetch. */
export interface PersonEventRefs {
  birthRefIndex: number;
  deathRefIndex: number;
  eventRefList: { ref: string }[];
}

export async function fetchPersonEventRefs(token: string, handle: string): Promise<PersonEventRefs> {
  const res = await fetch(`${API_BASE}/api/people/${encodeURIComponent(handle)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await parseErrorMessage(res));
  }
  const data = await res.json();
  return {
    birthRefIndex: data.birth_ref_index,
    deathRefIndex: data.death_ref_index,
    eventRefList: data.event_ref_list,
  };
}

/** `Person.get_birth_ref()`/`get_death_ref()`'s own logic (see gramps
 * core's person.py): a plain index lookup into event_ref_list, valid only
 * when the index is in range. A person with no *explicit* birth/death
 * event (index -1) falls back, server-side, to searching their other
 * events for a birth/death-like stand-in (a baptism, a burial, ...) --
 * that fallback isn't replicated here, so such a line just isn't
 * clickable rather than risking a jump to the wrong event. */
export function resolveEventHandle(refs: PersonEventRefs, kind: "birth" | "death"): string | null {
  const index = kind === "birth" ? refs.birthRefIndex : refs.deathRefIndex;
  if (index < 0 || index >= refs.eventRefList.length) return null;
  return refs.eventRefList[index].ref;
}
