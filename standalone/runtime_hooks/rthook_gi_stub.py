"""Runtime hook: inject a fake `gi` package before any real code imports it.

gramps/gen/const.py unconditionally does `from gi.repository import GLib`
purely to compute a couple of XDG-style user directories -- real GTK is
never rendered by this headless server. Confirmed by reading every
reachable call site (const.py, constfunc.py, gramps_webapi/const.py):
nothing on gramps-web-api's actual request-handling path needs real GTK,
GdkPixbuf, or GObject-Introspection. So this sidesteps the whole
GTK/PyGObject native-library bundling problem entirely (painful on every
platform, and the reason Gramps' own macOS build uses a separate jhbuild
toolchain instead of PyInstaller) rather than trying to solve it.

This has to be a *runtime hook* (injecting into sys.modules directly),
not a same-named package added to pathex: PyInstaller has a specialized
pre_safe_import_module hook keyed to the literal name "gi" (because real
PyGObject needs bespoke native-library/typelib collection), which runs
independently of normal pathex/sys.path shadowing and collects the real
installed PyGObject regardless -- confirmed by trying the pathex approach
first, which produced a broken bundle mixing both. `"gi"` must also be in
the .spec's Analysis excludes= so that specialized hook never triggers.
"""

import os
import sys
import types


def _xdg(env_var, fallback_rel):
    value = os.environ.get(env_var)
    if value:
        return value
    return os.path.join(os.path.expanduser("~"), fallback_rel)


glib_module = types.ModuleType("gi.repository.GLib")


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

repository_module = types.ModuleType("gi.repository")
repository_module.GLib = glib_module

gi_module = types.ModuleType("gi")
gi_module.require_version = lambda namespace, version: None
gi_module.repository = repository_module

sys.modules["gi"] = gi_module
sys.modules["gi.repository"] = repository_module
sys.modules["gi.repository.GLib"] = glib_module
