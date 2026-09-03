// Global translation store -- plain-module + useSyncExternalStore, same shape
// as ../auth/auth.ts (module-level state, a listener Set, emit()/subscribe()/
// getSnapshot()) rather than viewStore.ts's per-key class+registry, since
// there's only ever one active language.
//
// Two merged sources per language, mirroring ../../../../gramps-web's own
// split (GrampsJs.js's _loadStrings/_loadFrontendStrings):
//  - static app/public/lang/{lang}.json, bootstrapped from Weblate's "web"
//    and "addons" components (see scripts/bootstrap-translations.py)
//  - the Gramps desktop vocabulary, translated live via gramps-web-api's
//    existing /api/translations/<lang>/ endpoint (translationsApi.ts) -- no
//    static copy, always as fresh as the server's installed `gramps` version
import { fetchTranslations } from "../store/translationsApi";

const STORAGE_KEY = "gramps-connect.lang";

function readStoredLang(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredLang(lang: string) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // localStorage unavailable (private browsing etc.) -- the choice just
    // won't survive a reload.
  }
}

/** Desktop-vocabulary strings gramps-connect actually displays -- grows as
 * more components get wrapped in t(). Posted to /api/translations/<lang>/ on
 * every language change; keep it short, it's every wrapped string's cost.
 * Audited against the ../../../gramps/po/*.po msgid set after the
 * scripts/wrap-translations.mjs sweep: every t()-wrapped string not already
 * covered by the static app/public/lang/*.json corpus, that IS a real
 * Gramps desktop msgid, landed here. (The rest of that sweep's strings are
 * gramps-connect-specific -- no corpus has them yet, so they stay English
 * until this app gets its own Weblate component.) */
const desktopStrings = [
  "About", "Add", "Addresses", "Alternate names", "Associations", "Attributes", "Author",
  "Birth", "Birth place", "Books", "Calendar", "Call name", "Call number", "Cancel",
  "Children", "Citations", "City", "Close", "Code Generators", "Color", "Confidence",
  "Connector", "Continue", "Country", "County", "Date", "Death", "Death place", "Delete",
  "Description", "Display as", "Download", "Edit", "Edit relationship", "Event", "Events",
  "Families", "Family", "Family Trees", "Father", "Format", "Gender", "Given name", "Gramps",
  "Gramps ID", "Graphical Reports", "Graphs", "Group as", "Help", "Home", "Import",
  "Import Family Tree", "Import failed", "Last changed", "Latitude", "Locality", "Longitude",
  "Map", "Media", "Message", "Mother", "Name", "Name type", "New year begins", "Nickname",
  "Notes", "Origin", "Output", "Page", "Parents", "Participants", "People", "Person", "Phone",
  "Place", "Places", "Postal code", "Prefix", "Preview", "Primary", "Private",
  "Quality", "Relationship", "Remove", "Reports", "Repositories", "Role", "Save", "Select",
  "Sort as", "Source", "Sources", "State", "Statistics", "Street", "Suffix", "Surname",
  "Surnames", "System Information", "Tags", "Text", "Text Reports", "Timeline", "Title",
  "Trees", "Type", "URL", "Value", "View", "Web Pages",
  "Years", "new", "to",
];

// Locale codes actually bootstrapped by scripts/bootstrap-translations.py
// (keep this in sync with that script's LOCALES) -- the same duplication
// gramps-web accepts between its own hardcoded frontendLanguages (src/
// strings.js) and its lang/*.json directory, used the same way below.
const SUPPORTED_LANGUAGES = [
  "ar", "ba", "bg", "br", "ca", "cs", "da", "de", "de_AT", "el", "en_GB",
  "eo", "es", "fi", "fr", "ga", "he", "hr", "hu", "id", "is", "it", "ja",
  "ka", "ko", "lt", "lv", "mk", "mn", "nb_NO", "ne", "nl", "nn", "oc", "pl",
  "pt_BR", "pt_PT", "ro", "ru", "sk", "sl", "sq", "sr", "sv", "ta", "tr",
  "uk", "vi", "zh_Hans", "zh_Hant", "zh_Hant_HK",
];

