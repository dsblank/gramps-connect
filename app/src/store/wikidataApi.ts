// Client-side Wikidata lookup for WikidataPlaceLookupDialog.tsx (see the
// plan, WIKIDATA_PLACE_LOOKUP_PLAN.md): search a place name, then walk its
// P131 ("located in the administrative territorial entity") chain up to the
// root, reading each level's P625 (coordinate location) and P31 (instance
// of, used to guess a Gramps PlaceType). No gramps-web-api involvement at
// all -- both calls hit Wikidata directly from the browser, the same way
// gramps-web's own queryNominatim() (src/api.js) calls Nominatim directly
// with no backend proxy. Confirmed live (2026-09-06) that both endpoints
// below send `access-control-allow-origin: *`, so this works cross-origin
// with no CORS proxy needed.
//
// The original research prototype (a Python script) set a descriptive
// User-Agent per Wikidata's request-etiquette -- not reproduced here: fetch()
// treats User-Agent as a forbidden header a page can't override, so the
// browser's own default is sent instead. Nothing about the read-only,
// unauthenticated endpoints used here requires more than that.
//
// fetchWikidataGeoshape below is the third call, added 2026-09-09 (see the
// plan's geoshape follow-up): a P3896 claim, when present, names a Commons
// `Data:*.map` page holding this level's boundary as GeoJSON -- also called
// directly from the browser, also `access-control-allow-origin: *` when the
// same `origin=*` param is used.
import type { Feature } from "geojson";

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const WIKIDATA_ENTITY_DATA = "https://www.wikidata.org/wiki/Special:EntityData";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

/** Max P131 hops to walk before giving up -- guards a malformed/cyclic
 * chain from hanging the lookup. Matches the plan's "~8" cap; every real
 * city->county->state->country->(root) chain seen during research was 3-4
 * hops deep. */
const MAX_CHAIN_DEPTH = 8;

export interface WikidataSearchResult {
  qid: string;
  label: string;
  /** Usually already names the state/country (e.g. "capital city of the
   * U.S. state of Indiana and seat of Marion County" for Indianapolis) --
   * what makes picking the right result out of same-named candidates easy
   * without an extra query. Null for the rare hit with none. */
  description: string | null;
}

/** One level of a walked P131 chain, leaf (the searched place) first. */
export interface WikidataPlaceNode {
  qid: string;
  label: string;
  lat: number | null;
  long: number | null;
  /** Raw P31 ("instance of") QIDs -- kept around for callers that want to
   * show/debug the type guess, not just the guess itself. */
  instanceOf: string[];
  /** A Gramps PlaceType label (e.g. "City", "County", "State", "Country" --
   * see gramps/gen/lib/placetype.py's _DATAMAP, whose exact strings this
   * must match for gramps-web-api's fix_object_dict to recognize it as the
   * built-in type rather than a custom one) guessed from `instanceOf`, or
   * null when nothing in `instanceOf` is in the guess table -- callers
   * should fall back to a free-text custom type using `label` in that case,
   * and let the user correct a wrong guess before anything is created. */
  placeType: string | null;
  /** P3896 ("geoshape")'s value, when present -- the title of a `Data:*.map`
   * page on Wikimedia Commons holding this level's boundary as GeoJSON (see
   * fetchWikidataGeoshape). Most levels have none; that's normal, not an
   * error -- see WIKIDATA_PLACE_LOOKUP_PLAN.md's geoshape follow-up. */
  geoshapeTitle: string | null;
}

/** `P31` (instance of) QID -> Gramps PlaceType label. Deliberately small
 * and best-effort: no single Wikidata property cleanly encodes "admin
 * level" consistently across every country's administrative system, so
 * this only covers the common cases the plan's own worked example hit
 * (country/state/county/city) plus a few frequent siblings. Unmapped QIDs
 * fall through to `placeType: null` (see WikidataPlaceNode). */
const PLACE_TYPE_BY_QID: Record<string, string> = {
  Q6256: "Country",
  Q3624078: "Country", // sovereign state
  Q35657: "State", // U.S. state (and the general "state" concept)
  Q10864048: "State", // administrative territorial entity of a country
  Q28575: "County",
  Q515: "City",
  Q1549591: "City", // big city
  Q3957: "Town",
  Q532: "Village",
};

function guessPlaceType(instanceOf: string[]): string | null {
  for (const qid of instanceOf) {
    const guess = PLACE_TYPE_BY_QID[qid];
    if (guess) return guess;
  }
  return null;
}

/** name -> candidate QIDs, via Wikidata's own search endpoint (no API key). */
export async function searchWikidata(
  term: string,
  signal?: AbortSignal
): Promise<WikidataSearchResult[]> {
  const params = new URLSearchParams({
    action: "wbsearchentities",
    search: term,
    language: "en",
    format: "json",
    limit: "5",
    origin: "*", // required for CORS on api.php's anonymous GET (Special:EntityData needs no such param -- see fetchEntity)
  });
  const res = await fetch(`${WIKIDATA_API}?${params}`, { signal });
  if (!res.ok) {
    throw new Error(`Wikidata search failed (${res.status})`);
  }
  const data = (await res.json()) as { search?: { id: string; label?: string; description?: string }[] };
  return (data.search ?? []).map((hit) => ({
    qid: hit.id,
    label: hit.label ?? hit.id,
    description: hit.description ?? null,
  }));
}

interface WikidataSnak {
  mainsnak?: { datavalue?: { value?: unknown } };
}

interface WikidataEntity {
  labels?: Record<string, { value?: string }>;
  claims?: Record<string, WikidataSnak[]>;
}

