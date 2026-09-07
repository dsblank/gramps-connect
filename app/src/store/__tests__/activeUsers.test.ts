import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { getActiveUsers as GetActiveUsers, recordActivity as RecordActivity, subscribeActiveUsers as SubscribeActiveUsers } from "../activeUsers";

vi.mock("../../auth/auth", () => ({ getCurrentUsername: vi.fn(() => "self") }));

// activeUsers.ts's Map is module-level singleton state (no reset export --
// there's no reason a real caller would ever need one), so each test gets a
// fresh module instance via resetModules() + a dynamic re-import rather than
// relying on the same imported functions across tests.
let getActiveUsers: typeof GetActiveUsers;
let recordActivity: typeof RecordActivity;
let subscribeActiveUsers: typeof SubscribeActiveUsers;

describe("activeUsers", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    ({ getActiveUsers, recordActivity, subscribeActiveUsers } = await import("../activeUsers"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports a recorded user as active", () => {
    recordActivity("alice");
    expect(getActiveUsers()).toEqual(["alice"]);
  });

  it("excludes the signed-in user", () => {
    recordActivity("self");
    expect(getActiveUsers()).toEqual([]);
  });

  it("sorts most-recently-active first", () => {
    recordActivity("alice");
    vi.advanceTimersByTime(1000);
    recordActivity("bob");
    expect(getActiveUsers()).toEqual(["bob", "alice"]);
  });

  it("drops a user once they age out of the active window", () => {
    // Pruning runs on an interval started by the first subscriber (see
    // activeUsers.ts's subscribeActiveUsers) -- real callers always
    // subscribe via useSyncExternalStore, so this mirrors that instead of
    // expecting getActiveUsers() to decay on its own between mutations.
    const unsubscribe = subscribeActiveUsers(() => {});
    recordActivity("alice");
    vi.advanceTimersByTime(5 * 60_000 + 30_000);
    expect(getActiveUsers()).toEqual([]);
    unsubscribe();
  });

  it("re-activity refreshes a user's position instead of duplicating them", () => {
    recordActivity("alice");
    vi.advanceTimersByTime(1000);
    recordActivity("bob");
    vi.advanceTimersByTime(1000);
    recordActivity("alice");
    expect(getActiveUsers()).toEqual(["alice", "bob"]);
  });

  it("notifies subscribers when the prune interval clears a stale entry", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeActiveUsers(listener);
    recordActivity("alice");
    listener.mockClear();

    vi.advanceTimersByTime(5 * 60_000 + 30_000);
    expect(listener).toHaveBeenCalled();
    expect(getActiveUsers()).toEqual([]);

    unsubscribe();
  });
});
