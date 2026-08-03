// Client-side mirror of exactly the Person fields the table displays:
// gramps_id, surname, given_name, birth.date, death.date, and last changed
// (the `change` secondary column). `birth`/`death` aren't secondary columns
// themselves -- they're relationship-crossing json_path selects
// (Person -> Event via birth_ref_index/death_ref_index), resolved
// server-side into the referenced event's full Date struct (or null if
// none is recorded).

export const CREATE_TABLE_SQL = `
CREATE TABLE person (
  handle TEXT PRIMARY KEY,
  gramps_id TEXT,
  surname TEXT,
  given_name TEXT,
  birth_date TEXT,
  death_date TEXT,
  change INTEGER
);
CREATE INDEX person_surname ON person(surname);
CREATE INDEX person_given_name ON person(given_name);
CREATE INDEX person_gramps_id ON person(gramps_id);
`;

export interface PersonRow {
  handle: string;
  gramps_id: string;
  surname: string;
  given_name: string;
  // JSON-stringified Date struct ({_class, dateval, text, sortval, ...}),
  // or null if this person has no recorded birth/death event.
  birth_date: string | null;
  death_date: string | null;
  change: number;
}

// Mirrors DbGeneric._get_person_data() exactly: given_name comes from
// primary_name.first_name, surname from the first entry in
// primary_name.surname_list. Both fields are derived, not top-level
// scalar schema properties, so they don't come from a generic
// get_secondary_fields()-style loop.
//
// birth_date/death_date stay null here: a flat person-only JSON dump (this
// function's input, used by bench.node.ts's offline benchmark) has no
// event table to resolve event_ref_list[birth_ref_index] against, unlike
// queryItemToRow's input below, where the server already did that
// resolution as part of the query.
export function personToRow(person: any): PersonRow {
  const primaryName = person.primary_name ?? {};
  const surnameList = primaryName.surname_list ?? [];
  return {
    handle: person.handle,
    gramps_id: person.gramps_id ?? "",
    surname: surnameList.length > 0 ? surnameList[0].surname ?? "" : "",
    given_name: primaryName.first_name ?? "",
    birth_date: null,
    death_date: null,
    change: person.change ?? 0,
  };
}

// One item from POST /api/people/query/'s `items` array, requested with
// `select` naming exactly these fields (see browser.ts): flat columns
// (gramps_id, surname, given_name, change) come back as plain scalars;
// birth_date/death_date are json_path selects
// ({"json_path": ["birth", "date"]}), so they come back as the full,
// already-resolved Date struct object (or null), not a string.
export interface PersonQueryItem {
  handle: string;
  gramps_id: string;
  surname: string;
  given_name: string;
  birth_date: unknown | null;
  death_date: unknown | null;
  change: number;
}

export function queryItemToRow(item: PersonQueryItem): PersonRow {
  return {
    ...item,
    birth_date: item.birth_date ? JSON.stringify(item.birth_date) : null,
    death_date: item.death_date ? JSON.stringify(item.death_date) : null,
  };
}
