Not editable at all

- Media — no dialog exists. It wraps an uploaded file (path/checksum/mime are server-derived from the binary), so there's no "blank form" version of it; only the upload flow (ImportMediaDialog/uploadMedia) creates one, and its desc/tags can only change via the narrow internal report-promotion path (jobsApi.ts's tagAndDescribeMedia), not a user-facing Edit button.

Partially editable, by type

┌────────────┬───────────────────────────────────────┬────────────────────────────────────────────────────────────────────────────┐
│    Type    │                Covered                │                                  Missing                                   │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│            │ given/surname, gender,                │ alternate names, birth/death event's place/description/other fields, any   │
│ Person     │ title/suffix/call/nickname, private,  │ other event (marriage, occupation, ...), associations, addresses, urls,    │
│            │ birth & death date                    │ attributes, LDS ordinances, multiple surnames / surname                    │
│            │                                       │ prefix-connector-origin, gramps_id                                          │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ Family     │ father, mother, relationship type,    │ any event (marriage, divorce, ...), attributes, LDS ordinances, gramps_id; │
│            │ private, children (add/remove         │ a child's frel/mrel always defaults to Birth/Birth, and attaching a        │
│            │ existing only)                        │ brand-new (not-yet-saved) Person as a child isn't supported, only an       │
│            │                                       │ existing one                                                               │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ Event      │ type, description, date, place,       │ attributes, gramps_id; date is year/month/day only                        │
│            │ private                               │                                                                            │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│            │ name, type, latitude, longitude,      │ enclosing/parent place hierarchy, alternate names, historical locations,   │
│ Place      │ private                               │ code, name's own language/date, gramps_id                                  │
│            │                                       │                                                                            │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ Repository │ name, type, private                   │ addresses, urls, gramps_id                                                 │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ Source     │ title, author, publication info,      │ repository links (can't attach a Source to where it's held), attributes,   │
│            │ abbreviation, private                 │ gramps_id                                                                  │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ Citation   │ source (required), page, date,        │ attributes, gramps_id; date is year/month/day only                        │
│            │ confidence, private                   │                                                                            │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ Note       │ text, type, private                   │ text formatting/links (plain text only), format (Flowed/Formatted),        │
│            │                                       │ gramps_id                                                                  │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ Tag        │ name, color, priority                 │ — this is the one type with nothing left; Tag's whole schema is covered    │
└────────────┴───────────────────────────────────────┴────────────────────────────────────────────────────────────────────────────┘

Every type RELATED_CONFIG lists a Notes/Citations/Media/Tags section for (that's
nearly all of them — see components/related/config.ts) can now attach an existing
Note/Citation/Tag and detach one already attached via a "+"/"×" in that section's
own header/rows in the record's detail pane (RelatedPanel, not the create/edit
dialog); Media is attach-only there, no per-item detach yet. Two deliberate scope
cuts, not oversights:
- No inline "+ New Note/Citation/Tag" while attaching — existing records only, same
  precedent as Family's children (mixed create+edit stays deferred everywhere).
- Media has no per-item detach yet — its section renders as a compact gallery
  teaser (one thumbnail + count), not a per-item list, specifically to avoid
  hundreds of simultaneous thumbnail loads; adding detach means restructuring that
  into a real per-item list first.

Gaps that cut across every type

- Attributes/addresses/urls still can't be attached/edited anywhere (a different,
  embedded-object shape than Note/Citation/Media/Tag's plain ref-lists, so the
  attach/detach mechanism above doesn't cover them).
- No merge for duplicate records.
- gramps_id is never user-editable (always server-assigned).
- Dates only support a plain year/month/day — no BEFORE/AFTER/ABOUT modifiers, ranges/spans, non-Gregorian calendars, or estimated/calculated quality.
- GrampsType fields are free text, not dropdowns (Event/Place/Repository/Note's type, Family's relationship type is the one exception with a real dropdown) — functionally editable, just no autocomplete/validation against the known list.

The biggest remaining structural gap: attributes/addresses/urls can't be attached to a record through these dialogs at all yet.
