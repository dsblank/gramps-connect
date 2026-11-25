import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as { url: string; init?: RequestInit }[]);
const stored = vi.hoisted(() => ({ text: "" }));
vi.mock("../apiFetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../apiFetch")>()),
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (!init?.method || init.method === "GET") return new Response(JSON.stringify({ handle: "T1", text: { string: stored.text } }), { status: 200 });
    if (init.method === "PUT") stored.text = (JSON.parse(init.body as string) as { text: { string: string } }).text.string;
    return new Response(JSON.stringify([{ type: "add", handle: "T1" }]), { status: 200 });
  }),
}));

import { caseTopicFragment } from "../board/caseTopic";
import { createTopic, updateTopic } from "../topicsApi";

beforeEach(() => {
  calls.length = 0;
});

describe("a case's discussion", () => {
  it("is a topic whose text names the case, findable by a fragment", async () => {
    await createTopic("tok", "Ruth's parents", "Who were they?", undefined, "case1");
    const text = (JSON.parse(calls[0].init!.body as string) as { text: { string: string } }).text.string;
    expect(text).toContain(caseTopicFragment("case1"));
    expect(JSON.parse(text)).toEqual({ title: "Ruth's parents", description: "Who were they?", caseFile: "case1" });
  });

  it("keeps its case when someone edits the topic's title", async () => {
    stored.text = JSON.stringify({ title: "Old", caseFile: "case1" });
    await updateTopic("tok", "T1", { title: "New title" });
    expect(JSON.parse(stored.text)).toEqual({ title: "New title", caseFile: "case1" });
  });
});