async function fetchEntity(qid: string, signal?: AbortSignal): Promise<WikidataEntity> {
  const res = await fetch(`${WIKIDATA_ENTITY_DATA}/${encodeURIComponent(qid)}.json`, { signal });
  if (!res.ok) {
    throw new Error(`Wikidata entity fetch failed for ${qid} (${res.status})`);
  }
  const data = (await res.json()) as { entities: Record<string, WikidataEntity> };
  return data.entities[qid];
}

function readLabel(entity: WikidataEntity, qid: string): string {
  return entity.labels?.en?.value ?? qid;
}

function readCoords(entity: WikidataEntity): { lat: number; long: number } | null {
  const value = entity.claims?.P625?.[0]?.mainsnak?.datavalue?.value as
    | { latitude?: number; longitude?: number }
    | undefined;
  if (value?.latitude == null || value?.longitude == null) return null;
  return { lat: value.latitude, long: value.longitude };
}

function readQidList(entity: WikidataEntity, property: string): string[] {
  const claims = entity.claims?.[property] ?? [];
  return claims
    .map((c) => (c.mainsnak?.datavalue?.value as { id?: string } | undefined)?.id)
    .filter((id): id is string => Boolean(id));
}

function readGeoshapeTitle(entity: WikidataEntity): string | null {
  const value = entity.claims?.P3896?.[0]?.mainsnak?.datavalue?.value;
  return typeof value === "string" ? value : null;
}

/** Walks P131 ("located in the administrative territorial entity") from
 * `startQid` up to the root, one entity fetch per level. Returns the chain
 * leaf-first (`[0]` is `startQid` itself, last is the root -- a country, or
 * wherever the chain runs out of P131 claims) -- callers that create
 * ancestors top-down (see the plan: a child needs its parent's handle to
 * exist first) should reverse this before creating anything, and should
 * skip `[0]` since that's the place already being edited, not a new
 * ancestor.
 *
 * Cycle-guarded (never re-fetches a QID already in the chain -- a
 * malformed P131 loop just truncates the chain there rather than hanging)
 * and depth-capped at MAX_CHAIN_DEPTH. */
export async function fetchWikidataChain(
  startQid: string,
  signal?: AbortSignal
): Promise<WikidataPlaceNode[]> {
  const chain: WikidataPlaceNode[] = [];
  const visited = new Set<string>();
  let qid: string | undefined = startQid;
  while (qid && !visited.has(qid) && chain.length < MAX_CHAIN_DEPTH) {
    visited.add(qid);
    const entity = await fetchEntity(qid, signal);
    const coords = readCoords(entity);
    const instanceOf = readQidList(entity, "P31");
    chain.push({
      qid,
      label: readLabel(entity, qid),
      lat: coords?.lat ?? null,
      long: coords?.long ?? null,
      instanceOf,
      placeType: guessPlaceType(instanceOf),
      geoshapeTitle: readGeoshapeTitle(entity),
    });
    qid = readQidList(entity, "P131")[0];
  }
  return chain;
}

/** Minimum gap between successive fetchWikidataGeoshape calls -- Wikidata/
 * Commons throttles unauthenticated callers after roughly 8 rapid
 * sequential requests (found empirically). A single lookup's chain is only
 * ever a handful of levels, so this keeps a chain-walk's geoshape fetches
 * safely under that without needing a queue or backoff/retry logic. Module-
 * level and shared across every call (not per-caller) so this holds even if
 * two lookups happen to overlap. */
const GEOSHAPE_THROTTLE_MS = 300;
let lastGeoshapeCallAt = 0;

async function throttleGeoshapeCall(): Promise<void> {
  const wait = lastGeoshapeCallAt + GEOSHAPE_THROTTLE_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastGeoshapeCallAt = Date.now();
}

/** Fetches a Commons `Data:*.map` page (a P3896 geoshape value, e.g.
 * "Data:Alabama.map") and returns its boundary as GeoJSON features, `[]` on
 * any failure -- a missing/malformed page contributes nothing rather than
 * failing the caller (same "one bad attachment shouldn't blank out
 * everything else" philosophy as kmlMedia.ts's fetchKmlFeatures). Verified
 * live (2026-09-09): `action=query&prop=revisions&rvprop=content` with
 * `origin=*` returns `Access-Control-Allow-Origin: *`, so this is a plain
 * client-side fetch, no proxy/API key -- same pattern as this module's
 * other two calls. Self-throttled (see throttleGeoshapeCall) since this is
 * the one call in this module known to hit Wikimedia's anonymous-use rate
 * limit when called several times in quick succession. */
export async function fetchWikidataGeoshape(dataTitle: string, signal?: AbortSignal): Promise<Feature[]> {
  await throttleGeoshapeCall();
  try {
    const params = new URLSearchParams({
      action: "query",
      titles: dataTitle,
      prop: "revisions",
      rvprop: "content",
      format: "json",
      origin: "*",
    });
    const res = await fetch(`${COMMONS_API}?${params}`, { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      query?: { pages?: Record<string, { revisions?: { "*"?: string }[] }> };
    };
    const page = Object.values(data.query?.pages ?? {})[0];
    const content = page?.revisions?.[0]?.["*"];
    if (!content) return [];
    // Commons wraps the GeoJSON in its own map-data envelope
    // ({license, description, sources, data: <GeoJSON>, ...}) -- `.data` is
    // the actual FeatureCollection/Feature.
    const geo = (JSON.parse(content) as { data?: { type?: string; features?: Feature[] } | Feature }).data;
    if (!geo || typeof geo !== "object") return [];
    if (geo.type === "FeatureCollection") return (geo as { features?: Feature[] }).features ?? [];
    if (geo.type === "Feature") return [geo as Feature];
    return [];
  } catch {
    return [];
  }
}
