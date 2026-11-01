// External Search: links that look a person up on other genealogy
// websites, built by filling the person's name, years and place into each
// site's search-URL template. Nothing is fetched from those sites -- each
// link just opens their own results page in a new tab.
//
// A port of gramps-web's GrampsjsFormExternalSearch.js, kept compatible on
// purpose: the same site keys (for hidden sites) and the same {{variable}}
// names, so a custom search URL written for Gramps Web works pasted in here
// unchanged. gramps-web's CompGen (meta.genealogy.net, a German-societies
// metasearch) is left out as too regional for a general list; it can be
// added back as a custom engine. Two deliberate differences: every value is
// URL-encoded before it goes into a template (gramps-web inserts it raw, so
// a "&" or "#" in a name breaks the link), and the terms come from the raw
// record rather than server-formatted profile strings (see searchTermsFor).
//
// The hidden-site list and custom engines are per browser (localStorage),
// not per tree or shared, as in gramps-web.
import type { ObjectDetail } from "./objectDetail";
import { lifeEventPlace, lifeEventYear } from "./lifeEventDates";

/** gramps-web's three access levels, shown as a badge on each site's row. */
export type SiteAccess = "open" | "registration" | "subscription";

export interface ExternalSite {
  key: string;
  name: string;
  /** Full search URL with {{variable}} placeholders. */
  url: string;
  /** Absent on custom engines: we can't know what a user's own site needs. */
  access?: SiteAccess;
}

export interface CustomEngine {
  key: string;
  name: string;
  url: string;
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
    key: "geneanet",
    name: "Geneanet",
    access: "subscription",
    url: "https://en.geneanet.org/fonds/individus/?size=10&nom={{name_surname}}&prenom={{name_given}}",
  },
  {
    key: "wikitree",
    name: "WikiTree",
    access: "open",
    url:
      "https://plus.wikitree.com/function/WTWebProfileSearch/Profiles.htm?Query={{name_given}}+{{name_surname}}" +
      "&MaxProfiles=500&SortOrder=Default&PageSize=10",
  },
  {
    key: "findagrave",
    name: "Find A Grave",
    access: "open",
    url:
      "https://www.findagrave.com/memorial/search?firstname={{name_given}}&middlename={{name_middle}}&lastname={{name_surname}}" +
      "&birthyear={{birth_year}}&birthyearfilter=&deathyear={{death_year}}&deathyearfilter=",
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
        ? raw.custom.filter(
            (e): e is CustomEngine =>
              !!e && typeof e.key === "string" && typeof e.name === "string" && typeof e.url === "string",
          )
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
