# GOQL built-in preset tests

Behavioral-equivalence tests for every built-in filter preset in
`app/src/data/gqlFilterPresets.ts` -- proving each one is both valid GOQL
*and* semantically matches the real gramps-core `Rule` class it's meant
to port, not just that it compiles.

## Why this exists

A preset can be syntactically valid GOQL and still be wrong in a way
that's easy to miss by eye. Two real bugs this suite caught while being
built:

- `has-nickname` referenced `primary_name.nick_name`, a field that
  doesn't exist (the real field is `nick`) -- a compile error.
- `incomplete-events`/`families-incomplete-events` checked
  `place is None`, but an unset `Event.place` is `''` at runtime, never
  `None` -- this compiled fine and silently matched **zero rows**
  instead of the correct set, for as long as the preset existed.

The second bug is the scarier class: nothing about it looks wrong
without actually running it against real data and a real gramps-core
`Rule` to compare against.

## How it works

For each preset, in `test_gql_presets.py`:

1. Compile the preset's `expr` (`gramps_object_query_language
   .query_lang.compile_expr`) -- a static, schema-checked compile with no
   database/server involved.
2. Evaluate the compiled AST directly against every object of that type
   in a real Gramps database (`gramps_object_query_language.evaluator
   .evaluate_where` -- a pure-Python walk against real objects, no SQL).
3. Separately instantiate the *real* gramps-core `Rule` subclass the
   preset is meant to port and run its own `apply_to_one()` against the
   same objects.
4. Assert the two resulting handle sets are identical.

The database is gramps-core's own bundled `example.gramps` fixture
(2128 people) -- the exact same one gramps-core's own
`gramps/gen/filters/rules/test/*_rules_test.py` suite already uses to
test these same rule classes, loaded via
`gramps.gen.db.utils.import_as_dict`.

Each preset gets its own small, explicit test function (never a generic
loop over the whole catalog) -- a failure names exactly which preset and
which gramps-core `Rule` class it stopped matching, and a few presets
(the year-range pair, the Family-namespace reformulation, the
`supported: false` set) each need a slightly different comparison a
single generic loop couldn't express cleanly anyway.

## Running

```
pytest tests/
```

That's the only command needed -- `conftest.py`'s `presets` fixture
automatically (re)runs `npm run export:gql-presets` (from `app/`)
whenever `gql_presets.generated.json` is missing or older than
`gqlFilterPresets.ts`, so the JSON export never has to be a manual step.
The JSON itself is gitignored: `gqlFilterPresets.ts` is the single
source of truth, this is just a read-only snapshot of it for a Python
test to load.

Requires `gramps` and `gramps-object-query-language` importable in
whatever Python environment runs `pytest` (already true wherever
gramps-web-api itself runs, since it depends on both).

## Adding a new built-in preset

Add it to `gqlFilterPresets.ts` as usual, then add one test function
here following the existing pattern -- import the real gramps-core
`Rule` class it's meant to port, and call `assert_goql_matches_rule`
(see `helpers.py`) with the preset's `expr` and an instance of that
rule. If there's genuinely no single gramps-core `Rule` to compare
against (like the year-range presets), compute the expected set
directly instead, and say why in a comment.
