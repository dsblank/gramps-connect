import { describe, expect, it } from "vitest";
import { buildTopicMessageExpr, formatTopicMessageText, parseTopicMessageText } from "../topicText";

describe("formatTopicMessageText / parseTopicMessageText", () => {
  it("round-trips a topic handle, author and message", () => {
    const raw = formatTopicMessageText("N-TOPIC-1", "alice", "hello there");
    expect(raw).toBe("N-TOPIC-1\nalice: hello there");
    expect(parseTopicMessageText(raw)).toEqual({
      topicHandle: "N-TOPIC-1",
      author: "alice",
      message: "hello there",
    });
  });

  it("preserves a colon inside the message itself", () => {
    const raw = formatTopicMessageText("N-TOPIC-1", "alice", "note: check the 1850 census");
    expect(parseTopicMessageText(raw)).toEqual({
      topicHandle: "N-TOPIC-1",
      author: "alice",
      message: "note: check the 1850 census",
    });
  });

  it("falls back to no topic handle (and authoredText.ts's own no-author fallback) when the first line has no newline at all", () => {
    expect(parseTopicMessageText("just some plain text")).toEqual({
      topicHandle: null,
      author: null,
      message: "just some plain text",
    });
  });
});

describe("buildTopicMessageExpr", () => {
  it("matches an exact substring of the topic handle followed by a newline", () => {
    expect(buildTopicMessageExpr("N-TOPIC-1")).toBe("'N-TOPIC-1\\n' in text.string");
  });
});
