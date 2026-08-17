Not editable at all

- Media — no dialog exists. It wraps an uploaded file (path/checksum/mime are server-derived from the binary), so there's no "blank form" version of it; only the upload flow (ImportMediaDialog/uploadMedia) creates one, and its desc/tags can only change via the narrow internal report-promotion path (jobsApi.ts's tagAndDescribeMedia), not a user-facing Edit button.

Partially editable, by type

┌────────────┬───────────────────────────────────────┬────────────────────────────────────────────────────────────────────────────┐
│    Type    │                Covered                │                                  Missing                                   │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│            │ given/surname, gender, gramps_id,     │ LDS ordinances: fully read-only, no edit/add/detach at all                 │
│ Person     │ title/suffix/call/nickname, private,  │                                                                            │
│            │ birth & death date + place, alternate │                                                                            │
│            │ names, multiple surnames / surname    │                                                                            │
│            │ prefix-connector-origin, attributes,  │                                                                            │
│            │ addresses, urls, associations (add/   │                                                                            │
│            │ edit rel text/detach)                 │                                                                            │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ Family     │ father, mother, relationship type,    │ LDS ordinances; a child's frel/mrel always defaults to Birth/Birth        │
│            │ private, children (add existing or    │                                                                            │
│            │ brand-new/remove), attributes,        │                                                                            │
│            │ gramps_id                             │                                                                            │
├────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ Event      │ type, description, date, place,       │ —                                                                          │
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
│ Citation   │ source (required), page, date,        │ —                                                                          │
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
Note/Citation/Tag/media item and detach one already attached via a "+"/"×" in that
section's own header/rows in the record's detail pane (RelatedPanel, not the
create/edit dialog). Media's optional visual gallery teaser/link (one thumbnail +
count, handing off to ReferenceDetail's full grid) stays opt-in and thumbnail-light
as before, but the section's actual list is now a plain text-label RefRow list
underneath (same shape as Notes/Citations), which is what makes per-item detach
possible without the hundreds-of-simultaneous-thumbnail-loads problem that list
shape was originally deferred to avoid.

One deliberate scope cut, not an oversight:
- No inline "+ New Note/Citation/Tag" while attaching — existing records only.
  (Family's children now *does* support "+ New Person", the same nested-draft
  pattern its own father/mother slots already had — see below — but that's the
  FamilyEditDialog create/edit dialog itself, not a RelatedPanel attach control
  like this one; the two aren't the same kind of "add," and this cut is about
  the latter specifically.)

Attributes/addresses/urls (Attribute/Address/Url — an inline embedded-object shape,
not a reference to another Gramps object, unlike Note/Citation/Media/Tag's plain
ref-lists) are now directly editable wherever a type carries them: an "Add
attribute"/"Add address"/"Add web link" row-list inside each dialog's own "> Details"
section (EmbeddedListFields.tsx), not through RelatedPanel's attach/detach — there's
no separate record to search for.

Every date field (DateInput.tsx) is now full Gramps-desktop-compatible date
entry, not just year/month/day: a compact quick-entry text field (the primary
entry path, matching Gramps desktop's own MonitoredDate widget) parses free
text -- modifiers, quality, calendar/newyear suffixes, ranges/spans, BCE,
dual-dated slash years, French Republican quarters -- via parse.ts, a port of
gramps' own gen/datehandler/_dateparser.py (English locale only; the
locale.ts DateLocale interface carries what a future non-English locale would
need, but none is populated yet). A "▸ More…" toggle reveals the full
structured editor (modifier/quality/calendar/dual-dated/new-year dropdowns
plus explicit year/month/day, a second row for range/span) for anything the
parser can't express or the user prefers not to type, plus the always-present
"Text comment" annotation field.

Gaps that cut across every type

- No merge for duplicate records.
- GrampsType fields are free text, not dropdowns (Event/Place/Repository/Note's type, Family's relationship type is the one exception with a real dropdown, and now Attribute/Url's own `type` field too) — functionally editable, just no autocomplete/validation against the known list.

The biggest remaining structural gap: no merge tooling for duplicate records, and Media still has no edit dialog at all (see the top of this doc).
