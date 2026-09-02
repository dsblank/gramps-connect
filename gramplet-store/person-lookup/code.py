# =============================================================================
# 02 - Person Lookup, by Gramps ID
# =============================================================================
# Looks up one specific person by their Gramps ID (the "I0001"-style id
# shown in the first column of the People list) and walks their events by
# hand -- the pattern to reach for whenever you need one record's full
# detail rather than a table of many.
#
# Demonstrates:
#   - db.get_person_from_gramps_id() / db.get_person_from_handle()
#   - a REAL gramps.gen.lib.Person object (not just a DataDict) -- the
#     same object type and methods Gramps Desktop addons use
#   - walking a relationship by hand (event_ref_list -> db.get_event_from_
#     handle) when you need more than filter()'s built-in birth/death
#     shortcuts give you
#   - importing gramps.gen.lib directly, for its Person.MALE/FEMALE/...
#     constants
# =============================================================================

# Change this to a real Gramps ID in your own tree before running.
GRAMPS_ID = "I0001"

# db is a single shared object with one method per record type, named and
# shaped after Gramps Desktop's own DbReadBase (gramps/gen/db/generic.py)
# -- if you already know that API, this is the same shape. `db.get_person_
# from_gramps_id(...)` returns a real gramps.gen.lib.Person object, not a
# lightweight DataDict -- see db.get_raw_person_data() (used internally by
# people()) if you just want fields, not real methods.
person = db.get_person_from_gramps_id(GRAMPS_ID)

if person is None:
    print(f"No person found with Gramps ID {GRAMPS_ID!r}.")
else:
    # A real gramps.gen.lib.Person's fields are plain attributes -- no
    # get_primary_name()-style boilerplate needed, though those methods
    # exist too if you're used to them from Desktop addon code.
    name = person.primary_name
    full_name = f"{name.first_name} {' '.join(s.surname for s in name.surname_list)}".strip()

    # gramps.gen.lib is the real Gramps library -- the same one Gramps
    # Desktop itself is built on. Its Person class defines the MALE/
    # FEMALE/UNKNOWN/OTHER constants person.gender is one of.
    from gramps.gen.lib import Person

    gender_label = {
        Person.MALE: "Male",
        Person.FEMALE: "Female",
        Person.OTHER: "Other",
    }.get(person.gender, "Unknown")

    html(f"<h3>{full_name}</h3>")
    print("Gramps ID:", person.gramps_id)
    print("Gender:", gender_label)

    # event_ref_list holds EventRef objects -- each just a handle (.ref)
    # plus a role (.role, e.g. "Primary"), not the event itself. This is
    # exactly the "handle, look it up yourself" indirection Gramps Desktop
    # uses internally too. filter()'s own where= clause can jump straight
    # to birth/death for a *query* (see 07_relationship_queries.py) --
    # this is the by-hand equivalent for a single record you already have,
    # covering every event, not just birth/death.
    set_column_titles("Role", "Type", "Date", "Place")
    for event_ref in person.event_ref_list:
        event = db.get_event_from_handle(event_ref.ref)
        place = db.get_place_from_handle(event.place) if event.place else None
        row(str(event_ref.role), str(event.type), event.date, place)
