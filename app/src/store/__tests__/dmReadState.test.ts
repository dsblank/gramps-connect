import { beforeEach, describe, expect, it, vi } from "vitest";

// vite.config.ts's test environment is "node", not jsdom -- same stand-in
// columnWidths.test.ts already uses for a localStorage-backed module.
class FakeLocalStorage {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  clear() {
    this.store.clear();
  }
}
vi.stubGlobal("localStorage", new FakeLocalStorage());

import { getLastReadAt, isUnread, markRead } from "../dmReadState";

describe("dmReadState", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reports 0 for a partner with nothing ever marked read", () => {
    expect(getLastReadAt("bob")).toBe(0);
  });

  it("round-trips a marked-read timestamp, in unix seconds", () => {
    markRead("bob", 1_700_000_000);
    expect(getLastReadAt("bob")).toBe(1_700_000_000);
  });

  it("keeps different partners' read state independent", () => {
    markRead("bob", 100);
    markRead("carol", 200);
    expect(getLastReadAt("bob")).toBe(100);
    expect(getLastReadAt("carol")).toBe(200);
  });

  it("treats a message newer than the last read time as unread", () => {
    markRead("bob", 100);
    expect(isUnread("bob", 200)).toBe(true);
  });

  it("treats a message at or before the last read time as read", () => {
    markRead("bob", 200);
    expect(isUnread("bob", 200)).toBe(false);
    expect(isUnread("bob", 100)).toBe(false);
  });

  it("treats no incoming message at all as read (nothing to be unread about)", () => {
    expect(isUnread("bob", undefined)).toBe(false);
  });

  it("treats every message as unread for a partner with nothing marked read yet", () => {
    expect(isUnread("bob", 1)).toBe(true);
  });
});
