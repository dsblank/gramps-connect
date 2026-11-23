import { describe, expect, it } from "vitest";
import { acknowledgeBlogNews, computeBlogNews, parseFeedIds } from "../blogNews";

const FEED = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Gramps Connect blog</title>
  <id>https://example.org/blog/</id>
  <entry>
    <title>Two</title>
    <id>https://example.org/blog/two.html</id>
    <content type="html">&lt;p&gt;&lt;id&gt;not an id&lt;/id&gt;&lt;/p&gt;</content>
  </entry>
  <entry>
    <title>One</title>
    <id>https://example.org/blog/one.html</id>
  </entry>
</feed>`;

describe("parseFeedIds", () => {
  it("lists the entries' ids, not the feed's own", () => {
    expect(parseFeedIds(FEED)).toEqual(["https://example.org/blog/two.html", "https://example.org/blog/one.html"]);
  });
  it("finds nothing in an empty or non-feed body", () => {
    expect(parseFeedIds("")).toEqual([]);
    expect(parseFeedIds("<html><body>404</body></html>")).toEqual([]);
  });
});

describe("computeBlogNews", () => {
  it("makes the first check a baseline, with nothing pending", () => {
    expect(computeBlogNews(["b", "a"], null, 5)).toEqual({ checkedAt: 5, seenIds: ["b", "a"], pending: [] });
  });
  it("reports posts added since", () => {
    const prev = { checkedAt: 1, seenIds: ["a"], pending: [] };
    expect(computeBlogNews(["c", "b", "a"], prev, 9)).toEqual({ checkedAt: 9, seenIds: ["a"], pending: ["c", "b"] });
  });
  it("drops a pending post that was taken down", () => {
    const prev = { checkedAt: 1, seenIds: ["a"], pending: ["b"] };
    expect(computeBlogNews(["a"], prev, 9).pending).toEqual([]);
  });
});

describe("acknowledgeBlogNews", () => {
  it("moves pending posts into seen and keeps checkedAt", () => {
    const prev = { checkedAt: 3, seenIds: ["a"], pending: ["c", "b"] };
    expect(acknowledgeBlogNews(prev)).toEqual({ checkedAt: 3, seenIds: ["a", "c", "b"], pending: [] });
  });
  it("before the first check, writes nothing, so that check is still a baseline", () => {
    expect(acknowledgeBlogNews(null)).toBeNull();
  });
});
