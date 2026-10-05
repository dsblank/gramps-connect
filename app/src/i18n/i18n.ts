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

/** Codes SUPPORTED_LANGUAGES below used to list by mistake -- Weblate's own
 * tags, which neither app/public/lang/ nor gramps-core's locale directories
 * (and so /api/translations/<lang>) use. A browser that matched one stored
 * it as a sticky preference, so map it to the real code on the way back in. */
const LEGACY_LANGUAGE_CODES: Record<string, string> = {
  nb_NO: "nb",
  zh_Hans: "zh_CN",
  zh_Hant: "zh_TW",
  zh_Hant_HK: "zh_HK",
};

function readStoredLang(): string | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? null : (LEGACY_LANGUAGE_CODES[stored] ?? stored);
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
// (app/public/lang/index.json) -- the same duplication gramps-web accepts
// between its own hardcoded frontendLanguages (src/strings.js) and its
// lang/*.json directory, used the same way below. Like that script (and
// gramps-web, and gramps-core's own locale names), this uses "nb"/"zh_CN",
// not Weblate's raw "nb_NO"/"zh_Hans" -- see LEGACY_LANGUAGE_CODES above.
const SUPPORTED_LANGUAGES = [
  "ar", "ba", "bg", "br", "ca", "cs", "da", "de", "de_AT", "el", "en_GB",
  "eo", "es", "fi", "fr", "ga", "he", "hr", "hu", "id", "is", "it", "ja",
  "ka", "ko", "lt", "lv", "mk", "mn", "nb", "ne", "nl", "nn", "oc", "pl",
  "pt_BR", "pt_PT", "ro", "ru", "sk", "sl", "sq", "sr", "sv", "ta", "tr",
  "uk", "vi", "zh_CN", "zh_HK", "zh_TW",
];

/** A Chinese BCP 47 tag (already split on "_") -> zh_CN/zh_TW/zh_HK.
 * Browsers report Chinese with a script subtag, a region, both, or neither
 * ("zh-CN", "zh-Hans", "zh-Hans-CN", "zh-SG", "zh-TW", "zh-Hant-HK", "zh"),
 * so neither a full-code nor a base-language match finds our codes. The
 * script decides Simplified vs Traditional when given; otherwise the
 * region does, defaulting to Simplified. */
function chineseLocale(subtags: string[]): string {
  const lower = subtags.map((s) => s.toLowerCase());
  const hongKongOrMacau = lower.includes("hk") || lower.includes("mo");
  if (lower.includes("hans")) return "zh_CN";
  if (lower.includes("hant")) return hongKongOrMacau ? "zh_HK" : "zh_TW";
  if (hongKongOrMacau) return "zh_HK";
  if (lower.includes("tw")) return "zh_TW";
  return "zh_CN";
}

/** navigator.language ("de-AT") -> one of our locale codes ("de_AT"), or
 * null if nothing bootstrapped matches. Mirrors gramps-web's own
 * getBrowserLanguage() (src/util.js:541): normalize hyphens to underscores,
 * try the full code, then just the base language -- plus Chinese, whose
 * script/region subtags that match can't map (see chineseLocale()). */
export function browserLangToLocale(navigatorLang: string): string | null {
  const browserLang = navigatorLang.replace(/-/g, "_");
  const [base, ...subtags] = browserLang.split("_");
  if (base.toLowerCase() === "zh") return chineseLocale(subtags);
  if (SUPPORTED_LANGUAGES.includes(browserLang)) return browserLang;
  if (SUPPORTED_LANGUAGES.includes(base)) return base;
  return null;
}

function detectBrowserLang(): string | null {
  if (typeof navigator === "undefined" || !navigator.language) return null;
  return browserLangToLocale(navigator.language);
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
