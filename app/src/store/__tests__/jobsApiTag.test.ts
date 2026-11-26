import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apiFetch", () => ({ apiFetch: vi.fn(), setTokenRenewer: vi.fn() }));
vi.mock("../objectsApi", () => ({
  fetchPlainObject: vi.fn().mockResolvedValue({}),
  updateObject: vi.fn().mockResolvedValue(undefined),
}));

import { apiFetch } from "../apiFetch";
import { FILE_NAME_ATTRIBUTE, tagAndDescribeMedia } from "../jobsApi";

/** Serves `stored` on GET and returns the body of the PUT that follows. */
async function putAfter(stored: Record<string, unknown>, ...args: [string, string?, string?]) {
  vi.mocked(apiFetch)
    .mockResolvedValueOnce(new Response(JSON.stringify(stored), { status: 200 }))
    .mockResolvedValueOnce(new Response("{}", { status: 200 }));
  const [tagHandle, fileName, noteHandle] = args;
  await tagAndDescribeMedia("tok", "m1", "My rule", tagHandle, fileName, noteHandle);
  const put = vi.mocked(apiFetch).mock.calls.find(([, init]) => init?.method === "PUT");
  return JSON.parse(String(put?.[1]?.body));
}

describe("tagAndDescribeMedia", () => {
  beforeEach(() => vi.mocked(apiFetch).mockReset());

  it("adds the tag to an untagged object", async () => {
    expect((await putAfter({ tag_list: ["other"] }, "rule")).tag_list).toEqual(["other", "rule"]);
  });

  it("doesn't add the tag again when re-saving an already-tagged object (#56)", async () => {
    expect((await putAfter({ tag_list: ["rule"] }, "rule")).tag_list).toEqual(["rule"]);
  });

  it("collapses duplicate tags left by earlier saves", async () => {
    expect((await putAfter({ tag_list: ["rule", "other", "rule", "rule"] }, "rule")).tag_list).toEqual(["rule", "other"]);
  });

  it("doesn't repeat an existing file-name attribute or note", async () => {
    const body = await putAfter(
      { tag_list: [], note_list: ["n1"], attribute_list: [{ _class: "Attribute", type: FILE_NAME_ATTRIBUTE, value: "a.csv" }] },
      "t", "a.csv", "n1",
    );
    expect(body.attribute_list).toHaveLength(1);
    expect(body.note_list).toEqual(["n1"]);
  });
});
