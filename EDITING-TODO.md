Not editable at all

- Media — no dialog exists. It wraps an uploaded file (path/checksum/mime are server-derived from the binary), so there's no "blank form" version of it; only the upload flow (ImportMediaDialog/uploadMedia) creates one, and its desc/tags can only change via the narrow internal report-promotion path (jobsApi.ts's tagAndDescribeMedia), not a user-facing Edit button.

Partially editable, by type

┌────────────┬───────────────────────────────────────┬────────────────────────────────────────────────────────────────────────────┐
│    Type    │                Covered                │                                  Missing                                   │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│            │ given/surname, gender,                │ alternate names, birth/death event's place/description/other fields, any   │
│ Person     │ title/suffix/call/nickname, private,  │ other event (marriage, occupation, ...), associations, addresses, urls,    │
│            │ birth & death date                    │ media, citations, notes, attributes, tags, LDS ordinances, multiple        │
│            │                                       │ surnames / surname prefix-connector-origin, gramps_id                      │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ Family     │ father, mother, relationship type,    │ any event (marriage, divorce, ...), attributes, citations, notes, media,   │
│            │ private, children (add/remove         │ tags, LDS ordinances, gramps_id; a child's frel/mrel always defaults to    │
│            │ existing only)                        │ Birth/Birth, and attaching a brand-new (not-yet-saved) Person as a child   │
│            │                                       │ isn't supported, only an existing one                                      │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ Event      │ type, description, date, place,       │ citations, notes, media, attributes, tags, gramps_id; date is              │
│            │ private                               │ year/month/day only                                                        │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│            │ name, type, latitude, longitude,      │ enclosing/parent place hierarchy, alternate names, historical locations,   │
│ Place      │ private                               │ urls, media, citations, notes, tags, code, name's own language/date,       │
│            │                                       │ gramps_id                                                                  │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ Repository │ name, type, private                   │ addresses, urls, notes, tags, gramps_id                                    │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ Source     │ title, author, publication info,      │ repository links (can't attach a Source to where it's held), media, notes, │
│            │ abbreviation, private                 │  attributes, tags, gramps_id                                               │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ Citation   │ source (required), page, date,        │ media, notes, attributes, tags, gramps_id; date is year/month/day only     │
│            │ confidence, private                   │                                                                            │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ Note       │ text, type, private                   │ text formatting/links (plain text only), format (Flowed/Formatted), tags,  │
│            │                                       │ gramps_id                                                                  │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ Tag        │ name, color, priority                 │ — this is the one type with nothing left; Tag's whole schema is covered    │
└────────────┴───────────────────────────────────────┴────────────────────────────────────────────────────────────────────────────┘

Gaps that cut across every type

- No reference-list editing anywhere — citations, notes, media, attributes, addresses, urls, and tags can't be attached to any object through these dialogs, only viewed.
- No merge for duplicate records.
- gramps_id is never user-editable (always server-assigned).
- Dates only support a plain year/month/day — no BEFORE/AFTER/ABOUT modifiers, ranges/spans, non-Gregorian calendars, or estimated/calculated quality.
- GrampsType fields are free text, not dropdowns (Event/Place/Repository/Note's type, Family's relationship type is the one exception with a real dropdown) — functionally editable, just no autocomplete/validation against the known list.

The biggest remaining structural gap: nothing can attach a Note/Citation/Media/Tag to a record — that's the feature that would unblock the most everyday editing next.
