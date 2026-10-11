// Auto-inserts `await` on calls to the async builtins (see types.ts) so a
// Gramplet author doesn't have to write it themselves -- `filter`/
// `get_object`/`get_raw_object`/`count`, `get_selected`/`get_home_person`
// (both fetch the record lazily, on first call in a run), the 10
// filter()+get_raw_object() convenience functions (`people`/`families`/
// `events`/`places`/`repositories`/`sources`/`citations`/`media`/`notes`/
// `tags`), `begin_changes`/`end_changes`, and any `db.<method>(...)` call
// (every method pyodideWorker.ts's `Db` class binds is `async def`, as is
// `db.get_relationship()` on the class itself). Those are the *only*
// things in a Gramplet's namespace that ever need awaiting, so this is a
// narrow transform, not a general "find every awaitable call" pass.
//
// The Python half, executed once by ensureBootstrap() in pyodideWorker.ts
// right after BOOTSTRAP_PY, in the same global namespace. Each run's code
// goes through _run_gramplet() instead of straight to runPythonAsync():
// it parses with Pyodide's own CodeRunner (the same machinery
// runPythonAsync uses, so last-expression results, top-level await and
// tracebacks behave the same), rewrites the AST, then compiles and runs
// that. Working on the AST rather than the source text means strings and
// comments can't be mistaken for calls, nesting and multi-line calls need
// no bracket matching, and each call is wrapped as an Await node -- so
// `tags()[0]` becomes `(await tags())[0]`, not `await (tags()[0])`. Line
// numbers in tracebacks still point at the Gramplet's own lines, under the
// filename "<gramplet>". The
// *stored* Gramplet code is never touched, only what's executed.
//
// A call is left alone when:
//   - it's already awaited by hand (its arguments are still visited);
//   - the Gramplet binds that name itself with def/class/import anywhere,
//     or as a parameter of an enclosing def/lambda -- it's calling its own
//     thing, not our builtin;
//   - it's `filter(lambda ..., ...)` or `filter(None, ...)`: Python's own
//     filter(function, iterable), which our filter(object_type, ...) shadows.
//     Any other first argument is treated as ours.
// A plain assignment (`media = media()`) doesn't count as shadowing, so
// that line still works.
//
// Calls inside a regular (non-async) def still get `await`, which Python
// rejects as a SyntaxError pointing at that line -- clearer than the
// "coroutine has no attribute" error leaving it out would cause later.
export const AUTO_AWAIT_PY = `
import ast as _ast
from pyodide.code import CodeRunner as _CodeRunner

_AUTO_AWAIT_NAMES = frozenset({
    "filter", "get_object", "get_raw_object", "count", "get_selected",
    "get_home_person", "people", "families", "events", "places",
    "repositories", "sources", "citations", "media", "notes", "tags",
    "begin_changes", "end_changes",
})


def _defined_names(tree):
    names = set()
    for node in _ast.walk(tree):
        if isinstance(node, (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, (_ast.Import, _ast.ImportFrom)):
            for alias in node.names:
                names.add((alias.asname or alias.name).split(".")[0])
    return names


class _AutoAwait(_ast.NodeTransformer):
    def __init__(self, shadowed):
        # A stack of scopes: names defined anywhere, then one set of
        # parameter names per enclosing def/lambda.
        self.scopes = [shadowed]

    def _shadowed(self, name):
        return any(name in scope for scope in self.scopes)

    def visit_FunctionDef(self, node):
        args = node.args
        params = [*args.posonlyargs, *args.args, *args.kwonlyargs]
        if args.vararg:
            params.append(args.vararg)
        if args.kwarg:
            params.append(args.kwarg)
        self.scopes.append({param.arg for param in params})
        self.generic_visit(node)
        self.scopes.pop()
        return node

    visit_AsyncFunctionDef = visit_FunctionDef
    visit_Lambda = visit_FunctionDef

    def visit_Await(self, node):
        # Already awaited: visit the call's arguments, not the call itself.
        self.generic_visit(node.value if isinstance(node.value, _ast.Call) else node)
        return node

    def visit_Call(self, node):
        self.generic_visit(node)
        if self._needs_await(node):
            return _ast.copy_location(_ast.Await(value=node), node)
        return node

    def _needs_await(self, node):
        func = node.func
        if isinstance(func, _ast.Attribute):
            return isinstance(func.value, _ast.Name) and func.value.id == "db" and not self._shadowed("db")
        if not isinstance(func, _ast.Name) or func.id not in _AUTO_AWAIT_NAMES or self._shadowed(func.id):
            return False
        if func.id == "filter" and node.args:
            first = node.args[0]
            if isinstance(first, _ast.Lambda) or (isinstance(first, _ast.Constant) and first.value is None):
                return False
        return True


def _auto_await_tree(tree):
    return _ast.fix_missing_locations(_AutoAwait(_defined_names(tree)).visit(tree))


def _auto_await_source(source):
    # Not used by runs -- lets tests see the rewritten code as text.
    return _ast.unparse(_auto_await_tree(_ast.parse(source)))


async def _run_gramplet(source):
    # "<gramplet>", not runPythonAsync's "<exec>": the bootstrap code
    # (this function included) is "<exec>" too, so tracebacks would mix
    # their line numbers with the Gramplet's own.
    runner = _CodeRunner(source, filename="<gramplet>", flags=_ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
    runner.ast = _auto_await_tree(runner.ast)
    return await runner.compile().run_async(globals())
`;
