import { describe, expect, it, vi } from "vitest";
import {
  grampsVersionAtLeast, supportsBackgroundDelete, supportsLunarCalendars, isOrderByFormError, supportsOrderByStrings, versionAfter, withOrderByFallback,
} from "../serverCapabilities";

describe("serverCapabilities", () => {
  it("compares Gramps versions by major and minor", () => {
    expect(grampsVersionAtLeast("6.2.0", [6, 2])).toBe(true);
    expect(grampsVersionAtLeast("6.2.0-beta1", [6, 2])).toBe(true);
    expect(grampsVersionAtLeast("6.10.1", [6, 2])).toBe(true);
    expect(grampsVersionAtLeast("7.0.0", [6, 2])).toBe(true);
    expect(grampsVersionAtLeast("6.1.9", [6, 2])).toBe(false);
    expect(grampsVersionAtLeast("5.2.4", [6, 2])).toBe(false);
    expect(grampsVersionAtLeast("", [6, 2])).toBe(false);
    expect(grampsVersionAtLeast("unknown", [6, 2])).toBe(false);
  });

  it("offers the lunar calendars from Gramps 6.2", () => {
    expect(supportsLunarCalendars("6.0.8")).toBe(false);
    expect(supportsLunarCalendars("6.2.0")).toBe(true);
  });
});

describe("supportsBackgroundDelete", () => {
  it("needs gramps-web-api 3.25.0 or later", () => {
    expect(supportsBackgroundDelete("3.25.0")).toBe(true);
    expect(supportsBackgroundDelete("3.26.1")).toBe(true);
    expect(supportsBackgroundDelete("4.0.0")).toBe(true);
    expect(supportsBackgroundDelete("3.24.0")).toBe(false);
    expect(supportsBackgroundDelete("2.99.0")).toBe(false);
    expect(supportsBackgroundDelete("")).toBe(false);
  });
});

describe("supportsOrderByStrings", () => {
  it("is false on 3.25.3 and older, true on anything newer", () => {
    for (const v of ["3.25.3", "3.25.2", "3.25.1", "3.24.0", "2.9.9", "3.25"]) expect(supportsOrderByStrings(v)).toBe(false);
    for (const v of ["3.25.4", "3.26.0", "3.26.0rc1", "4.0.0", "3.26"]) expect(supportsOrderByStrings(v)).toBe(true);
  });

  it("treats an unreadable version as old", () => {
    expect(supportsOrderByStrings("")).toBe(false);
    expect(supportsOrderByStrings("dev")).toBe(false);
  });
});

describe("versionAfter", () => {
  it("compares major, minor and patch in turn", () => {
    expect(versionAfter("3.25.10", [3, 25, 2])).toBe(true);
    expect(versionAfter("3.3.0", [3, 25, 2])).toBe(false);
    expect(versionAfter(" 3.26.0 ", [3, 25, 2])).toBe(true);
  });
});

const OLD_SERVER_REJECTS_STRINGS = JSON.stringify({
  error: { code: 422, message: "json: order_by: 0: _schema: Invalid input type.", messages: { json: { order_by: { "0": { _schema: ["Invalid input type."] } } } } },
});

describe("isOrderByFormError", () => {
  it("spots a schema rejection of order_by", () => {
    expect(isOrderByFormError(422, OLD_SERVER_REJECTS_STRINGS)).toBe(true);
  });

  it("ignores other 422s, other statuses and non-JSON", () => {
    expect(isOrderByFormError(422, JSON.stringify({ error: { code: 422, message: "unknown field 'nosuch' on Person" } }))).toBe(false);
    expect(isOrderByFormError(422, JSON.stringify({ error: { messages: { json: { select: { "0": ["bad"] } } } } }))).toBe(false);
    expect(isOrderByFormError(400, OLD_SERVER_REJECTS_STRINGS)).toBe(false);
    expect(isOrderByFormError(422, "<html>")).toBe(false);
  });
});

describe("withOrderByFallback", () => {
  const reject = () => new Response(OLD_SERVER_REJECTS_STRINGS, { status: 422 });
  const ok = () => new Response("{}", { status: 200 });

  it("sends once when the guess is accepted", async () => {
    const send = vi.fn(async () => ok());
    const remember = vi.fn();
    const res = await withOrderByFallback(true, send, remember);
    expect(res.status).toBe(200);
    expect(send.mock.calls).toEqual([[true]]);
    expect(remember).not.toHaveBeenCalled();
  });

  it("retries in the other form and remembers it", async () => {
    const send = vi.fn(async (strings: boolean) => (strings ? reject() : ok()));
    const remember = vi.fn();
    const res = await withOrderByFallback(true, send, remember);
    expect(res.status).toBe(200);
    expect(send.mock.calls).toEqual([[true], [false]]);
    expect(remember).toHaveBeenCalledWith(false);
  });

  it("returns the first error, unremembered, when the retry fails too", async () => {
    const send = vi.fn(async () => reject());
    const remember = vi.fn();
    const res = await withOrderByFallback(false, send, remember);
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(OLD_SERVER_REJECTS_STRINGS);
    expect(send).toHaveBeenCalledTimes(2);
    expect(remember).not.toHaveBeenCalled();
  });

  it("doesn't retry an unrelated error", async () => {
    const send = vi.fn(async () => new Response(JSON.stringify({ error: { code: 422, message: "bad where_expr" } }), { status: 422 }));
    await withOrderByFallback(true, send, vi.fn());
    expect(send).toHaveBeenCalledTimes(1);
  });
});

