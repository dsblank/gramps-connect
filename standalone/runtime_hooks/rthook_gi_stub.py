"""Runtime hook: inject a fake `gi` module so gramps.gen.const imports cleanly.

gramps/gen/const.py unconditionally does `from gi.repository import GLib`
purely to compute a couple of XDG-style user directories -- real GTK is
never rendered by gramps-web-api itself (headless). Confirmed by reading
every reachable call site (const.py, constfunc.py, gramps_webapi/const.py):
nothing on gramps-web-api's actual request-handling path needs real GTK,
GdkPixbuf, or GObject-Introspection. So none of *that* code needs real
PyGObject bundled -- bundling it is the kind of pain that's forced Gramps'
own macOS build onto a separate jhbuild toolchain instead of plain
PyInstaller, and this build avoids it by default via the synthetic stub
below.

gi.Repository is also stubbed, for one specific reason: gramps/plugins/
view/geography.gpr.py -- confirmed the *only* .gpr.py file in the whole
gramps/plugins tree that imports `gi` directly at module scope (checked
with a recursive grep across plugins/**/*.gpr.py for "import gi") -- does
`from gi import Repository` there, to probe for the OsmGpsMap typelib
before falling back to its own "not available" branch (a no-op headless,
since that branch's GTK dialog is itself guarded by `has_display()`).
Without a real gi that import raised, which BasePluginManager's
scan_dir() logs as "ERROR: Failed reading plugin registration
geography.gpr.py" on every launch -- harmless (that view is never used
headless either way) but alarming console noise. `enumerate_versions()`
returning empty makes the file take that same "not available" branch on
its own, same end state, just without the error.

gi.repository.{Gtk,Gdk,GObject,GdkPixbuf,Gio,Pango,PangoCairo,Atk} are also
stubbed, for a reason distinct from the two above: gramps-web-api's
"Check and Repair Database" tool (POST /trees/<id>/repair) lazily imports
gramps.plugins.tool.check, which does `from gi.repository import Gtk` at
module scope, and transitively (via `from gramps.gui.plug import tool`)
pulls in gramps.gui.widgets and gramps.gui.editors -- large chunks of
Gramps' actual GTK widget/editor toolkit, referencing dozens of GTK/GDK/
GObject/Pango enum constants and dialog/widget base classes at *class
definition* time (e.g. `class IconButton(Gtk.Button): def __init__(self,
..., size=Gtk.IconSize.MENU)`). Enumerating each of those by name is
impractical and would silently break again on any new gramps-core widget.
Instead, each of these namespaces is a generic auto-vivifying module: any
attribute access invents a fresh do-nothing class on first touch (usable
as a plain value, an enum constant, a callable, or a base class to
subclass) and remembers it, so class bodies and default-argument
expressions across that whole import chain resolve without errors.

This is safe specifically because none of the real widgets/dialogs it
lets get *defined* are ever *instantiated* on gramps-web-api's actual
call path: gramps.plugins.tool.check's CheckIntegrity is always
constructed with `uistate=None` (see gramps_webapi/api/check.py), and
every GTK-dialog call site in check.py (OkDialog, MissingMediaDialog,
the module-level `ProgressMeter` swap in the GUI-only `Check` wrapper
class, which check_database() never touches) is itself guarded by
`if uistate:`. Verified end-to-end by running check_database() against
a real in-memory db with this stub active -- it completes and returns
a normal result, only auto-vivifying objects during the module imports,
never at runtime. If a future gramps-core change removes one of those
`if uistate:` guards, a real GTK method call would hit one of these
auto-vivified no-ops and likely raise or behave wrong -- worth another
look at that failure if Check and Repair ever throws again after this.

This used to also try to import the host's real GTK3/WebKit2 stack first,
for pywebview's Linux GTK backend to open a native window with. That's
dead code now: launcher.py's main() always opens Linux in the tester's
own browser and returns before ever calling webview.create_window()/
webview.start() (see that function's own comment for why -- WebKitGTK
compatibility issues), so nothing on Linux ever reaches the code path a
real gi.repository.{Gtk,Gdk,WebKit2,Soup} stack was for. Probing for it
unconditionally on every Linux launch cost real startup time + memory on
any desktop that happens to have python3-gi/gtk3/webkit2gtk installed
(common -- many apps depend on them already) for a branch that could
never be taken, so it's gone; the stub below is installed unconditionally
on every platform.

The stub has to be installed via a *runtime hook* (injecting into
sys.modules directly), not a same-named package added to pathex:
PyInstaller has a specialized pre_safe_import_module hook keyed to the
literal name "gi" (because real PyGObject needs bespoke
native-library/typelib collection), which runs independently of normal
pathex/sys.path shadowing and collects the real installed PyGObject
regardless -- confirmed by trying the pathex approach first, which
produced a broken bundle mixing both. `"gi"` must also be in the .spec's
Analysis excludes= so that specialized hook never triggers.
"""

import os
import sys
import types


class _AutoMeta(type):
    """Metaclass so class-level attribute access (e.g. `Gtk.IconSize.MENU`,
    where `IconSize` is itself an auto-vivified class) also auto-vivifies,
    not just instance access -- see module docstring."""

    def __getattr__(cls, name):
        if name.startswith("__"):
            raise AttributeError(name)
        value = _AutoMeta(name, (_AutoObject,), {})
        setattr(cls, name, value)
        return value


