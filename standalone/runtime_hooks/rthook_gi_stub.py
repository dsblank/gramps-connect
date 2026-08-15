"""Runtime hook: use real GTK if the host has it, else inject a fake `gi`.

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

pywebview's Linux backend (webview/platforms/gtk.py), however, does need
real `gi.repository.{Gtk,Gdk,Gio,WebKit2,Soup}` to open a native window --
with only the synthetic stub, its import always fails and launcher.py
falls back to opening a browser tab, even on a machine that has real
GTK3 + WebKit2 gi bindings installed system-wide (common on Linux desktops
-- many apps depend on them already). So on Linux, this first tries to
import the *real* stack from the system's site-packages before falling
back to the stub. This is inherently best-effort: it only works if the
host's `python3-gi`/`gir1.2-gtk-3.0`/`gir1.2-webkit2-4.1` (or equivalent)
are installed *and* their compiled `_gi*.so` happens to be ABI-compatible
with the Python this was frozen with (same major.minor, in practice) --
neither is guaranteed, so any failure (ImportError, OSError from a
mismatched shared library, ValueError from gi.require_version, ...) just
falls through to the stub, which is always safe. Nothing is bundled
either way -- this only ever reuses what's already on the host.

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


def _try_real_gi() -> bool:
    """Best-effort: pull in the host's real PyGObject/GTK3/WebKit2 stack so
    pywebview can open a native window. Returns False (leaving sys.modules
    untouched) on any failure, so the caller can fall back to the stub."""
    if not sys.platform.startswith("linux"):
        return False

    pyver = f"{sys.version_info.major}.{sys.version_info.minor}"
    for candidate in (
        "/usr/lib/python3/dist-packages",  # Debian/Ubuntu
        f"/usr/lib/python{pyver}/dist-packages",
        f"/usr/lib64/python{pyver}/site-packages",  # Fedora/RHEL
        f"/usr/lib/python{pyver}/site-packages",
    ):
        if os.path.isdir(candidate) and candidate not in sys.path:
            sys.path.append(candidate)

    try:
        import gi

        gi.require_version("Gtk", "3.0")
        gi.require_version("Gdk", "3.0")
        try:
            gi.require_version("WebKit2", "4.1")
            gi.require_version("Soup", "3.0")
        except ValueError:
            gi.require_version("WebKit2", "4.0")
            gi.require_version("Soup", "2.4")
        from gi.repository import Gdk, Gio, GLib, Gtk, Soup, WebKit2  # noqa: F401
    except Exception:
        return False
    return True


def _xdg(env_var, fallback_rel):
    value = os.environ.get(env_var)
    if value:
        return value
    return os.path.join(os.path.expanduser("~"), fallback_rel)


def _install_fake_gi() -> None:
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


if not _try_real_gi():
    _install_fake_gi()
