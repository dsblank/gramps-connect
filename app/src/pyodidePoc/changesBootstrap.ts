// Data changes for Gramplets with "Allow data changes" on (Gramplet.
// allowChanges, see GRAMPLET_WRITES_PLAN.md) -- the Python half, executed
// once right after BOOTSTRAP_PY/ST_BOOTSTRAP_PY by ensureBootstrap() in
// pyodideWorker.ts, in the same global namespace.
//
// The API is Gram.py Script's (Gramps desktop's GrampyScript addon):
// change a record and it's changed -- person.private = True, any set_*()
// method, list edits -- plus delete(record) and optional begin_changes(msg)
// / end_changes() grouping. A dry run collects what would change into a
// summary (ChangeGroup in types.ts); a real run (only ever from a
// Gramplet's own window) also saves each group as it closes, as one
// POST /api/transactions/ -- sent by the main thread, which keeps the
// returned transactions for Undo (see grampletCommit.ts).
//
// How changes are found: every whole record a run fetches (get_raw_object()
// and get_object(), which everything else -- people(), db.*,
// get_selected() -- goes through) is registered with a snapshot of its
// JSON as read, and an identity map hands back that same Python object if
// the run asks for the same handle again, so a Gramplet always sees its own
// changes. At each flush point (end_changes(), or the end of the run) every
// record is compared with its snapshot. Not setattr write-through, the way
// Gram.py Script does it: that misses list edits like .append(), and the
// later real run can't afford a network write per assignment anyway.
//
// With allowChanges off, none of this is active: records are Gramps' own
// DataDict exactly as before, and changing one only changes that Python
// object.
//
// _ch_computed_keys()/_ch_class_keys()/_ch_validate_embedded() are ported
// from gramps-web-api (AGPL-3.0-or-later), gramps_webapi/api/resources/
// util.py -- Copyright (C) 2020-2025 David Straub, Copyright (C) 2020
// Christopher Horn, https://github.com/gramps-project/gramps-web-api -- so
// a dry run rejects exactly what the server's own object validation would.
export const CHANGES_BOOTSTRAP_PY = `
_CH_MISS = object()

_ch_allowed = False
_ch_dry_run = True
_ch_default_message = "Gramplet"
_ch_group_message = None
# (object_type, handle, form) -> {"type", "handle", "value", "old"}; form is
# "raw" (a _ChangeDict) or "object" (a real gramps.gen.lib object).
_ch_records = {}
# (object_type, handle) -> {"class", "old"} -- deleted in the open group.
_ch_deleted = {}
# (object_type, handle) deleted by an earlier group of this run.
_ch_gone = set()
# Closed groups, already in the JSON shape types.ts's ChangeGroup expects.
_ch_groups = []

_CH_NOT_ALLOWED = (
    "This Gramplet isn't allowed to change data -- turn on Allow data "
    "changes in the Gramplet editor."
)
_CH_PARTIAL = (
    "filter() returns only some fields of a record, so it can't be "
    "changed -- use people()/get_raw_object() (or the other plural "
    "functions) to change a record."
)
# Most changed fields listed for one record in the summary.
_CH_MAX_DIFFS = 50
_CH_MAX_SHOWN = 80


def _changes_begin_run(allowed, default_message, dry_run=True):
    global _ch_allowed, _ch_dry_run, _ch_default_message, _ch_group_message
    _ch_allowed = bool(allowed)
    _ch_dry_run = bool(dry_run)
    _ch_default_message = default_message or "Gramplet"
    _ch_group_message = None
    _ch_records.clear()
    _ch_deleted.clear()
    _ch_gone.clear()
    _ch_groups.clear()


def _ch_require(name):
    if not _ch_allowed:
        raise PermissionError(name + ": " + _CH_NOT_ALLOWED)


# --- Change-tracking record -------------------------------------------------
#
# A _ChangeDict/_ChangeList tree is built once per record, with every nested
# dict/list converted up front, so person.primary_name hands back the same
# nested object every time (Gramps' own DataDict copies on every access,
# which would silently drop person.primary_name.first_name = ...). Every
# node knows its root record.
#
# Methods (get_primary_name(), set_privacy(), ...) aren't on the dict: as
# with DataDict, asking for one builds the real gramps.gen.lib object from
# that node and delegates. That object stays "live" afterwards so chains
# like person.get_primary_name().set_first_name("X") stick: before the next
# read or write anywhere in the record, the live object is serialized back
# into the dicts (in place, keeping nested dicts' identity), and any write
# then drops it. Only one node per record is live at a time -- making a
# second one live syncs and drops the first.


def _ch_wrap(value, root):
    if isinstance(value, dict):
        return _ChangeDict(value, root)
    if isinstance(value, (list, tuple)):
        return _ChangeList(value, root)
    if hasattr(value, "get_object_state"):
        # A real gramps.gen.lib object assigned into a record, e.g.
        # person.primary_name = Name(...).
        from gramps.gen.lib.json_utils import object_to_dict
        return _ch_wrap(object_to_dict(value), root)
    return value


def _ch_plain(value):
    if isinstance(value, dict):
        return {k: _ch_plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_ch_plain(v) for v in value]
    return value


def _ch_merge(target, new):
    # Overwrites target with new in place; False if the shapes don't match
    # and the caller has to replace target instead.
    root = target._ch_root
    if isinstance(target, dict) and isinstance(new, dict):
        for key in [key for key in target if key not in new]:
            dict.__delitem__(target, key)
        for key, value in new.items():
            current = dict.get(target, key, _CH_MISS)
            if isinstance(current, (_ChangeDict, _ChangeList)) and _ch_merge(current, value):
                continue
            dict.__setitem__(target, key, _ch_wrap(value, root))
        return True
    if isinstance(target, list) and isinstance(new, list):
        if len(target) != len(new):
            list.__setitem__(target, slice(None), [_ch_wrap(v, root) for v in new])
            return True
        for i, value in enumerate(new):
            current = list.__getitem__(target, i)
            if isinstance(current, (_ChangeDict, _ChangeList)) and _ch_merge(current, value):
                continue
            list.__setitem__(target, i, _ch_wrap(value, root))
        return True
    return False


class _ChangeDict(dict):
    def __init__(self, data=(), root=None):
        super().__init__()
        object.__setattr__(self, "_ch_root", self if root is None else root)
        # Only the root carries the live gramps.gen.lib object, if any, and
        # which node it was built from.
        if root is None:
            object.__setattr__(self, "_ch_live_node", None)
            object.__setattr__(self, "_ch_live_obj", None)
        for key, value in dict(data).items():
            dict.__setitem__(self, key, _ch_wrap(value, self._ch_root))

    # -- live object bookkeeping (called on the root) --

    def _ch_sync(self):
        node = self._ch_live_node
        if node is not None:
            from gramps.gen.lib.json_utils import object_to_dict
            _ch_merge(node, object_to_dict(self._ch_live_obj))

    def _ch_drop(self):
        object.__setattr__(self, "_ch_live_node", None)
        object.__setattr__(self, "_ch_live_obj", None)

    def _ch_before_write(self):
        self._ch_sync()
        self._ch_drop()

    def _ch_object_for(self, node):
        if self._ch_live_node is not node:
            self._ch_sync()
            from gramps.gen.lib.json_utils import data_to_object
            object.__setattr__(self, "_ch_live_obj", data_to_object(_ch_plain(node)))
            object.__setattr__(self, "_ch_live_node", node)
        return self._ch_live_obj

    # -- dict surface --

    def __getattr__(self, key):
        if key.startswith("_"):
            raise AttributeError(key)
        root = self._ch_root
        root._ch_sync()
        if dict.__contains__(self, key):
            return dict.__getitem__(self, key)
        return getattr(root._ch_object_for(self), key)

    def __getitem__(self, key):
        self._ch_root._ch_sync()
        return dict.__getitem__(self, key)

    def get(self, key, default=None):
        self._ch_root._ch_sync()
        return dict.get(self, key, default)

    def __setattr__(self, key, value):
        if key.startswith("_"):
            object.__setattr__(self, key, value)
            return
        self[key] = value

    def __setitem__(self, key, value):
        root = self._ch_root
        root._ch_before_write()
        dict.__setitem__(self, key, _ch_wrap(value, root))

    def __delitem__(self, key):
        self._ch_root._ch_before_write()
        dict.__delitem__(self, key)

    def __delattr__(self, key):
        del self[key]

    def update(self, *args, **kwargs):
        for key, value in dict(*args, **kwargs).items():
            self[key] = value

    def setdefault(self, key, default=None):
        if key not in self:
            self[key] = default
        return self[key]

    def pop(self, key, *default):
        self._ch_root._ch_before_write()
        return dict.pop(self, key, *default)

    def popitem(self):
        self._ch_root._ch_before_write()
        return dict.popitem(self)

    def clear(self):
        self._ch_root._ch_before_write()
        dict.clear(self)

    def __str__(self):
        return str(self._ch_root._ch_object_for(self))


def _ch_list_mutator(name):
    method = getattr(list, name)

    def mutator(self, *args):
        root = self._ch_root
        root._ch_before_write()
        return method(self, *args)

    mutator.__name__ = name
    return mutator


class _ChangeList(list):
    def __init__(self, data=(), root=None):
        super().__init__(_ch_wrap(v, root) for v in data)
        object.__setattr__(self, "_ch_root", root)

    def __getattr__(self, key):
        if key.startswith("_"):
            raise AttributeError(key)
        # Same as Gramps' own DataList: person.citation_list.handle is
        # every item's .handle.
        return [getattr(item, key) for item in self]

    def __getitem__(self, position):
        self._ch_root._ch_sync()
        return list.__getitem__(self, position)

    def __iter__(self):
        self._ch_root._ch_sync()
        return list.__iter__(self)

    def __setitem__(self, position, value):
        root = self._ch_root
        root._ch_before_write()
        if isinstance(position, slice):
            value = [_ch_wrap(v, root) for v in value]
        else:
            value = _ch_wrap(value, root)
        list.__setitem__(self, position, value)

    def append(self, value):
        root = self._ch_root
        root._ch_before_write()
        list.append(self, _ch_wrap(value, root))

    def insert(self, index, value):
        root = self._ch_root
        root._ch_before_write()
        list.insert(self, index, _ch_wrap(value, root))

    def extend(self, values):
        root = self._ch_root
        root._ch_before_write()
        list.extend(self, [_ch_wrap(v, root) for v in values])

    def __iadd__(self, values):
        self.extend(values)
        return self

    __delitem__ = _ch_list_mutator("__delitem__")
    remove = _ch_list_mutator("remove")
    pop = _ch_list_mutator("pop")
    clear = _ch_list_mutator("clear")
    sort = _ch_list_mutator("sort")
    reverse = _ch_list_mutator("reverse")


# --- Canonical form ----------------------------------------------------------
#
# A record's snapshot is Gramps' own serialization (object_to_dict() of the
# rebuilt object), not the REST shape the worker fetched: that's what the
# database stores, what get_schema() describes, and what a dry run's diff
# should compare. The REST shape also carries computed properties (e.g.
# Date.year) the object endpoints emit but Gramps can't store -- stripped
# first, as gramps-web-api's own normalization does.

_ch_class_keys_cache = {}
_ch_computed_keys_cache = {}


def _ch_gramps_class(class_name):
    import gramps.gen.lib
    if not isinstance(class_name, str):
        return None
    cls = getattr(gramps.gen.lib, class_name, None)
    if cls is None or not hasattr(cls, "get_schema"):
        return None
    return cls


def _ch_class_keys(class_name):
    if class_name not in _ch_class_keys_cache:
        cls = _ch_gramps_class(class_name)
        if cls is None:
            return frozenset()
        from gramps.gen.lib.json_utils import object_to_dict
        _ch_class_keys_cache[class_name] = frozenset(object_to_dict(cls()))
    return _ch_class_keys_cache[class_name]


def _ch_computed_keys(class_name):
    if class_name not in _ch_computed_keys_cache:
        cls = _ch_gramps_class(class_name)
        if cls is None:
            return frozenset()
        properties = {
            key[2 + key.find("__"):] if key.startswith("_") else key
            for key, value in cls.__dict__.items()
            if isinstance(value, property)
        }
        _ch_computed_keys_cache[class_name] = frozenset(properties - _ch_class_keys(class_name))
    return _ch_computed_keys_cache[class_name]


def _ch_strip_computed(value):
    if isinstance(value, dict):
        drop = _ch_computed_keys(value.get("_class"))
        return {k: _ch_strip_computed(v) for k, v in value.items() if k not in drop}
    if isinstance(value, list):
        return [_ch_strip_computed(v) for v in value]
    return value


def _ch_canonical(fixed):
    from gramps.gen.lib.json_utils import data_to_object, object_to_dict
    return object_to_dict(data_to_object(_ch_strip_computed(fixed)))


# --- Hooks called by BOOTSTRAP_PY's get_object()/get_raw_object()/filter() ---


def _changes_lookup(object_type, handle, form):
    # The record this run already has for that handle (or None if the run
    # deleted it), else _CH_MISS -- checked before fetching.
    if not _ch_allowed:
        return _CH_MISS
    if (object_type, handle) in _ch_deleted or (object_type, handle) in _ch_gone:
        return None
    entry = _ch_records.get((object_type, handle, form))
    return entry["value"] if entry is not None else _CH_MISS


def _changes_track_raw(object_type, handle, fixed):
    from gramps.gen.lib.json_utils import DataDict
    if not _ch_allowed:
        return DataDict(fixed)
    canonical = _ch_canonical(fixed)
    # _ChangeDict copies every container, so canonical stays untouched as
    # the snapshot.
    record = _ChangeDict(canonical)
    _ch_records[(object_type, handle, "raw")] = {
        "type": object_type, "handle": handle, "value": record, "old": canonical,
    }
    return record


def _changes_track_object(object_type, handle, fixed):
    from gramps.gen.lib.json_utils import data_to_object, object_to_dict
    if not _ch_allowed:
        return data_to_object(fixed)
    obj = data_to_object(_ch_strip_computed(fixed))
    _ch_records[(object_type, handle, "object")] = {
        "type": object_type, "handle": handle, "value": obj, "old": object_to_dict(obj),
    }
    return obj


_ch_partial_class = None


def _changes_partial(item):
    global _ch_partial_class
    from gramps.gen.lib.json_utils import DataDict
    if not _ch_allowed:
        return DataDict(item)
    if _ch_partial_class is None:
        class _PartialDict(DataDict):
            def __setattr__(self, key, value):
                raise TypeError(_CH_PARTIAL)

            def __setitem__(self, key, value):
                raise TypeError(_CH_PARTIAL)

        _ch_partial_class = _PartialDict
    return _ch_partial_class(item)


def _ch_current(entry):
    value = entry["value"]
    if isinstance(value, _ChangeDict):
        value._ch_sync()
        return _ch_plain(value)
    from gramps.gen.lib.json_utils import object_to_dict
    return object_to_dict(value)


# --- Validation (ported from gramps-web-api, see this file's header) -------

_CH_REF_CLASSES = frozenset({"ChildRef", "EventRef", "MediaRef", "PersonRef", "PlaceRef", "RepoRef"})


def _ch_validate_date(value, path):
    from gramps.gen.lib import Date
    minimum = {
        Date.MOD_NONE: 4, Date.MOD_BEFORE: 4, Date.MOD_AFTER: 4, Date.MOD_ABOUT: 4,
        Date.MOD_FROM: 4, Date.MOD_TO: 4, Date.MOD_RANGE: 8, Date.MOD_SPAN: 8,
    }.get(value.get("modifier", Date.MOD_NONE))
    if minimum is None:
        return
    dateval = value.get("dateval", list(Date.EMPTY))
    if not isinstance(dateval, list) or len(dateval) < minimum:
        raise ValueError(
            f"{path}: 'Date' with modifier {value.get('modifier')} requires at least {minimum} values in 'dateval'"
        )


def _ch_validate_embedded(value, path="$"):
    if isinstance(value, dict):
        class_name = value.get("_class")
        if isinstance(class_name, str):
            known = _ch_class_keys(class_name)
            unknown = sorted(key for key in value if known and key not in known)
            if unknown:
                names = ", ".join(repr(key) for key in unknown)
                raise ValueError(f"{path}: unknown {class_name} keys: {names}")
        if class_name in _CH_REF_CLASSES and not value.get("ref"):
            raise ValueError(f"{path}: '{class_name}' requires a non-empty 'ref'")
        if class_name == "Date":
            _ch_validate_date(value, path)
        for key, item in value.items():
            _ch_validate_embedded(item, f"{path}.{key}")
    elif isinstance(value, list):
        for i, item in enumerate(value):
            _ch_validate_embedded(item, f"{path}[{i}]")


# One validator per class (and per gender-patched variant): building it
# checks the schema itself against the JSON Schema meta-schema, which is
# what nearly all of jsonschema.validate()'s time goes to -- doing that for
# every record made validating a couple of thousand take minutes.
_ch_validators = {}


def _ch_validator(cls, patch_gender):
    import copy
    import jsonschema
    key = (cls.__name__, patch_gender)
    if key not in _ch_validators:
        schema = cls.get_schema()
        if patch_gender:
            schema = copy.deepcopy(schema)
            schema["properties"]["gender"]["maximum"] = cls.OTHER
        validator_class = jsonschema.validators.validator_for(schema)
        validator_class.check_schema(schema)
        _ch_validators[key] = validator_class(schema)
    return _ch_validators[key]


def _ch_validate(data):
    import jsonschema
    cls = _ch_gramps_class(data.get("_class"))
    if cls is None:
        raise ValueError(f"unknown object class {data.get('_class')!r}")
    data = {k: v for k, v in data.items() if k != "complete"}
    # Gramps 5.2 added Person.OTHER = 3, but the JSON schema still caps
    # gender at 2 (see gramps-web-api's validate_object_dict()).
    other = getattr(cls, "OTHER", None)
    maximum = cls.get_schema().get("properties", {}).get("gender", {}).get("maximum")
    patch_gender = other is not None and data.get("gender") == other and maximum is not None and other > maximum
    error = jsonschema.exceptions.best_match(_ch_validator(cls, patch_gender).iter_errors(data))
    if error is not None:
        raise ValueError(f"{error.json_path}: {error.message}")
    _ch_validate_embedded(data)


# --- Summary -----------------------------------------------------------------


def _ch_is_leaf(value):
    # A GrampsType ({"_class": "EventType", "value": 12, "string": ""}) or a
    # Date reads better as one value than as its parts.
    return isinstance(value, dict) and (
        value.get("_class") == "Date" or ("value" in value and "string" in value)
    )


def _ch_show(value):
    if value is _CH_MISS:
        return ""
    if isinstance(value, dict) and value.get("_class") == "Date":
        text = _pp(value)
    elif _ch_is_leaf(value):
        text = _type_label(value)
    elif isinstance(value, dict) and value.get("_class"):
        # A whole embedded object (an EventRef added or removed, ...): its
        # class and what it points at, not its JSON.
        if value.get("_class") in _PRIMARY_CLASSES:
            text = _describe_object(value)
        elif value.get("ref"):
            text = f"{value['_class']} {value['ref']}"
        else:
            text = value["_class"]
    elif isinstance(value, (dict, list)):
        import json
        text = json.dumps(value, ensure_ascii=False)
    else:
        text = repr(value)
    return text if len(text) <= _CH_MAX_SHOWN else text[: _CH_MAX_SHOWN - 1] + "…"


def _ch_diff(old, new, path="", out=None):
    if out is None:
        out = []
    if len(out) >= _CH_MAX_DIFFS:
        return out
    if isinstance(old, dict) and isinstance(new, dict) and not (_ch_is_leaf(old) and _ch_is_leaf(new)):
        for key in list(old) + [key for key in new if key not in old]:
            before, after = old.get(key, _CH_MISS), new.get(key, _CH_MISS)
            if before != after:
                _ch_diff(before, after, f"{path}.{key}" if path else key, out)
    elif isinstance(old, list) and isinstance(new, list):
        for i in range(max(len(old), len(new))):
            before = old[i] if i < len(old) else _CH_MISS
            after = new[i] if i < len(new) else _CH_MISS
            if before != after:
                _ch_diff(before, after, f"{path}[{i}]", out)
    elif len(out) < _CH_MAX_DIFFS:
        out.append({"path": path, "old": _ch_show(old), "new": _ch_show(new)})
    return out


# --- Flushing ----------------------------------------------------------------


async def _ch_flush(message):
    import json
    updates = {}
    for entry in list(_ch_records.values()):
        key = (entry["type"], entry["handle"])
        if key in _ch_deleted:
            continue
        new = _ch_current(entry)
        if new == entry["old"]:
            continue
        if key in updates and updates[key]["new"] != new:
            raise ValueError(
                f"{_describe_object(new)} was changed differently through get_object() "
                "and get_raw_object() -- change a record through only one of them."
            )
        updates[key] = {"entry": entry, "new": new}

    changes = []
    # The /api/transactions/ payload: "old" is the snapshot as the Gramplet
    # read it, so the server refuses the whole group if anyone changed one
    # of these records since.
    items = []
    for (object_type, handle), item in updates.items():
        new = item["new"]
        try:
            _ch_validate(new)
        except ValueError as exc:
            raise ValueError(f"{_describe_object(new)}: {exc}") from None
        items.append({
            "type": "update", "_class": new["_class"], "handle": handle,
            "old": item["entry"]["old"], "new": new,
        })
        changes.append({
            "action": "update",
            "objectType": object_type,
            "handle": handle,
            "description": _describe_object(new),
            "diffs": _ch_diff(item["entry"]["old"], new),
        })

    deleted_handles = {handle for (_, handle) in _ch_deleted}
    for (object_type, handle), item in _ch_deleted.items():
        old = item["old"]
        if old is None:
            old = _ch_canonical(_fix_object_dict(
                json.loads(await _bridge.getObject(object_type, handle)), object_type.capitalize()
            ))
            item["old"] = old
        backlinks = await get_backlinks(object_type, handle)
        references = sum(
            1 for handles in backlinks.values() for h in handles if h not in deleted_handles
        )
        items.append({"type": "delete", "_class": item["class"], "handle": handle, "old": old, "new": None})
        changes.append({
            "action": "delete",
            "objectType": object_type,
            "handle": handle,
            "description": _describe_object(old),
            "references": references,
        })

    if changes:
        group = {"message": message, "committed": False, "changes": changes}
        if not _ch_dry_run:
            try:
                await _bridge.commitChanges(json.dumps({"message": message, "items": items}))
            except Exception as exc:
                # A JS Error crosses as a JsException; its message is what
                # the main thread put there.
                text = str(exc).split("Error: ", 1)[-1]
                group["error"] = text
                _ch_groups.append(group)
                raise RuntimeError(f"Saving '{message}' failed, so none of its changes were saved: {text}") from None
            group["committed"] = True
        _ch_groups.append(group)
    # The next group starts from here: only what changes again from now on
    # belongs to it.
    for item in updates.values():
        item["entry"]["old"] = item["new"]
    for key in list(_ch_deleted):
        _ch_gone.add(key)
        for form in ("raw", "object"):
            _ch_records.pop((key[0], key[1], form), None)
    _ch_deleted.clear()


def delete(record):
    """Deletes a whole record (from people(), get_raw_object(),
    get_object(), get_selected(), db.*, ...). Like Gram.py Script's
    delete(), it does NOT remove references to it from other records --
    the summary says how many there still are."""
    _ch_require("delete()")
    if isinstance(record, dict):
        class_name, handle = record.get("_class"), record.get("handle")
    else:
        class_name, handle = type(record).__name__, getattr(record, "handle", None)
    if class_name not in _PRIMARY_CLASSES or not handle:
        raise TypeError("delete() needs a whole record, e.g. one from people() or get_object()")
    key = (class_name.lower(), handle)
    if key in _ch_deleted or key in _ch_gone:
        return
    old = None
    for form in ("raw", "object"):
        entry = _ch_records.get((key[0], key[1], form))
        if entry is not None:
            old = entry["old"]
            break
    _ch_deleted[key] = {"class": class_name, "old": old}


async def begin_changes(message=None):
    """Starts a group of changes -- one transaction, one undo step, with
    this message. Optional: without it, the whole run is one group named
    after the Gramplet. Closes any group already open first."""
    global _ch_group_message
    _ch_require("begin_changes()")
    if _ch_group_message is not None:
        await end_changes()
    _ch_group_message = message or _ch_default_message


async def end_changes():
    """Closes the group begin_changes() opened (or, without one, everything
    changed so far, as a group named after the Gramplet). Any group still
    open when the run ends is closed automatically."""
    global _ch_group_message
    _ch_require("end_changes()")
    await _ch_flush(_ch_group_message or _ch_default_message)
    _ch_group_message = None


async def _changes_finish():
    # After the Gramplet's own code finished without an error.
    import json
    if _ch_allowed:
        await _ch_flush(_ch_group_message or _ch_default_message)
    return json.dumps(_ch_groups)


def _changes_groups_json():
    # After an error: only groups already closed (plus one whose save just
    # failed). The open group's changes are dropped, the way a failed
    # transaction rolls back.
    import json
    return json.dumps(_ch_groups)
`;