class _AutoObject(metaclass=_AutoMeta):
    """Auto-vivifying stand-in for an unknown GTK/GDK/... name: usable as a
    plain attribute, an enum constant, a callable, or a base class to
    subclass -- whatever the importing code needs it to be."""

    def __init__(self, *args, **kwargs):
        pass

    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        value = _AutoMeta(name, (_AutoObject,), {})
        setattr(type(self), name, value)
        return value

    def __call__(self, *args, **kwargs):
        return _AutoObject()


class _AutoModule(types.ModuleType):
    """A `gi.repository.<Namespace>` stand-in: any attribute pulled off it
    (a class to subclass, a constant, a function to call) auto-vivifies via
    `_AutoObject` on first access. See module docstring for why this exists
    and why it's safe."""

    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        value = _AutoMeta(name, (_AutoObject,), {})
        setattr(self, name, value)
        return value


def _xdg(env_var, fallback_rel):
    value = os.environ.get(env_var)
    if value:
        return value
    return os.path.join(os.path.expanduser("~"), fallback_rel)


def _install_fake_gi() -> None:
    glib_module = _AutoModule("gi.repository.GLib")

    class GError(Exception):
        """Stand-in for GLib.GError -- only ever seen in `except GLib.GError`
        clauses (gen/utils/image.py, gen/utils/thumbnails.py) that aren't on
        gramps-web-api's reachable code path, but cheap to provide."""

    class UserDirectory:
        DIRECTORY_PICTURES = "PICTURES"

    def get_user_data_dir():
        return _xdg("XDG_DATA_HOME", os.path.join(".local", "share"))

    def get_user_config_dir():
        return _xdg("XDG_CONFIG_HOME", ".config")

    def get_user_cache_dir():
        return _xdg("XDG_CACHE_HOME", os.path.join(".cache"))

    def get_user_special_dir(directory):
        """None is explicitly handled by gramps/gen/const.py's caller (falls
        back to USER_DATA), so this is a safe, honest answer -- we don't know
        where the user's real Pictures folder is without a real GLib, and
        nothing on our code path actually needs it."""
        return None

    glib_module.GError = GError
    glib_module.UserDirectory = UserDirectory
    glib_module.get_user_data_dir = get_user_data_dir
    glib_module.get_user_config_dir = get_user_config_dir
    glib_module.get_user_cache_dir = get_user_cache_dir
    glib_module.get_user_special_dir = get_user_special_dir
    # gramps/gui/widgets/validatedmaskedentry.py does `GObject.PARAM_READWRITE
    # if GLib.check_version(2, 42, 0) else GObject.ParamFlags.READWRITE` at
    # module scope; real GLib.check_version() returns None (falsy) when the
    # requirement is satisfied, so returning None takes the same
    # "modern GLib" branch a real install would.
    glib_module.check_version = lambda *args, **kwargs: None
    # gramps/gui/widgets/styledtexteditor.py does
    # `from gi.repository.GLib import Variant` at module scope.
    glib_module.Variant = _AutoMeta("Variant", (_AutoObject,), {})

    repository_module = types.ModuleType("gi.repository")
    repository_module.GLib = glib_module

    # See module docstring: these namespaces back Gramps' actual GTK
    # widget/editor toolkit, reachable only via gramps-web-api's Check and
    # Repair Database tool. Auto-vivifying covers arbitrarily many
    # classes/constants across that whole import chain without enumerating
    # them by name.
    for _namespace in (
        "Gtk",
        "Gdk",
        "GObject",
        "GdkPixbuf",
        "Gio",
        "Pango",
        "PangoCairo",
        "Atk",
    ):
        _ns_module = _AutoModule(f"gi.repository.{_namespace}")
        setattr(repository_module, _namespace, _ns_module)
        sys.modules[f"gi.repository.{_namespace}"] = _ns_module

    # gramps.gen.constfunc.has_display() computes
    # `Gtk.init_check(temp) and Gdk.Display.get_default()` to detect a real
    # GTK display. Left auto-vivifying, Gtk.init_check(temp) would return a
    # truthy _AutoObject like any other untouched attribute, making
    # has_display() wrongly report True in this headless build (Linux never
    # opens a native GTK window here either -- see this file's own
    # docstring). That's more than cosmetic: gramps/plugins/gramplet/
    # gramplet.gpr.py's GExiv2-missing-module warning is gated on
    # `if has_display():` and, when true, imports gramps.gui.dialog ->
    # gramps.gui.glade, which loads a .glade file by a path relative to the
    # *installed* gramps package -- not bundled here (the .spec only bundles
    # gramps/plugins and gramps' data/ dir as loose data, not gramps/gui's
    # own resource files) -- raising FileNotFoundError. scan_dir()'s bare
    # except catches that, but rolls back and drops *every* Gramplet the
    # whole file registers, plus prints a scary traceback on every launch.
    # Forcing init_check() False short-circuits the `and` before
    # Gdk.Display.get_default() is even reached, so has_display() correctly
    # reports "no real display".
    repository_module.Gtk.init_check = lambda *args, **kwargs: False

    class Repository:
        """Stand-in for gi.Repository -- only geography.gpr.py's module-scope
        `Repository.get_default().enumerate_versions("OsmGpsMap")` probe
        needs this (see this file's module docstring); an empty result
        sends it down its own already-headless-safe "not available" path."""

        @staticmethod
        def get_default():
            return Repository()

        def enumerate_versions(self, namespace):
            return []

    gi_module = types.ModuleType("gi")
    gi_module.require_version = lambda namespace, version: None
    gi_module.repository = repository_module
    gi_module.Repository = Repository

    sys.modules["gi"] = gi_module
    sys.modules["gi.repository"] = repository_module
    sys.modules["gi.repository.GLib"] = glib_module


_install_fake_gi()
