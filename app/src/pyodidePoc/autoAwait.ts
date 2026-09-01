// Auto-inserts `await` before a bare call to any of the async builtins
// (see types.ts) so a Gramplet author doesn't have to write it themselves
// -- `filter`/`get_object`/`get_raw_object`/`count`, `get_selected`/
// `get_home_person` (both fetch the record lazily, on first call in a
// run), the 10 filter()+ get_raw_object() convenience functions
// (`people`/`families`/`events`/`places`/`repositories`/`sources`/
// `citations`/`media`/`notes`/`tags`), and any `db.<method>(...)` call
// (every method pyodideWorker.ts's `Db` class binds is `async def`, as is
// `db.get_relationship()` on the class itself) are the *only* things in a
// Gramplet's namespace that ever need awaiting, so this is a narrow, well-scoped
// transform, not a general "find every awaitable call" preprocessor.
//
// Regex-based on purpose, not a real Python parser -- a small, fast,
// dependency-free pass applied once per run, right before
// pyodideWorker.ts hands the code to runPythonAsync. The *stored*
// Gramplet code (what GrampletEditDialog saves) is never touched, only
// the copy actually executed -- so this is purely a run-time convenience,
// reversible by construction (nothing about a Gramplet's saved source
// depends on this transform ever having run).
//
// The alternation's first four branches (triple/single/double-quoted
// strings, `#` comments) exist purely to be matched-and-skipped: passing
// them through unchanged in the replacer below is what keeps a `filter(`
// that only appears inside a string or a comment from being touched.
// Only one of the two call-site branches' capture groups is ever
// non-empty at a time; that's how the replacer tells "this is a real
// call site, needs await" apart from "this was just a string/comment,
// leave it alone" -- and which of the two shapes it was (bare name vs.
// `db.method`) so it knows how much of the match to prefix with `await`.
//
// The bare-builtin branch (`filter`/`get_object`/.../`tags`) is guarded
// by three negative lookbehinds:
//   - (?<!\.)          -- `something.filter(...)`: an attribute/method
//                          call, not our builtin (JS lookbehind supports
//                          variable-length patterns, unlike Python's re,
//                          so `await\s{1,20}` below works as one).
//                          call, not our builtin.
//   - (?<!await\s{1,20}) -- already explicitly awaited; existing
//                          Gramplet code (or a copy-pasted example) that
//                          already writes `await` keeps working exactly
//                          as before -- this is a safe no-op on it, not
//                          just tolerated.
//   - (?<!def\s{1,20})   -- `def filter(...):` -- a Gramplet author
//                          shadowing the name with their own function.
//                          Doesn't cover every way a name could be
//                          shadowed (a `lambda filter: ...` parameter,
//                          for instance) -- a deliberate, accepted limit
//                          of a regex heuristic rather than a real parser.
//
// Known, real tradeoff worth knowing about rather than hiding: naming the
// async query builtin `filter` shadows Python's own built-in `filter()`
// (the classic `filter(function, iterable)`). This preprocessor can't
// tell the two apart -- a Gramplet that wants the *real* builtin (e.g.
// `list(filter(lambda x: x > 0, values))`) gets `await` inserted too,
// which breaks it (`TypeError: 'filter' object can't be used in 'await'
// expression` or similar). That collision already existed before this
// preprocessor (only distinguishable by whether `await` was written by
// hand); this makes it slightly easier to hit by accident, not a new
// problem this introduces from scratch.
//
// The second call-site branch handles `db.<method>(...)`-style calls
// (pyodideWorker.ts's `Db` class) -- every method `Db` binds
// (get_<type>_from_handle, get_raw_<type>_data, iter_<type>_handles,
// iter_<plural>, get_<type>_from_gramps_id, get_number_of_<plural>) is
// `async def`, so rather than enumerate them here (and have this drift
// out of sync again the next time a method is added to `Db`, as happened
// with iter_*/get_number_of_*/get_*_from_gramps_id), this matches *any*
// `db.<name>(` call site. These are inherently dotted, so they don't need
// (and can't use) the bare branch's `(?<!\.)` guard; `\bdb\.` only
// matches the literal name `db` (word-boundary before it means `mydb.`
// or `somedb.` never match), so a Gramplet author's own unrelated `db`
// variable would still collide if they used that exact name -- same
// class of accepted limitation as the `filter` shadowing above.
const CALL_SITE_RE =
  /'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|#[^\n]*|(?<!\.)(?<!await\s{1,20})(?<!def\s{1,20})\b(filter|get_object|get_raw_object|count|get_selected|get_home_person|people|families|events|places|repositories|sources|citations|media|notes|tags)\b(?=\s*\()|(?<!await\s{1,20})\b(db\.\w+)(?=\s*\()/g;

export function autoAwaitGrampletCode(code: string): string {
  return code.replace(
    CALL_SITE_RE,
    (match, name: string | undefined, dbCall: string | undefined) => {
      if (name) return `await ${name}`;
      if (dbCall) return `await ${dbCall}`;
      return match;
    }
  );
}
