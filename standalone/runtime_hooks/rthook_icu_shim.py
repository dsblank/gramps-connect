"""Runtime hook: inject a fake `icu` module backed by pyuca (pure-Python
Unicode Collation Algorithm, no compiled extension) so gramps core's
locale/collation code gets real Unicode-aware sorting instead of falling
back to `locale.strxfrm` under this frozen build's `C`/`C.UTF-8` locale
(no locale archive bundled -- see rthook_locale_shim.py's own docstring for
the related gettext gap).

gramps/gen/utils/grampslocale.py does `from icu import Locale, Collator,
ICUError`, falling back to `from PyICU import ...`, and warns "ICU not
loaded ... Localization will be impaired" when both fail -- which they
always do here, since neither package (nor the real ICU native library
either would need) is bundled. Without it, GrampsLocale.sort_key() (which
backs every name/place sort, and is registered as SQLite's `COLLATE`
callback via gramps/plugins/db/dbapi/sqlite.py's check_collation()) falls
back to `locale.strxfrm`, which under a bare `C` locale sorts by raw
Unicode codepoint: every accented name gets dumped after every plain-ASCII
one, entirely out of alphabetical position (confirmed empirically -- see
the session that added this hook).

Real PyICU needs the actual ICU native library, which is the kind of
bundling pain this whole build avoids elsewhere (see rthook_gi_stub.py for
the same story with GTK). pyuca has no such dependency -- pure Python plus
a bundled Unicode Collation Element Table data file (see the .spec's
`datas` entry for it) -- so this fakes just enough of PyICU's surface for
grampslocale.py to use it instead.

Scope: covers grampslocale.py's sort_key()/strcoll() (the SQLite COLLATE
path and every name/place sort) -- not a general ICU replacement. In
particular gramps/plugins/webreport/alphabeticindex.py (the Narrated Web
Site report's letter-grouping) also checks HAVE_ICU and additionally wants
Collator.setStrength(PRIMARY)/.compare() for case/accent-insensitive
comparison, which pyuca's flat sort key doesn't expose -- that module
already has its own non-ICU fallback class for exactly this case, so it's
unaffected either way, just not upgraded by this shim.

pyuca has no per-locale tailoring (just the default Unicode Collation
Element Table), so Collator.createInstance(locale) ignores its `locale`
argument entirely -- correct general-purpose Unicode sorting, not a
locale-specific one (e.g. Swedish's tailored placement of "a with ring").
"""

import sys
import types

import pyuca

_collator = pyuca.Collator()


def _install_fake_icu() -> None:
    class ICUError(Exception):
        pass

    class Locale:
        def __init__(self, name=""):
            self.name = name

        @classmethod
        def createFromName(cls, name):
            return cls(name)

        @staticmethod
        def getAvailableLocales():
            # Only consulted for `coll[:2] in ICU_LOCALES` (a Windows-only
            # COLLATION env var override, gramps/gen/utils/win32locale.py)
            # -- pyuca has no locale registry of its own, so accept
            # anything rather than reject a locale it would in fact sort
            # just fine.
            class _AnyLocale:
                def __contains__(self, _key):
                    return True

            return _AnyLocale()

    class _CollationKey:
        def __init__(self, weights):
            # pyuca's sort_key() is a tuple of ints (UCA weights, 0 as
            # level separators, some >255) -- pack each as 2 bytes
            # big-endian so plain byte-array comparison (what
            # hexlify+str comparison in grampslocale.sort_key relies on)
            # preserves the same ordering as comparing the weight tuples
            # directly.
            self._key = b"".join(w.to_bytes(2, "big") for w in weights)

        def getByteArray(self):
            return self._key

    class Collator:
        def __init__(self):
            self._collator = _collator

        @classmethod
        def createInstance(cls, locale=None):
            # pyuca has no locale-tailored collation to select -- every
            # instance uses the same default DUCET-based collator.
            return cls()

        def getCollationKey(self, string):
            return _CollationKey(self._collator.sort_key(string))

    icu_module = types.ModuleType("icu")
    icu_module.ICUError = ICUError
    icu_module.Locale = Locale
    icu_module.Collator = Collator
    sys.modules["icu"] = icu_module


_install_fake_icu()
