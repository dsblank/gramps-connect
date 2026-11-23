// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isNewsCheckEnabled, onNewsCheckChange, setNewsCheckEnabled } from "../newsCheck";
import { STORAGE_KEYS } from "../storageKeys";

describe("newsCheck", () => {
  beforeEach(() => localStorage.clear());

  it("is on by default", () => {
    expect(isNewsCheckEnabled()).toBe(true);
  });

  it("keeps an old Gramplet Store switch's \"off\" until changed", () => {
    localStorage.setItem(STORAGE_KEYS.grampletStoreCheck, "false");
    expect(isNewsCheckEnabled()).toBe(false);
    setNewsCheckEnabled(true);
    expect(isNewsCheckEnabled()).toBe(true);
    expect(localStorage.getItem(STORAGE_KEYS.grampletStoreCheck)).toBeNull();
  });

  it("tells listeners when it changes", () => {
    const listener = vi.fn();
    const off = onNewsCheckChange(listener);
    setNewsCheckEnabled(false);
    expect(listener).toHaveBeenCalledWith(false);
    expect(isNewsCheckEnabled()).toBe(false);
    off();
  });
});
