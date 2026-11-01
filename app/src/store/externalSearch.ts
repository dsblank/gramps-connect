// External Search: links that look a person up on other genealogy
// websites, built by filling the person's name, years and place into each
// site's search-URL template. Nothing is fetched from those sites -- each
// link just opens their own results page in a new tab.
//
// Started as a port of gramps-web's GrampsjsFormExternalSearch.js, kept
// compatible on purpose: the same site keys (for hidden sites) and the
// same {{variable}} names, so a custom search URL written for Gramps Web
// works pasted in here unchanged. Two deliberate differences: every value
// is URL-encoded before it goes into a template (gramps-web inserts it raw,
// so a "&" or "#" in a name breaks the link), and the terms come from the
// raw record rather than server-formatted profile strings (see
// searchTermsFor).
//
// BUILTIN_SITES is for sites that cover the world, not one country;
// regional ones go in SUGGESTED_SITES, which Customize offers as one-click
// custom engines. That's why gramps-web's CompGen (meta.genealogy.net, a
// German-societies metasearch) is a suggestion here, not built in.
//
// Every URL below was checked on 2026-11-01. "Live" means the site was
// fetched with that URL and its results reflected the query (for
// Findmypast, its server-rendered search state listed each field). Sites
// behind a bot wall (Cloudflare and the like) can't be fetched by a
// script; their URLs follow Gramps' WebSearch addon's maintained link
// lists (addons-source WebSearch/assets/csv) and were then opened by hand
// in a browser, noted per site. When a link stops working, recheck it in
// a browser and against those lists -- don't trust a scripted fetch of a
// bot-walled site either way.
//
// The hidden-site list and custom engines are per browser (localStorage),
// not per tree or shared, as in gramps-web.
import type { ObjectDetail } from "./objectDetail";
import { lifeEventPlace, lifeEventYear } from "./lifeEventDates";

/** gramps-web's three access levels, shown as a badge on each site's row. */
export type SiteAccess = "open" | "registration" | "subscription";
const ACCESS_LEVELS: readonly SiteAccess[] = ["open", "registration", "subscription"];

export interface ExternalSite {
  key: string;
  name: string;
  /** Full search URL with {{variable}} placeholders. */
  url: string;
  /** Absent on a user's own custom engine: we can't know what it needs. */
  access?: SiteAccess;
}

export interface CustomEngine {
  key: string;
  name: string;
  url: string;
  /** Only on one added from SUGGESTED_SITES, copied from it. */
  access?: SiteAccess;
}

export const TEMPLATE_VARS = [
  "name_given",
  "name_middle",
  "name_surname",
  "place_name",
  "birth_year",
  "death_year",
] as const;
export type TemplateVar = (typeof TEMPLATE_VARS)[number];
export type SearchTerms = Record<TemplateVar, string>;

