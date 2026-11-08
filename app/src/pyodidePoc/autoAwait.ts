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
//     thing, not our builtin (unless it's a def made async, below);
//   - it's `filter(lambda ..., ...)` or `filter(None, ...)`: Python's own
//     filter(function, iterable), which our filter(object_type, ...) shadows.
//     Any other first argument is treated as ours.
// A plain assignment (`media = media()`) doesn't count as shadowing, so
// that line still works.
//
// A plain `def` whose own body ends up with an `await` (one inserted here,
// or one written by hand) becomes `async def`, and calls to it by name are
// awaited too -- which can make *its* callers async in turn, so the
// rewrite repeats until nothing new turns async. That only happens to a def
// it's safe for, one that is:
//   - not a method (`obj.method()` calls can't be traced back to it);
//   - not decorated (the decorator may expect a plain function);
//   - not a generator (`for x in gen()` would need `async for`);
//   - only ever called by name, never passed around as a value --
//     `sorted(items, key=f)` would get a coroutine back instead of a result.
// Any other def keeps its inserted `await` and fails with Python's
// SyntaxError ("'await' outside async function") at that line -- clearer
// than the "coroutine has no attribute" error leaving it out would cause
// later. A def the Gramplet writes as `async def` itself is left alone,
// calls included: it can await (or gather) those itself. Lambdas can't be
// async at all.
//
// _run_gramplet() replaces that SyntaxError with one that says, at the same
// line, which lookup can't happen there and why (a lambda, a method, a
// decorated def, a generator def, or a def passed around as a value), and
// what to write instead.
//
// A generator expression that gains an `await` becomes an async generator,
// which `any()` and friends can't loop over ("'async_generator' object is
// not an iterator"). When one is passed straight to any/all/sum/min/max/
// sorted/list/set/frozenset/tuple/dict or to a "...".join, it's rewritten
// as a list comprehension: the same result, minus any()'s early exit (so a
// few more lookups may run). Anywhere else (assigned, or looped over with
// a plain for) it's left alone, and the TypeError it raises when looped
// over gets a note saying to use a list comprehension instead.
export const AUTO_AWAIT_PY = `
import ast as _ast
import copy as _copy
from pyodide.code import CodeRunner as _CodeRunner

_AUTO_AWAIT_NAMES = frozenset({
    "filter", "get_object", "get_raw_object", "count", "get_selected",
    "get_home_person", "people", "families", "events", "places",
    "repositories", "sources", "citations", "media", "notes", "tags",
    "begin_changes", "end_changes",
})

_SCOPES = (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.Lambda, _ast.ClassDef)

# Builtins that consume a whole iterable at once, so a generator expression
# passed to them can be a list comprehension instead with the same result.
_GENEXP_CONSUMERS = frozenset({
    "any", "all", "sum", "min", "max", "sorted", "list", "set", "frozenset",
    "tuple", "dict",
})

_ASYNC_GENEXP_NOTE = (
    "A generator expression, ( ... for ... ), that looks up data can only be "
    "passed straight to any(), all(), sum(), min(), max(), sorted(), list(), "
    "set(), tuple(), dict() or a str.join(). Anywhere else, use a list "
    "comprehension, [ ... for ... ], instead."
)


def _has_own_await(node):
    # An await (or async for) in this generator expression itself, not in a
    # nested def, lambda, class or generator expression: what makes it an
    # async generator.
    stack = [node.elt, *node.generators]
    while stack:
        child = stack.pop()
        if isinstance(child, _ast.Await) or (isinstance(child, _ast.comprehension) and child.is_async):
            return True
        if not isinstance(child, (*_SCOPES, _ast.GeneratorExp)):
            stack.extend(_ast.iter_child_nodes(child))
    return False


def _defined_names(tree):
    names = set()
    for node in _ast.walk(tree):
        if isinstance(node, (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, (_ast.Import, _ast.ImportFrom)):
            for alias in node.names:
                names.add((alias.asname or alias.name).split(".")[0])
    return names


def _own_nodes(func):
    # Everything in a def's body except what's inside a nested def, lambda
    # or class (comprehensions included, since they share its async-ness).
    stack = list(func.body)
    while stack:
        node = stack.pop()
        yield node
        if not isinstance(node, _SCOPES):
            stack.extend(_ast.iter_child_nodes(node))


def _promotable_defs(tree):
    # Names of the plain defs that may become async def (see autoAwait.ts).
    call_funcs = {id(node.func) for node in _ast.walk(tree) if isinstance(node, _ast.Call)}
    plain, excluded = set(), set()
    for node in _ast.walk(tree):
        if isinstance(node, _ast.Name) and isinstance(node.ctx, _ast.Load) and id(node) not in call_funcs:
            excluded.add(node.id)
        elif isinstance(node, _ast.ClassDef):
            excluded.add(node.name)
            for item in node.body:
                if isinstance(item, (_ast.FunctionDef, _ast.AsyncFunctionDef)):
                    excluded.add(item.name)
        elif isinstance(node, _ast.AsyncFunctionDef):
            excluded.add(node.name)
        elif isinstance(node, (_ast.Import, _ast.ImportFrom)):
            excluded.update((alias.asname or alias.name).split(".")[0] for alias in node.names)
        elif isinstance(node, _ast.FunctionDef):
            if node.decorator_list or any(isinstance(n, (_ast.Yield, _ast.YieldFrom)) for n in _own_nodes(node)):
                excluded.add(node.name)
            else:
                plain.add(node.name)
    return plain - excluded


class _AutoAwait(_ast.NodeTransformer):
    def __init__(self, shadowed, promotable, promoted):
        # A stack of scopes: names defined anywhere (minus the defs being
        # made async, whose calls now need awaiting), then one set of
        # parameter names per enclosing def/lambda.
        self.scopes = [shadowed - promoted]
        self.promotable = promotable
        self.promoted = promoted
        # One flag per enclosing def/lambda/class: has its own body got an
        # await in it yet?
        self.awaits = []
        self.wants_async = set()

    def _shadowed(self, name):
        return any(name in scope for scope in self.scopes)

    def _mark_await(self):
        if self.awaits:
            self.awaits[-1] = True

    def visit_FunctionDef(self, node):
        args = node.args
        params = [*args.posonlyargs, *args.args, *args.kwonlyargs]
        if args.vararg:
            params.append(args.vararg)
        if args.kwarg:
            params.append(args.kwarg)
        self.scopes.append({param.arg for param in params})
        self.awaits.append(False)
        self.generic_visit(node)
        self.scopes.pop()
        has_await = self.awaits.pop()
        if isinstance(node, _ast.FunctionDef) and node.name in self.promotable:
            if has_await:
                self.wants_async.add(node.name)
            if node.name in self.promoted:
                fields = {field: getattr(node, field, None) for field in node._fields}
                return _ast.copy_location(_ast.AsyncFunctionDef(**fields), node)
        return node

    visit_AsyncFunctionDef = visit_FunctionDef
    visit_Lambda = visit_FunctionDef

    def visit_ClassDef(self, node):
        self.awaits.append(False)
        self.generic_visit(node)
        self.awaits.pop()
        return node

    def visit_Await(self, node):
        # Already awaited: visit the call's arguments, not the call itself.
        self._mark_await()
        self.generic_visit(node.value if isinstance(node.value, _ast.Call) else node)
        return node

    def visit_AsyncFor(self, node):
        self._mark_await()
        self.generic_visit(node)
        return node

    visit_AsyncWith = visit_AsyncFor

    def visit_comprehension(self, node):
        if node.is_async:
            self._mark_await()
        self.generic_visit(node)
        return node

    def visit_Call(self, node):
        self.generic_visit(node)
        self._listify_genexp(node)
        if self._needs_await(node):
            self._mark_await()
            return _ast.copy_location(_ast.Await(value=node), node)
        return node

    def _consumes_iterable(self, func):
        if isinstance(func, _ast.Name):
            return func.id in _GENEXP_CONSUMERS and not self._shadowed(func.id)
        return (
            isinstance(func, _ast.Attribute)
            and func.attr == "join"
            and isinstance(func.value, _ast.Constant)
            and isinstance(func.value.value, str)
        )

    def _listify_genexp(self, node):
        if not node.args or not isinstance(node.args[0], _ast.GeneratorExp):
            return
        gen = node.args[0]
        if self._consumes_iterable(node.func) and _has_own_await(gen):
            node.args[0] = _ast.copy_location(_ast.ListComp(elt=gen.elt, generators=gen.generators), gen)

    def _needs_await(self, node):
        func = node.func
        if isinstance(func, _ast.Attribute):
            return isinstance(func.value, _ast.Name) and func.value.id == "db" and not self._shadowed("db")
        if not isinstance(func, _ast.Name) or self._shadowed(func.id):
            return False
        if func.id in self.promoted:
            return True
        if func.id not in _AUTO_AWAIT_NAMES:
            return False
        if func.id == "filter" and node.args:
            first = node.args[0]
            if isinstance(first, _ast.Lambda) or (isinstance(first, _ast.Constant) and first.value is None):
                return False
        return True


def _auto_await_tree(tree):
    # Repeats until no new def turns async: each pass awaits calls to the
    # defs the last one made async, which can give their callers an await.
    shadowed = _defined_names(tree)
    promotable = _promotable_defs(tree)
    promoted = set()
    while True:
        transformer = _AutoAwait(shadowed, promotable, promoted)
        result = transformer.visit(_copy.deepcopy(tree))
        if transformer.wants_async <= promoted:
            return _ast.fix_missing_locations(result)
        promoted = promoted | transformer.wants_async


def _auto_await_source(source):
    # Not used by runs -- lets tests see the rewritten code as text.
    return _ast.unparse(_auto_await_tree(_ast.parse(source)))


def _await_label(node):
    call = node.value
    if isinstance(call, _ast.Call):
        func = call.func
        if isinstance(func, _ast.Name):
            return func.id + "()"
        if isinstance(func, _ast.Attribute) and isinstance(func.value, _ast.Name):
            return func.value.id + "." + func.attr + "()"
    return "await"


def _sync_scope(node, parents):
    # The nearest def or lambda around node, if it's one that can't await.
    while node in parents:
        node = parents[node]
        if isinstance(node, _ast.AsyncFunctionDef):
            return None
        if isinstance(node, (_ast.FunctionDef, _ast.Lambda)):
            return node
    return None


def _where_and_fix(scope, parents, tree):
    if isinstance(scope, _ast.Lambda):
        return ("inside a lambda",
                "Look the data up first, for example in a list comprehension, and use "
                "the results; or use a function defined with def and called by name.")
    name = scope.name + "()"
    if isinstance(parents.get(scope), _ast.ClassDef):
        return ("inside the method " + name,
                "Look the data up before calling the method and pass it in, or use a "
                "function defined with def outside the class.")
    if scope.decorator_list:
        return ("inside " + name + ", which has a decorator",
                "Remove the decorator, or look the data up before calling it and pass it in.")
    if any(isinstance(n, (_ast.Yield, _ast.YieldFrom)) for n in _own_nodes(scope)):
        return ("inside " + name + ", which uses yield",
                "Build and return a list instead of using yield.")
    call_funcs = {id(n.func) for n in _ast.walk(tree) if isinstance(n, _ast.Call)}
    if any(isinstance(n, _ast.Name) and n.id == scope.name and isinstance(n.ctx, _ast.Load)
           and id(n) not in call_funcs for n in _ast.walk(tree)):
        return ("inside " + name + ", which is passed around as a value (for example "
                "key=" + scope.name + ") instead of called by name",
                "Look the data up first, for example in a list comprehension, then use the results.")
    return ("inside " + name,
            "Look the data up first, for example in a list comprehension, then use the results.")


def _explain_await_error(err, tree, source):
    # A friendlier SyntaxError for an await Python can't run where it is, or
    # None to keep the original (some other syntax problem).
    message = str(err.msg or "")
    if "await" not in message and "asynchronous" not in message:
        return None
    parents = {}
    for node in _ast.walk(tree):
        for child in _ast.iter_child_nodes(node):
            parents[child] = node
    stuck = [
        (node, scope) for node in _ast.walk(tree) if isinstance(node, _ast.Await)
        for scope in [_sync_scope(node, parents)] if scope is not None
    ]
    if not stuck:
        return None
    line = err.lineno or 0
    on_line = [pair for pair in stuck if pair[0].lineno == line]
    exact = [pair for pair in on_line if err.offset and pair[0].col_offset + 1 == err.offset]
    node, scope = (exact or on_line or sorted(stuck, key=lambda pair: abs(pair[0].lineno - line)))[0]
    where, fix = _where_and_fix(scope, parents, tree)
    label = _await_label(node)
    what = "await" if label == "await" else "Looking up data with " + label
    text = (what + " can't happen " + where + ": a lookup has to wait for the "
            "server, and code there can't wait. " + fix)
    lines = source.splitlines()
    lineno = node.lineno
    source_line = lines[lineno - 1] if 0 < lineno <= len(lines) else None
    end = node.end_col_offset if node.end_lineno == lineno else None
    return SyntaxError(text, ("<gramplet>", lineno, node.col_offset + 1, source_line,
                              lineno, (end + 1) if end is not None else None))


async def _run_gramplet(source):
    # "<gramplet>", not runPythonAsync's "<exec>": the bootstrap code
    # (this function included) is "<exec>" too, so tracebacks would mix
    # their line numbers with the Gramplet's own.
    runner = _CodeRunner(source, filename="<gramplet>", flags=_ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
    runner.ast = _auto_await_tree(runner.ast)
    try:
        runner.compile()
    except SyntaxError as err:
        friendly = _explain_await_error(err, runner.ast, source)
        if friendly is None:
            raise
        raise friendly from None
    try:
        return await runner.run_async(globals())
    except TypeError as err:
        if "async_generator" in str(err):
            err.add_note(_ASYNC_GENEXP_NOTE)
        raise
`;
