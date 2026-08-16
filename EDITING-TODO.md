Not editable at all

- Media — no dialog exists. It wraps an uploaded file (path/checksum/mime are server-derived from the binary), so there's no "blank form" version of it; only the upload flow (ImportMediaDialog/uploadMedia) creates one, and its desc/tags can only change via the narrow internal report-promotion path (jobsApi.ts's tagAndDescribeMedia), not a user-facing Edit button.

Partially editable, by type

┌────────────┬───────────────────────────────────────┬────────────────────────────────────────────────────────────────────────────┐
│    Type    │                Covered                │                                  Missing                                   │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│            │ given/surname, gender, gramps_id,     │ birth/death event's description/other fields (place is now covered);       │
│ Person     │ title/suffix/call/nickname, private,  │ associations, LDS ordinances                                               │
│            │ birth & death date + place, alternate │                                                                            │
│            │ names, multiple surnames / surname    │                                                                            │
│            │ prefix-connector-origin, attributes,  │                                                                            │
│            │ addresses, urls                       │                                                                            │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ Family     │ father, mother, relationship type,    │ LDS ordinances; a child's frel/mrel always defaults to Birth/Birth, and    │
│            │ private, children (add/remove         │ attaching a brand-new (not-yet-saved) Person as a child isn't supported,   │
│            │ existing only), attributes, gramps_id │ only an existing one                                                       │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ Event      │ type, description, date, place,       │ date is year/month/day only                                                │
│            │ private, attributes, gramps_id        │                                                                            │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│            │ name, type, latitude, longitude,      │ enclosing/parent place hierarchy, alternate names, historical locations,   │
│ Place      │ private, urls, gramps_id              │ code, name's own language/date                                             │
│            │                                       │                                                                            │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ Repository │ name, type, private, addresses, urls, │ — nothing left; Repository's whole schema is covered                       │
│            │ gramps_id                             │                                                                            │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ Source     │ title, author, publication info,      │ repository links (can't attach a Source to where it's held)                │
│            │ abbreviation, private, attributes,    │                                                                            │
│            │ gramps_id                             │                                                                            │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ Citation   │ source (required), page, date,        │ date is year/month/day only                                                │
│            │ confidence, private, attributes,      │                                                                            │
│            │ gramps_id                             │                                                                            │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ Note       │ text, type, private, gramps_id        │ text formatting/links (plain text only), format (Flowed/Formatted)         │
│            │                                       │                                                                            │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ Tag        │ name, color, priority                 │ — this is the one type with nothing left; Tag's whole schema is covered    │
└────────────┴───────────────────────────────────────┴────────────────────────────────────────────────────────────────────────────┘

Person and Family also gained a "+ New Event" in their Events section (RelatedPanel,
not the create/edit dialog) -- EventCreateDialog.tsx creates a brand-new Event
(type/description/date/place/role/private) and links it via EventRef, covering any
event beyond birth/death (marriage, occupation, ...) without needing a separate
"create the Event, then attach it" round trip. Person's birth/death Event place
(and any Event-typed reference field's Place, e.g. Event's own "place" in the
generic ObjectEditDialog) can now be created or edited inline via a reusable
stacked dialog (PlaceEditDialog.tsx / EventPlaceField.tsx) rather than needing a
separate trip to the Places view first.

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

Attributes/addresses/urls (Attribute/Address/Url — an inline embedded-object shape,
not a reference to another Gramps object, unlike Note/Citation/Media/Tag's plain
ref-lists) are now directly editable wherever a type carries them: an "Add
attribute"/"Add address"/"Add web link" row-list inside each dialog's own "> Details"
section (EmbeddedListFields.tsx), not through RelatedPanel's attach/detach — there's
no separate record to search for.

Gaps that cut across every type

- No merge for duplicate records.
- Dates only support a plain year/month/day — no BEFORE/AFTER/ABOUT modifiers, ranges/spans, non-Gregorian calendars, or estimated/calculated quality.
- GrampsType fields are free text, not dropdowns (Event/Place/Repository/Note's type, Family's relationship type is the one exception with a real dropdown, and now Attribute/Url's own `type` field too) — functionally editable, just no autocomplete/validation against the known list.

The biggest remaining structural gap: no merge tooling for duplicate records, and Media still has no edit dialog at all (see the top of this doc).