export const BUILTIN_SITES: readonly ExternalSite[] = [
  // --- Record collections ---
  {
    key: "familySearch",
    name: "FamilySearch",
    access: "registration",
    url:
      "https://familysearch.org/search/record/results?q.birthLikeDate.from={{birth_year}}&q.birthLikeDate.to={{birth_year}}" +
      "&q.deathLikeDate.from={{death_year}}&q.deathLikeDate.to={{death_year}}&q.givenName={{name_given}}&q.surname={{name_surname}}",
  },
  {
    key: "ancestry",
    name: "Ancestry",
    access: "subscription",
    url:
      "https://www.ancestry.com/search?name={{name_given}}_{{name_surname}}&birth={{birth_year}}_{{place_name}}" +
      "&death={{death_year}}&searchMode=advanced",
  },
  {
    key: "myheritage",
    name: "MyHeritage",
    access: "subscription",
    url:
      "https://www.myheritage.com/research?formId=master&formMode=1&action=query&qname=Name+fn.{{name_given}}+ln.{{name_surname}}" +
      "&qevents-event1=Event+et.birth+ey.{{birth_year}}+ep.{{place_name}}&qevents-any/1event_2=Event+et.death+ey.{{death_year}}&qevents=List",
  },
  {
    // Live. Years +/-2, as Findmypast's own form defaults to; an empty
    // year is ignored rather than rejected.
    key: "findmypast",
    name: "Findmypast",
    access: "subscription",
    url:
      "https://www.findmypast.com/search/results?firstname={{name_given}}&lastname={{name_surname}}" +
      "&yearofbirth={{birth_year}}&yearofbirth_offset=2&yearofdeath={{death_year}}&yearofdeath_offset=2",
  },
  // --- Shared family trees ---
  {
    key: "wikitree",
    name: "WikiTree",
    access: "open",
    url:
      "https://plus.wikitree.com/function/WTWebProfileSearch/Profiles.htm?Query={{name_given}}+{{name_surname}}" +
      "&MaxProfiles=500&SortOrder=Default&PageSize=10",
  },
  {
    // Live. Searching needs no account; Geni's own profiles mostly do.
    key: "geni",
    name: "Geni",
    access: "registration",
    url: "https://www.geni.com/search?search_type=people&names={{name_given}}%20{{name_surname}}",
  },
  {
    key: "geneanet",
    name: "Geneanet",
    access: "subscription",
    url: "https://en.geneanet.org/fonds/individus/?size=10&nom={{name_surname}}&prenom={{name_given}}",
  },
  // --- Graves ---
  {
    key: "findagrave",
    name: "Find A Grave",
    access: "open",
    url:
      "https://www.findagrave.com/memorial/search?firstname={{name_given}}&middlename={{name_middle}}&lastname={{name_surname}}" +
      "&birthyear={{birth_year}}&birthyearfilter=&deathyear={{death_year}}&deathyearfilter=",
  },
  {
    // Bot wall; the WebSearch addon's common-list URL, checked by hand in a
    // browser.
    key: "billiongraves",
    name: "BillionGraves",
    access: "open",
    url:
      "https://billiongraves.com/search/results?given_names={{name_given}}&family_names={{name_surname}}" +
      "&birth_year={{birth_year}}&death_year={{death_year}}",
  },
  // --- Books and the wider web: an exact-phrase name ---
  {
    // sin=TXT selects "Search text contents" (the OCR of scanned books,
    // directories, local histories) -- read from archive.org's own search
    // page code, which maps sin=TXT to its full-text search type.
    key: "internetArchive",
    name: "Internet Archive (full text)",
    access: "open",
    url: "https://archive.org/search?query=%22{{name_given}}%20{{name_surname}}%22&sin=TXT",
  },
  {
    // Bot wall; the WebSearch addon's us/gb/fr-list URL, checked by hand
    // in a browser.
    // lmt=ft keeps to full-view (freely readable) volumes.
    key: "hathitrust",
    name: "HathiTrust (full text)",
    access: "open",
    url: "https://babel.hathitrust.org/cgi/ls?q1=%22{{name_given}}%20{{name_surname}}%22&lmt=ft&a=srchls",
  },
  {
    // Live. Family websites, blogs and forum posts no database indexes.
    key: "google",
    name: "Google",
    access: "open",
    url: "https://www.google.com/search?q=%22{{name_given}}%20{{name_surname}}%22%20{{birth_year}}%20genealogy",
  },
];

/** A regional site Customize offers to add as a custom engine. `region` is
 * shown beside it; it's a country or language name, so it's translated. */
export interface SuggestedSite extends ExternalSite {
  region: string;
}

export const SUGGESTED_SITES: readonly SuggestedSite[] = [
  {
    // Live. gramps-web's own built-in.
    key: "compgen",
    name: "CompGen",
    region: "Germany",
    access: "open",
    url: "https://meta.genealogy.net/search?lastname={{name_surname}}&place={{place_name}}",
  },
  {
    // Live. Indexes Dutch and Belgian archives (and some German ones).
    key: "openArchives",
    name: "Open Archives",
    region: "Netherlands",
    access: "open",
    url: "https://www.openarchieven.nl/search.php?lang=en&name={{name_given}}%20{{name_surname}}",
  },
  {
    // Bot wall. Trove's pre-2023 search URL, as in the WebSearch addon's au
    // list, which Trove redirects to its current search; checked by hand in
    // a browser. Family Notices are its birth, death and marriage notices.
    key: "troveFamilyNotices",
    name: "Trove (family notices)",
    region: "Australia",
    access: "open",
    url: "https://trove.nla.gov.au/newspaper/result?q=%22{{name_given}}%20{{name_surname}}%22&l-advcategory=Family+Notices",
  },
];

