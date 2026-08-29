"""Runtime hook: shim locale.textdomain/bindtextdomain when the frozen
Python's _locale wasn't built with gettext (libintl) support.

CPython's stdlib locale.py only defines textdomain/bindtextdomain/
gettext/etc. if the underlying _locale C extension exposes them, which
depends on whether that specific Python build was compiled against
libintl -- gated behind a try/except ImportError in locale.py itself, so
their absence is silent until first use. gramps/gen/utils/grampslocale.py
calls locale.textdomain()/locale.bindtextdomain() unconditionally at
GrampsLocale.__init_first_instance() (its own comment: "bug12278,
_build_popup_ui() under linux and macOS"), which is reached the moment
anything imports gramps.gen.const -- i.e. immediately, at the top of
launcher.py's own import chain. When missing, this crashed the whole app
before a single line of our code ran: "AttributeError: module 'locale'
has no attribute 'textdomain'" (reported on a macOS arm64 build using the
Python actions/setup-python installs there; Gramps' own official macOS
build uses a separately-built jhbuild/gtk-osx Python that apparently does
have libintl, and this dev machine's Linux glibc always does, which is
why this was never caught until an actual macOS run).

Safe to no-op here specifically: grampslocale.py's own comment says these
two calls exist only for GtkBuilder's g_dgettext-based translated popup
UI -- real GTK is already stubbed out entirely for this headless build
(see rthook_gi_stub.py), so there is no GtkBuilder popup UI to translate
in the first place. gramps-web-api's own /api/translations/<lang>/
endpoint reads compiled .mo catalogs directly via polib (see
compile-gramps-translations.py), not through this locale/gettext
machinery, so nothing on this build's actual reachable code path needs
these calls to do anything real.
"""

import locale

if not hasattr(locale, "textdomain"):
    locale.textdomain = lambda domain=None: domain

if not hasattr(locale, "bindtextdomain"):
    locale.bindtextdomain = lambda domain, localedir=None: localedir
