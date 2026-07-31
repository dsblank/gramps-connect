-- Layer 0 spike schema: minimal slice of SharedPostgreSQL's schema
-- (trees + person only), mirroring shareddbapi.py's _create_schema()
-- and _create_secondary_columns(), plus pg_notify triggers.

CREATE TABLE trees (
    treeid INTEGER PRIMARY KEY,
    uuid VARCHAR(50) UNIQUE NOT NULL
);

CREATE TABLE person (
    treeid INTEGER NOT NULL,
    handle VARCHAR(50) NOT NULL,
    PRIMARY KEY (treeid, handle),
    given_name TEXT,
    surname TEXT,
    json_data TEXT
);

-- Secondary columns, matching Person.get_secondary_fields() in
-- gramps/gen/lib/person.py (top-level scalar schema properties).
ALTER TABLE person ADD COLUMN gramps_id TEXT;
ALTER TABLE person ADD COLUMN gender INTEGER;
ALTER TABLE person ADD COLUMN death_ref_index INTEGER;
ALTER TABLE person ADD COLUMN birth_ref_index INTEGER;
ALTER TABLE person ADD COLUMN change INTEGER;
ALTER TABLE person ADD COLUMN private INTEGER;

CREATE INDEX person_gramps_id ON person(treeid, gramps_id);
CREATE INDEX person_surname ON person(treeid, surname);
CREATE INDEX person_given_name ON person(treeid, given_name);

-- Trigger: on any person write, notify with a thin JSON payload
-- {treeid, table, handle, op}. Well under NOTIFY's 8000-byte cap.
CREATE OR REPLACE FUNCTION notify_tree_change() RETURNS TRIGGER AS $$
DECLARE
    rec RECORD;
    payload JSON;
BEGIN
    IF TG_OP = 'DELETE' THEN
        rec := OLD;
    ELSE
        rec := NEW;
    END IF;

    payload := json_build_object(
        'treeid', rec.treeid,
        'table', TG_TABLE_NAME,
        'handle', rec.handle,
        'op', TG_OP
    );

    PERFORM pg_notify('tree_changes', payload::text);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER person_notify_change
AFTER INSERT OR UPDATE OR DELETE ON person
FOR EACH ROW EXECUTE FUNCTION notify_tree_change();

-- Seed one tree so person rows have a valid treeid to reference.
INSERT INTO trees (treeid, uuid) VALUES (1, '00000000-0000-0000-0000-000000000001');
