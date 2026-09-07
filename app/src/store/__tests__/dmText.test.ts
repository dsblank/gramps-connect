import { describe, expect, it } from "vitest";
import { formatDmText, parseDmText } from "../dmText";

describe("dmText", () => {
  it("round-trips recipient, author and message", () => {
    const raw = formatDmText("bob", "alice", "hey, got a minute?");
    expect(parseDmText(raw)).toEqual({ recipient: "bob", author: "alice", message: "hey, got a minute?" });
  });

  it("preserves a message that itself contains newlines and colons", () => {
    const raw = formatDmText("bob", "alice", "line one\nsee: line two");
    expect(parseDmText(raw)).toEqual({ recipient: "bob", author: "alice", message: "line one\nsee: line two" });
  });

  it("falls back to a null recipient for text with no 'to:' header, rather than guessing", () => {
    expect(parseDmText("alice: hello")).toEqual({ recipient: null, author: "alice", message: "hello" });
  });

  it("falls back to a null author too when the remainder has no 'author: ' separator either", () => {
    expect(parseDmText("to:bob\njust some text")).toEqual({ recipient: "bob", author: null, message: "just some text" });
  });

  it("handles a bare 'to:' header with nothing after it", () => {
    expect(parseDmText("to:bob\n")).toEqual({ recipient: "bob", author: null, message: "" });
  });
});
