// Regenerates app/src/data/wikidataPlaceTypes.json: the QID -> Gramps
// PlaceType map wikidataApi.ts's guessPlaceType() uses to label a walked
// P131 chain's levels (County, City, ...) during the Wikidata place-lookup
// import (see WIKIDATA_PLACE_LOOKUP_PLAN.md). The hand-picked table this
// replaced covered 9 QIDs, all U.S.-shaped (country/state/county/city) --
// every other country's admin-division system left `placeType: null`.
//
// Instead of hand-listing QIDs, this asks Wikidata's own ontology for every
// class it considers a subclass of "administrative territorial entity"
// (Q56061) or "human settlement" (Q486972) -- several thousand, across
// every country's admin-division and settlement vocabulary -- and
// classifies each by matching known English keywords in its label (see
// RULES below). A class that matches no keyword, or that the DENYLIST
// recognizes as not actually a place-type level (an elected council, a
// "capital" status label, ...), is left out entirely -- guessPlaceType then
// falls back to null, same as it always has. Same "best-effort, no guess is
// better than a wrong one" philosophy as the table this replaces; some
// genuinely ambiguous terms (a bare "canton" or "prefecture" means wildly
// different admin levels in different countries) get a single reasonable
// default rather than being resolved correctly for every country -- see the
// comments on RULES below for the specific judgment calls.
//
// Re-run by hand whenever Wikidata's ontology grows or RULES changes:
//
//   node app/scripts/update-wikidata-place-types.mjs
//
// A hand-curated fix that the keyword rules get wrong, or a class this
// script's two roots don't reach at all (e.g. Q10864048 "first-level
// administrative division", whose Wikidata label has no keyword this
// script recognizes, but which real place items do use directly as their
// P31 value) belongs in wikidataPlaceTypeOverrides.json next to this
// script -- merged in last, always wins over a generated guess.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.dirname(scriptDir);
const outPath = path.join(appDir, "src", "data", "wikidataPlaceTypes.json");
const overridesPath = path.join(scriptDir, "wikidataPlaceTypeOverrides.json");

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
// WDQS rejects unauthenticated requests with no User-Agent (403) -- unlike
// wikidataApi.ts's browser-side fetch(), where User-Agent is a forbidden
// header a page can't set, this is a Node script and can (and per
// Wikidata's request-etiquette, should) identify itself.
const USER_AGENT = "gramps-connect-wikidata-place-types/1.0 (https://github.com/dsblank/gramps-connect)";

// The two Wikidata classes every relevant country-specific admin-division
// or settlement class is (eventually) a P279 subclass of. Two roots, not
// one: e.g. "town"/"village"/"hamlet" themselves are modeled as subclasses
// of "human settlement", not "administrative territorial entity" -- even
// though many country-specific flavors of both (e.g. "commune of France")
// are reachable from the administrative-entity root alone.
const ROOTS = [
  { qid: "Q56061", label: "administrative territorial entity" },
  { qid: "Q486972", label: "human settlement" },
];

// Skips a class outright regardless of keyword match -- these turned up as
// P279-subclasses of a root too (Wikidata's ontology is broad) but aren't
// actual place-type levels: elected bodies, capital-status labels, defunct
// concepts named after whatever they used to contain, media/trivia with a
// matching word in the title, etc.
const DENYLIST =
  /\b(council|capital|constituency|electoral|committee|organi[sz]ation|agency|party|fiction|amendment|movement|periodical|newspaper|album|song|film|video ?game|university|company|corporation|wall|police|list article)\b/i;

