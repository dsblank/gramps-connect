// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("../apiFetch", () => ({ apiFetch }));
vi.mock("../../auth/auth", () => ({ getToken: async () => "tok" }));
vi.mock("../../i18n/i18n", () => ({ t: (s: string) => (s === "{0}'s {1}" ? "{1} van {0}" : s) }));

import { fetchRelationshipPaths, useRelationshipPaths } from "../relationshipPathsApi";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** H's wife W, whose brother B the server names, and B's wife BW it doesn't. */
function server(url: string) {
  if (url.includes("/relations/B/BW/paths")) {
    return json([{ steps: [{ handle: "B", link: null, relationship_string: "" }, { handle: "BW", link: "spouse", relationship_string: "wife" }] }]);
  }
  if (url.includes("/paths")) {
    const [, from, to] = /relations\/(\w+)\/(\w+)\/paths/.exec(url)!;
    if (from === "H" && to === "BW") {
      return json([
        {
          steps: [
            { handle: "H", link: null, relationship_string: "" },
            { handle: "W", link: "spouse", relationship_string: "wife" },
            { handle: "B", link: "sibling", relationship_string: "brother-in-law" },
            { handle: "BW", link: "spouse", relationship_string: null },
          ],
        },
      ]);
    }
    return json([]);
  }
  if (url.includes("/api/people/")) return json([]);
  throw new Error(`unexpected ${url}`);
}

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (url: string) => server(url));
});
afterEach(() => vi.useRealTimers());

describe("fetchRelationshipPaths", () => {
  it("asks /paths with a bearer token and builds labels in the user's language", async () => {
    const [path] = await fetchRelationshipPaths("H", "BW", { maxPaths: 1 });
    const [url, init] = apiFetch.mock.calls[0];
    expect(url).toContain("/api/relations/H/BW/paths?depth=15&max=5");
    expect((init as RequestInit).headers).toEqual({ Authorization: "Bearer tok" });
    expect(path.steps[3].label).toBe("wife van brother-in-law");
  });
});

describe("useRelationshipPaths", () => {
  it("waits before asking, and asks only for where it stops", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ to }) => useRelationshipPaths("H", to, { delayMs: 300, revision: 1 }), {
      initialProps: { to: "X1" },
    });
    expect(result.current.status).toBe("loading");
    rerender({ to: "X2" });
    rerender({ to: "BW" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    const searched = apiFetch.mock.calls.map(([u]) => u as string).filter((u) => /relations\/H\//.test(u));
    expect(searched.every((u) => u.includes("/H/BW/"))).toBe(true);
    expect(result.current.status).toBe("done");
  });

  it("reuses an earlier answer for the same pair and revision", async () => {
    const first = renderHook(() => useRelationshipPaths("H", "BW", { revision: 2 }));
    await vi.waitFor(() => expect(first.result.current.status).toBe("done"));
    const calls = apiFetch.mock.calls.length;
    const second = renderHook(() => useRelationshipPaths("H", "BW", { revision: 2 }));
    await vi.waitFor(() => expect(second.result.current.status).toBe("done"));
    expect(apiFetch.mock.calls.length).toBe(calls);
    // An edit since: a fresh search.
    const third = renderHook(() => useRelationshipPaths("H", "BW", { revision: 3 }));
    await vi.waitFor(() => expect(third.result.current.status).toBe("done"));
    expect(apiFetch.mock.calls.length).toBeGreaterThan(calls);
  });

  it("does nothing for one person, or with no one to compare with", () => {
    expect(renderHook(() => useRelationshipPaths("H", "H")).result.current.status).toBe("idle");
    expect(renderHook(() => useRelationshipPaths(null, "H")).result.current.status).toBe("idle");
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
