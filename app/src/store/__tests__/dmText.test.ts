import { describe, expect, it } from "vitest";
import { buildDmInvolvesExpr, buildDmPairExpr, formatDmText, parseDmText } from "../dmText";

// GOQL's `'literal' in field` is a plain substring test -- extract the
// quoted literals a where_expr builder embedded and unescape \n the same
// way the server's GOQL parser would (see dmPrefixLiteral's own doc
// comment for why the builder emits \n rather than a real newline), so
// these tests can check semantics -- does it actually match real
// formatDmText() output? -- without needing a live GOQL engine.
function literals(expr: string): string[] {
  return [...expr.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\n/g, "\n"));
}

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

describe("buildDmPairExpr", () => {
  it("matches a real message in either direction between the two named users", () => {
    const lits = literals(buildDmPairExpr("alice", "bob"));
    expect(lits.some((l) => formatDmText("bob", "alice", "hi").includes(l))).toBe(true);
    expect(lits.some((l) => formatDmText("alice", "bob", "hi back").includes(l))).toBe(true);
  });

  it("doesn't match an unrelated pair's conversation", () => {
    const lits = literals(buildDmPairExpr("alice", "bob"));
    const unrelated = formatDmText("dave", "carol", "unrelated");
    expect(lits.some((l) => unrelated.includes(l))).toBe(false);
  });

  it("strips quote/backslash characters from freely-typed names", () => {
    const expr = buildDmPairExpr("ali'ce", "bo\\b");
    expect(expr).not.toContain("ali'ce");
    expect(expr).not.toContain("bo\\b");
  });
});

describe("buildDmInvolvesExpr", () => {
  it("matches a message the user sent, and one sent to them", () => {
    const lits = literals(buildDmInvolvesExpr("alice"));
    expect(lits.some((l) => formatDmText("alice", "bob", "hi alice").includes(l))).toBe(true);
    expect(lits.some((l) => formatDmText("bob", "alice", "hi bob").includes(l))).toBe(true);
  });

  it("doesn't match a conversation the user isn't part of", () => {
    const lits = literals(buildDmInvolvesExpr("alice"));
    const unrelated = formatDmText("dave", "carol", "unrelated");
    expect(lits.some((l) => unrelated.includes(l))).toBe(false);
  });
});