/** navigator.language ("de-AT") -> one of our locale codes ("de_AT"), or
 * null if nothing bootstrapped matches. Mirrors gramps-web's own
 * getBrowserLanguage() (src/util.js:541) exactly: normalize hyphens to
 * underscores, try the full code, then just the base language. */
function detectBrowserLang(): string | null {
  if (typeof navigator === "undefined" || !navigator.language) return null;
  const browserLang = navigator.language.replace(/-/g, "_");
  if (SUPPORTED_LANGUAGES.includes(browserLang)) return browserLang;
  const base = browserLang.split("_")[0];
  if (SUPPORTED_LANGUAGES.includes(base)) return base;
  return null;
}

// useSyncExternalStore requires getSnapshot to return the same reference
// until something actually changes (it re-invokes this on every render and
// bails only on Object.is equality) -- a fresh object per call is an
// infinite re-render loop. Cache it, same as viewStore.ts's `this.snapshot`.
let snapshot: { lang: string; strings: Record<string, string> } = {
  // Browser language only applies with nothing stored yet -- once App.tsx's
  // mount effect calls setLanguage() for it, that persists it too, same as
  // gramps-web's own GrampsJs.js:750 (detect once, then sticky like any
  // explicit choice, not re-detected every load).
  lang: readStoredLang() ?? detectBrowserLang() ?? "en",
  strings: {},
};
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getI18nSnapshot(): { lang: string; strings: Record<string, string> } {
  return snapshot;
}

export async function setLanguage(newLang: string): Promise<void> {
  const [frontend, desktop] = await Promise.all([
    newLang === "en"
      ? Promise.resolve({})
      : fetch(`/lang/${newLang}.json`).then((res) => (res.ok ? res.json() : {})).catch(() => ({})),
    newLang === "en" ? Promise.resolve({}) : fetchTranslations(desktopStrings, newLang),
  ]);
  snapshot = {
    lang: newLang,
    // Desktop corpus wins on collision, so the same vocabulary term (e.g.
    // "Cancel") reads consistently regardless of which source has it.
    strings: { ...frontend, ...desktop },
  };
  writeStoredLang(newLang);
  emit();
}

/** For desktop-vocabulary content that isn't known ahead of time, so can't
 * live in the static `desktopStrings` list -- e.g. MenuBar.tsx's installed
 * report names, which come from whatever plugins the server has and are
 * genuinely translated in the same Gramps desktop corpus (report plugins
 * register their name via gettext `_()` too). Merges into the current
 * snapshot rather than replacing it, so it composes with setLanguage()
 * instead of racing it. No-op for English or an empty list. Callers should
 * re-call this whenever *their* dynamic list changes AND whenever the
 * current language changes -- previously-merged translations were for
 * whatever language was active at the time. */
export async function addDesktopTranslations(strings: string[]): Promise<void> {
  const lang = snapshot.lang;
  if (lang === "en" || strings.length === 0) return;
  const extra = await fetchTranslations(strings, lang);
  // The active language may have changed while this was in flight -- don't
  // merge a stale-language result into the new snapshot.
  if (snapshot.lang !== lang || Object.keys(extra).length === 0) return;
  snapshot = { lang, strings: { ...snapshot.strings, ...extra } };
  emit();
}

/** Mirrors gramps-web's _(s) (GrampsJs.js:1368) exactly, including stripping
 * the desktop corpus's GTK mnemonic-accelerator underscore (e.g. "_Zurück")
 * -- translations sourced from the same gettext catalog carry the same
 * syntax, and gramps-connect has no keyboard-accelerator use for it. */
export function t(s: string): string {
  return (snapshot.strings[s] ?? s).replace("_", "");
}