// Checked in order, first match wins -- compound/qualified phrases before
// the bare single-word terms they contain, so e.g. "county-level city of
// China" resolves to City, not County, and "canton of Switzerland" (one of
// the 26 Swiss federated states) resolves to State before the generic
// "canton" rule -- covering France/Belgium/Ecuador/Costa Rica/etc.'s much
// smaller canton -- reaches it. Communes and townships are mapped to
// Municipality (Gramps has no closer built-in type); a bare/unqualified
// "prefecture" or "canton" gets one reasonable default (Province,
// District) rather than a per-country-correct guess.
const RULES = [
  [/city[- ]state/i, "Country"],
  [/sovereign state/i, "Country"],
  [/consolidated city-county|city with county rights|county-administered city|county-level city|prefecture-level city/i, "City"],
  [/canton of (switzerland|luxembourg|the federation of bosnia and herzegovina|bosnia)/i, "State"],
  [/\bemirate\b/i, "State"],
  [/\bsubprefecture\b|\bsub-?district\b|\barrondissement\b|\braion\b|\bokrug\b/i, "District"],
  [/\bgmina\b/i, "Municipality"],
  [/\bpowiat\b/i, "County"],
  [/\bvoivodeship\b|\bwilaya\b|\bgovernorate\b/i, "Province"],
  [/\boblast\b|\bkrai\b/i, "Region"],
  [/\bbarangay\b/i, "Neighborhood"],
  [/\bcommune\b/i, "Municipality"],
  [/\bdepartment\b/i, "Department"],
  [/\bprefecture\b/i, "Province"],
  [/\bmunicipality\b/i, "Municipality"],
  [/\btownship\b/i, "Municipality"],
  [/\bhamlet\b/i, "Hamlet"],
  [/\bvillage\b/i, "Village"],
  [/\bneighbou?rhood\b/i, "Neighborhood"],
  [/\bborough\b/i, "Borough"],
  [/\bparish\b/i, "Parish"],
  [/\bcanton\b/i, "District"],
  [/\bdistrict\b/i, "District"],
  [/\bcounty\b/i, "County"],
  [/\btown\b/i, "Town"],
  [/\bcity\b/i, "City"],
  [/\bprovince\b/i, "Province"],
  [/\bregion\b/i, "Region"],
  [/\bstate\b/i, "State"],
  [/\bcountry\b/i, "Country"],
];

function classify(label) {
  for (const [pattern, type] of RULES) {
    if (pattern.test(label)) return type;
  }
  return null;
}

async function fetchSubclasses(rootQid) {
  const query = `SELECT ?item ?itemLabel ?itemDescription WHERE {
    ?item wdt:P279+ wd:${rootQid} .
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  }`;
  const res = await fetch(`${SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}`, {
    headers: { Accept: "application/sparql-results+json", "User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`Wikidata SPARQL query failed for ${rootQid} (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data.results.bindings.map((b) => ({
    qid: b.item.value.split("/").pop(),
    label: b.itemLabel?.value ?? "",
    description: b.itemDescription?.value ?? "",
  }));
}

const seen = new Map();
for (const root of ROOTS) {
  const rows = await fetchSubclasses(root.qid);
  if (rows.length === 0) {
    throw new Error(`Wikidata returned no subclasses of ${root.qid} (${root.label}) -- refusing to write an incomplete table`);
  }
  console.log(`update-wikidata-place-types: ${rows.length} subclasses of ${root.qid} (${root.label})`);
  for (const row of rows) {
    if (!seen.has(row.qid)) seen.set(row.qid, row);
  }
  // Be polite to the shared, unauthenticated SPARQL endpoint between the
  // two queries -- see fetchWikidataGeoshape's GEOSHAPE_THROTTLE_MS for the
  // same courtesy on the client side.
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

const byQid = {};
let matched = 0;
let denied = 0;
for (const { qid, label, description } of seen.values()) {
  if (DENYLIST.test(label) || DENYLIST.test(description)) {
    denied += 1;
    continue;
  }
  const type = classify(label);
  if (type) {
    byQid[qid] = type;
    matched += 1;
  }
}

let overrides = {};
try {
  overrides = JSON.parse(await readFile(overridesPath, "utf8"));
} catch (err) {
  if (err.code !== "ENOENT") throw err;
}
Object.assign(byQid, overrides);

const sortedEntries = Object.entries(byQid).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

const output = {
  generatedAt: new Date().toISOString(),
  source: `${SPARQL_ENDPOINT} (subclasses of ${ROOTS.map((r) => r.qid).join(", ")} -- see scripts/update-wikidata-place-types.mjs)`,
  byQid: Object.fromEntries(sortedEntries),
};

await writeFile(outPath, JSON.stringify(output, null, 2) + "\n");
console.log(
  `update-wikidata-place-types: ${seen.size} candidate classes, ${denied} denylisted, ${matched} keyword-matched, ` +
    `${Object.keys(overrides).length} override(s) -> ${sortedEntries.length} total entries written to ${path.relative(appDir, outPath)}`
);
