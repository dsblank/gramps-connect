// The beginnings of a Streamlit-style `st.*` widget API for Gramplets
// (Streamlit's own names/signatures, so Streamlit's docs stay useful as
// reference -- nothing here depends on or bundles actual Streamlit/stlite
// code). Kept separate from BOOTSTRAP_PY (already large) so it's easy to
// find/diff on its own. Executed once, right after BOOTSTRAP_PY, by
// ensureBootstrap() in pyodideWorker.ts -- same pyodide global namespace,
// so `html()` (BOOTSTRAP_PY's own builtin) is already defined and callable
// from every widget below by the time this runs.
//
// State: st.button() aside (its return value only ever depends on whether
// *this* run's widgetEvent matches its own key, never persisted), every
// other widget's current value lives in a per-`grampletId` `_SessionState`
// dict -- `_st_begin_run()` (called from runOne() before the Gramplet's own
// code runs) selects/creates the instance for the given id and, if this run
// was triggered by a widget's change event, writes that new value in
// immediately, the same order Streamlit itself applies a widget's new value
// before rerunning the script. LRU-capped at _ST_MAX_INSTANCES so leaving a
// long-running tab open with many different Gramplets over time doesn't
// grow this without bound.
export const ST_BOOTSTRAP_PY = `
import collections as _st_collections

class _SessionState(dict):
    """st.session_state -- a plain dict with attribute access layered on
    top (session_state.foo as well as session_state["foo"]), same as every
    widget's own current-value store: st.text_input()/st.checkbox()/
    st.selectbox() all read/write through this exact dict via their key,
    so a Gramplet author touching st.session_state directly and a widget's
    own persisted value are always the same underlying storage."""
    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError:
            raise AttributeError(name)
    def __setattr__(self, name, value):
        self[name] = value

_ST_MAX_INSTANCES = 50
_st_instances = _st_collections.OrderedDict()  # grampletId -> _SessionState
_st_current_instance = _SessionState()  # replaced by _st_begin_run() below; never None so a widget called outside a real run (import time, tests) doesn't crash
_st_event_key = None
_st_event_value = None

def _st_begin_run(gramplet_id, event_json):
    # Called by runOne() (pyodideWorker.ts) right before running the
    # Gramplet's own code, once per run. event_json is a JSON string, not a
    # raw JS value crossing the boundary -- same reason every other JS/
    # Python crossing in this file is a plain string (see bridge's own doc
    # comment in pyodideWorker.ts): sidesteps PyProxy lifetime issues.
    # event_json is None for a run that wasn't triggered by a widget.
    global _st_current_instance, _st_event_key, _st_event_value
    if gramplet_id in _st_instances:
        _st_instances.move_to_end(gramplet_id)
    else:
        _st_instances[gramplet_id] = _SessionState()
        if len(_st_instances) > _ST_MAX_INSTANCES:
            _st_instances.popitem(last=False)
    _st_current_instance = _st_instances[gramplet_id]
    if event_json is None:
        _st_event_key = None
        _st_event_value = None
    else:
        import json as _json_stdlib
        event = _json_stdlib.loads(event_json)
        _st_event_key = event["key"]
        _st_event_value = event.get("value")
        # Applied immediately, before the Gramplet's own code runs -- a
        # rerun triggered by e.g. st.text_input's change event should see
        # its own freshly typed value on this same rerun, not the next one.
        # Harmless no-op state for st.button() (never read back for a
        # button, see button() below), so this doesn't need to special-case
        # which widget type sent the event.
        _st_current_instance[_st_event_key] = _st_event_value

class _St:
    def button(self, label, key=None):
        """Renders a button; returns True on the one rerun triggered by
        clicking it, False on every other run (the initial render, a rerun
        triggered by some other widget, ...). Deliberately not persisted in
        session_state -- unlike every other widget here, a button's own
        \\"value\\" isn't meaningful to remember between reruns. No
        inspect-frame-based auto-keying yet (PoC limitation, see
        stBootstrap.ts) -- two widgets sharing a label collide."""
        import html as _html_stdlib
        widget_key = key if key is not None else label
        # Goes through the existing html() builtin (not a separate buffer)
        # so it lands in _gramplet_blocks in true call order alongside any
        # print()/row()/html() calls the Gramplet's own code makes, exactly
        # like those three already interleave with each other -- every
        # widget below does the same for the same reason.
        html(
            '<button class="st-button" data-gramplet-key="{key}" data-gramplet-event="click">{label}</button>'.format(
                key=_html_stdlib.escape(str(widget_key)),
                label=_html_stdlib.escape(str(label)),
            )
        )
        return _st_event_key == widget_key

    def text_input(self, label, value="", key=None):
        """Renders a single-line text input; returns its current value
        (persisted in session_state under 'key', defaulting to 'value' the
        first time this key is ever seen)."""
        import html as _html_stdlib
        widget_key = key if key is not None else label
        current = _st_current_instance.get(widget_key, value)
        # <label>...<input>...</label> wrapping, not id=/for= -- two
        # widgets (in different Gramplets, or the same one re-rendered
        # while a stale previous render briefly lingers) could share a
        # label/key, and id has to be page-unique; wrapping the input in
        # its own label element associates them without needing a
        # guaranteed-unique id at all.
        html(
            '<label class="st-text-input">{label}<input type="text" data-gramplet-key="{key}" '
            'data-gramplet-event="change" value="{value}"></label>'.format(
                key=_html_stdlib.escape(str(widget_key)),
                label=_html_stdlib.escape(str(label)),
                value=_html_stdlib.escape(str(current)),
            )
        )
        return current

    def checkbox(self, label, value=False, key=None):
        """Renders a checkbox; returns its current checked state (persisted
        the same way text_input's value is)."""
        import html as _html_stdlib
        widget_key = key if key is not None else label
        current = bool(_st_current_instance.get(widget_key, value))
        html(
            '<label class="st-checkbox"><input type="checkbox" data-gramplet-key="{key}" '
            'data-gramplet-event="change"{checked}>{label}</label>'.format(
                key=_html_stdlib.escape(str(widget_key)),
                checked=" checked" if current else "",
                label=_html_stdlib.escape(str(label)),
            )
        )
        return current

    def selectbox(self, label, options, index=0, key=None):
        """Renders a dropdown; returns the currently selected option (the
        original object from 'options', not necessarily a string -- a
        browser <select>'s change event only ever reports back a plain
        string, so this recovers the real option by matching str(option)
        against it rather than returning that raw string verbatim)."""
        import html as _html_stdlib
        widget_key = key if key is not None else label
        options = list(options)
        default = options[index] if options and 0 <= index < len(options) else None
        stored = _st_current_instance.get(widget_key, default)
        current = stored if stored in options else next(
            (opt for opt in options if str(opt) == str(stored)), default
        )
        option_html = "".join(
            '<option value="{value}"{selected}>{value}</option>'.format(
                value=_html_stdlib.escape(str(opt)),
                selected=" selected" if opt == current else "",
            )
            for opt in options
        )
        html(
            '<label class="st-selectbox">{label}<select data-gramplet-key="{key}" '
            'data-gramplet-event="change">{options}</select></label>'.format(
                key=_html_stdlib.escape(str(widget_key)),
                label=_html_stdlib.escape(str(label)),
                options=option_html,
            )
        )
        return current

    def write(self, *args):
        """The escape hatch for anything that isn't a dedicated widget --
        for now, a thin alias for the existing print() builtin (BOOTSTRAP_PY)
        rather than reimplementing its type-dispatch (matplotlib figures,
        etc.) a second time under a different name."""
        print(*args)

    @property
    def session_state(self):
        return _st_current_instance

    def columns(self, spec, gap=None):
        """Lays out spec side-by-side regions (equal widths for an int,
        proportional to the given weights for a list, e.g. st.columns([2, 1]))
        and returns one _Column per region. Anything written inside 'with
        col:' -- row()/html()/print(), or another st.* widget -- lands
        nested inside that column instead of at the top level; col.write(x)
        without a 'with' block works too (see _Column.__getattr__ below).
        NOT the same columns() as BOOTSTRAP_PY's bare builtin (that one
        only names a row()-built table's headers) -- this is layout, always
        reached via st."""
        n = spec if isinstance(spec, int) else len(spec)
        weights = [1] * n if isinstance(spec, int) else list(spec)
        column_blocks = [[] for _ in range(n)]
        # Flushes a pending table/print buffer *before* inserting this
        # "columns" block, same reasoning as _Column.__enter__ below --
        # without this, e.g. st.write("x") then st.columns(2) leaves "x"
        # sitting unflushed until something later triggers the flush, by
        # which point this "columns" block is already ahead of it in the
        # list -- "x" ends up rendered *after* the row instead of before it,
        # even though it was written first. Found live, the same way
        # _Column.__enter__'s bug was: st.write("Hello") then st.columns(2)
        # put "Hello" below the row instead of above it.
        _flush_print()
        _flush_table()
        _gramplet_sink_stack[-1].append({"type": "columns", "columns": column_blocks, "weights": weights})
        return tuple(_Column(cb) for cb in column_blocks)

st = _St()

class _Column:
    """One region returned by st.columns() -- a plain list of blocks
    (self._blocks, already linked into its parent "columns" block by
    st.columns() above) plus a context-manager/attribute-proxy pair that
    redirects output into it, two ways:
      'with col: st.write(x)' (or a bare row()/html()/print() call) --
      __enter__/__exit__ push/pop this column's own list onto
      _gramplet_sink_stack for the duration of the 'with' block, same stack
      every table/html/print flush already appends to (pyodideWorker.ts).
      'col.write(x)' with no 'with' -- __getattr__ wraps whatever st
      attribute was asked for in that same push/pop, so direct-call style
      needs no 'with' of its own.
    Nests correctly with no extra work: st.columns() called while a column
    is already the active sink just appends its own "columns" block to
    that column's list instead of the top level."""
    def __init__(self, blocks):
        self._blocks = blocks

    def __enter__(self):
        # Flushes a pending table/print buffer from *outside* this column
        # into the sink that's still active right now (the outer column, or
        # the top level) before switching sinks -- otherwise it would sit
        # unflushed until some later html()/row() call inside *this* column
        # finally triggers it, sweeping it into this column's output even
        # though it was actually written before this column ever became the
        # active sink. Found live: st.write("x") then 'with col: st.button(...)'
        # put "x" inside col, not at the top level where it was written --
        # button()'s own html() call was what triggered the flush, by which
        # point this push had already happened.
        _flush_print()
        _flush_table()
        _gramplet_sink_stack.append(self._blocks)
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        # Flushes a still-open table/print buffer *before* popping, so it
        # lands nested in this column rather than leaking out to whatever
        # sink is active next (the outer column, or the top level) once
        # some later, unrelated html()/row() call elsewhere finally
        # triggers the flush.
        _flush_print()
        _flush_table()
        _gramplet_sink_stack.pop()
        return False

    def __getattr__(self, name):
        attr = getattr(st, name)
        if not callable(attr):
            # e.g. col.session_state -- st.session_state is a property, not
            # a widget call; nothing to push/pop a sink around, just the
            # same shared _SessionState st.session_state itself returns.
            return attr
        def _wrapped(*args, **kwargs):
            with self:
                return attr(*args, **kwargs)
        return _wrapped
`;
