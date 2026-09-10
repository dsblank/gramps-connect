import { describe, expect, it, vi } from "vitest";
import { fetchWikidataChain, fetchWikidataGeoshape, searchWikidata } from "../wikidataApi";

function mockFetchSequence(responses: unknown[]) {
  let call = 0;
  const fetchMock = vi.fn(async (_input: RequestInfo | URL) => {
    const body = responses[call];
    call += 1;
    return { ok: true, json: async () => body } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("searchWikidata", () => {
  it("sends the expected query params, including origin=* for CORS", async () => {
    const fetchMock = mockFetchSequence([{ search: [] }]);
    await searchWikidata("Indianapolis");
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe("https://www.wikidata.org/w/api.php");
    expect(url.searchParams.get("action")).toBe("wbsearchentities");
    expect(url.searchParams.get("search")).toBe("Indianapolis");
    expect(url.searchParams.get("language")).toBe("en");
    expect(url.searchParams.get("format")).toBe("json");
    expect(url.searchParams.get("origin")).toBe("*");
  });

  it("maps id/label/description, defaulting a missing description to null", async () => {
    mockFetchSequence([
      {
        search: [
          { id: "Q6346", label: "Indianapolis", description: "capital city of Indiana" },
          { id: "Q123", label: "Something" },
        ],
      },
    ]);
    const results = await searchWikidata("Indianapolis");
    expect(results).toEqual([
      { qid: "Q6346", label: "Indianapolis", description: "capital city of Indiana" },
      { qid: "Q123", label: "Something", description: null },
    ]);
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response));
    await expect(searchWikidata("x")).rejects.toThrow("Wikidata search failed (500)");
  });
});

/** Builds a Special:EntityData-shaped response for one entity, with only
 * the claims this module actually reads. */
function entity(
  qid: string,
  label: string,
  opts: { lat?: number; long?: number; parents?: string[]; instanceOf?: string[]; geoshapeTitle?: string } = {}
) {
  const claims: Record<string, unknown[]> = {};
  if (opts.lat != null && opts.long != null) {
    claims.P625 = [{ mainsnak: { datavalue: { value: { latitude: opts.lat, longitude: opts.long } } } }];
  }
  if (opts.parents) {
    claims.P131 = opts.parents.map((id) => ({ mainsnak: { datavalue: { value: { id } } } }));
  }
  if (opts.instanceOf) {
    claims.P31 = opts.instanceOf.map((id) => ({ mainsnak: { datavalue: { value: { id } } } }));
  }
  if (opts.geoshapeTitle) {
    claims.P3896 = [{ mainsnak: { datavalue: { value: opts.geoshapeTitle } } }];
  }
  return { entities: { [qid]: { labels: { en: { value: label } }, claims } } };
}

describe("fetchWikidataChain", () => {
  it("walks P131 leaf-first up to the root (no P131 claim), reading P625/P31 at each level", async () => {
    mockFetchSequence([
      entity("Q6346", "Indianapolis", { lat: 39.7686, long: -86.1581, parents: ["Q506230"], instanceOf: ["Q1549591"] }),
      entity("Q506230", "Marion County", { lat: 39.78, long: -86.14, parents: ["Q1415"], instanceOf: ["Q28575"] }),
      entity("Q1415", "Indiana", { lat: 39.9333, long: -86.2167, parents: ["Q30"], instanceOf: ["Q35657"] }),
      entity("Q30", "United States", { lat: 39.828, long: -98.58, instanceOf: ["Q6256"] }),
    ]);
    const chain = await fetchWikidataChain("Q6346");
    expect(chain.map((n) => n.qid)).toEqual(["Q6346", "Q506230", "Q1415", "Q30"]);
    expect(chain.map((n) => n.placeType)).toEqual(["City", "County", "State", "Country"]);
    expect(chain[0]).toMatchObject({ label: "Indianapolis", lat: 39.7686, long: -86.1581 });
    expect(chain[3]).toMatchObject({ label: "United States", lat: 39.828, long: -98.58 });
  });

  it("stops at a cycle instead of looping forever", async () => {
    mockFetchSequence([
      entity("Qa", "A", { parents: ["Qb"] }),
      entity("Qb", "B", { parents: ["Qa"] }), // points back at Qa
    ]);
    const chain = await fetchWikidataChain("Qa");
    expect(chain.map((n) => n.qid)).toEqual(["Qa", "Qb"]);
  });

  it("caps depth even without a cycle", async () => {
    const responses = Array.from({ length: 12 }, (_, i) =>
      entity(`Q${i}`, `Level ${i}`, { parents: [`Q${i + 1}`] })
    );
    mockFetchSequence(responses);
    const chain = await fetchWikidataChain("Q0");
    expect(chain.length).toBe(8);
  });

  it("leaves placeType null when no instance-of QID is in the guess table", async () => {
    mockFetchSequence([entity("Qx", "Mystery Place", { instanceOf: ["Q999999999"] })]);
    const chain = await fetchWikidataChain("Qx");
    expect(chain[0].placeType).toBeNull();
  });

  it("guesses a non-U.S. administrative division from the generated table (a French commune)", async () => {
    mockFetchSequence([entity("Q90", "Paris", { instanceOf: ["Q484170"] })]);
    const chain = await fetchWikidataChain("Q90");
    expect(chain[0].placeType).toBe("Municipality");
  });

  it("leaves lat/long null when there's no P625 claim at all", async () => {
    mockFetchSequence([entity("Qx", "No Coords")]);
    const chain = await fetchWikidataChain("Qx");
    expect(chain[0]).toMatchObject({ lat: null, long: null });
  });

  it("captures P3896's value as geoshapeTitle, null when absent", async () => {
    mockFetchSequence([
      entity("Q173", "Alabama", { parents: ["Q30"], geoshapeTitle: "Data:Alabama.map" }),
      entity("Q30", "United States"),
    ]);
    const chain = await fetchWikidataChain("Q173");
    expect(chain[0].geoshapeTitle).toBe("Data:Alabama.map");
    expect(chain[1].geoshapeTitle).toBeNull();
  });
});

describe("fetchWikidataGeoshape", () => {
  /** A Commons `Data:*.map` page's action=query response, wrapping the
   * given GeoJSON value the way Commons' own map-data envelope does (see
   * fetchWikidataGeoshape's own doc comment). */
  function commonsPage(data: unknown) {
    return {
      query: {
        pages: {
          "12345": {
            revisions: [{ "*": JSON.stringify({ license: "CC0-1.0", data }) }],
          },
        },
      },
    };
  }

  it("sends titles and origin=* as expected query params", async () => {
    const fetchMock = mockFetchSequence([commonsPage({ type: "FeatureCollection", features: [] })]);
    await fetchWikidataGeoshape("Data:Alabama.map");
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe("https://commons.wikimedia.org/w/api.php");
    expect(url.searchParams.get("action")).toBe("query");
    expect(url.searchParams.get("titles")).toBe("Data:Alabama.map");
    expect(url.searchParams.get("prop")).toBe("revisions");
    expect(url.searchParams.get("origin")).toBe("*");
  });

  it("unwraps a FeatureCollection's features", async () => {
    const feature = { type: "Feature", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } };
    mockFetchSequence([commonsPage({ type: "FeatureCollection", features: [feature] })]);
    const features = await fetchWikidataGeoshape("Data:Alabama.map");
    expect(features).toEqual([feature]);
  });

  it("wraps a bare Feature (not a FeatureCollection) into a single-element array", async () => {
    const feature = { type: "Feature", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } };
    mockFetchSequence([commonsPage(feature)]);
    const features = await fetchWikidataGeoshape("Data:Something.map");
    expect(features).toEqual([feature]);
  });

  it("returns [] when the page has no revision content (page doesn't exist)", async () => {
    mockFetchSequence([{ query: { pages: { "-1": { missing: "" } } } }]);
    const features = await fetchWikidataGeoshape("Data:NoSuchPage.map");
    expect(features).toEqual([]);
  });

  it("returns [] on a non-ok response, without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response));
    await expect(fetchWikidataGeoshape("Data:Alabama.map")).resolves.toEqual([]);
  });

  it("returns [] when the revision content isn't valid JSON, without throwing", async () => {
    mockFetchSequence([
      { query: { pages: { "1": { revisions: [{ "*": "not json" }] } } } },
    ]);
    await expect(fetchWikidataGeoshape("Data:Alabama.map")).resolves.toEqual([]);
  });

  it("returns [] when fetch itself rejects, without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    await expect(fetchWikidataGeoshape("Data:Alabama.map")).resolves.toEqual([]);
  });
});
