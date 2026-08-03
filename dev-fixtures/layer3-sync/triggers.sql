-- Layer 3: pg_notify trigger on the *real* SharedPostgreSQL person table
-- (the "gramps" database, matching the original layer0-notify-spike's
-- schema.sql exactly -- since removed, see git history). Applied after
-- data import finishes, deliberately, so the bulk
-- import itself (2157 INSERTs) doesn't generate a burst of notifications
-- with nothing yet listening -- Person view only for this first pass, per
-- the scoping decision (see PLAN.md's Layer 3 section once updated).

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

DROP TRIGGER IF EXISTS person_notify_change ON person;
CREATE TRIGGER person_notify_change
AFTER INSERT OR UPDATE OR DELETE ON person
FOR EACH ROW EXECUTE FUNCTION notify_tree_change();