interface RawPersonName {
  first_name?: string;
  surname_list?: { surname?: string; prefix?: string; primary?: boolean }[];
}

/** The search terms for a person record as RelatedPanel fetched it.
 * Names come from the raw primary name, not the profile's name_display:
 * that follows the tree's display format ("Smith, John"), and sites want
 * the parts separately. The surname keeps its prefix ("van Gogh"); the
 * middle name is the given name's second word, as in gramps-web (Gramps
 * has no separate middle-name field). Years and the place come from the
 * same birth/death-or-fallback events the profile shows, the place being
 * the birth's, else the death's. */
export function searchTermsFor(detail: ObjectDetail): SearchTerms {
  const name = (detail.primary_name ?? {}) as RawPersonName;
  const given = (name.first_name ?? "").trim();
  const surnames = name.surname_list ?? [];
  const primary = surnames.find((s) => s.primary) ?? surnames[0];
  const surname = primary ? [primary.prefix, primary.surname].filter(Boolean).join(" ").trim() : "";
  return {
    name_given: given,
    name_middle: given.split(/\s+/)[1] ?? "",
    name_surname: surname,
    place_name: lifeEventPlace(detail, "birth") || lifeEventPlace(detail, "death"),
    birth_year: lifeEventYear(detail, "birth"),
    death_year: lifeEventYear(detail, "death"),
  };
}

/** `template` with each {{variable}} replaced by its URL-encoded value --
 * "" for an empty or unknown one, as gramps-web does, so a site simply
 * gets that search field blank. */
export function fillTemplate(template: string, terms: Partial<Record<string, string>>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => encodeURIComponent(terms[key] ?? ""));
}

/** Whether a custom engine's URL template is an http(s) URL once filled
 * in -- anything else (a typo, a javascript: URL) is refused before it
 * becomes a link. */
export function isValidSearchUrl(template: string): boolean {
  try {
    const url = new URL(fillTemplate(template.trim(), {}));
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

// --- Per-browser preferences ------------------------------------------

const STORAGE_KEY = "gramps-connect_external_search";

export interface ExternalSearchPrefs {
  /** Keys of built-in sites the user switched off. */
  hidden: string[];
  custom: CustomEngine[];
}

export function loadPrefs(): ExternalSearchPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<ExternalSearchPrefs>;
    return {
      hidden: Array.isArray(raw.hidden) ? raw.hidden.filter((k) => typeof k === "string") : [],
      custom: Array.isArray(raw.custom)
        ? raw.custom
            .filter(
              (e): e is CustomEngine =>
                !!e && typeof e.key === "string" && typeof e.name === "string" && typeof e.url === "string",
            )
            .map(({ key, name, url, access }) => (access && ACCESS_LEVELS.includes(access) ? { key, name, url, access } : { key, name, url }))
        : [],
    };
  } catch {
    return { hidden: [], custom: [] };
  }
}

export function savePrefs(prefs: ExternalSearchPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage full or blocked: the change still applies for this session.
  }
}

/** The sites to list: built-ins not hidden, then custom engines. */
export function visibleSites(prefs: ExternalSearchPrefs): ExternalSite[] {
  return [...BUILTIN_SITES.filter((site) => !prefs.hidden.includes(site.key)), ...prefs.custom];
}

/** A suggested site as a custom engine. Its key is the suggestion's own
 * (prefixed), so Customize can tell it's already been added. */
export function engineFromSuggestion(site: SuggestedSite): CustomEngine {
  return { key: suggestionEngineKey(site), name: site.name, url: site.url, access: site.access };
}

export function suggestionEngineKey(site: SuggestedSite): string {
  return `suggested_${site.key}`;
}
