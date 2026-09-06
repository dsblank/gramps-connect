import { describe, expect, it, vi } from "vitest";
import { fetchWikidataChain, searchWikidata } from "../wikidataApi";

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
  opts: { lat?: number; long?: number; parents?: string[]; instanceOf?: string[] } = {}
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

  it("leaves lat/long null when there's no P625 claim at all", async () => {
    mockFetchSequence([entity("Qx", "No Coords")]);
    const chain = await fetchWikidataChain("Qx");
    expect(chain[0]).toMatchObject({ lat: null, long: null });
  });
});
