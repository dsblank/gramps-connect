import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminUser } from "../adminApi";
import type {
  getKnownUsers as GetKnownUsers,
  isGuestUser as IsGuestUser,
  loadKnownUsersFromDirectory as LoadKnownUsersFromDirectory,
  recordKnownUser as RecordKnownUser,
  subscribeKnownUsers as SubscribeKnownUsers,
} from "../knownUsers";

const hasPermissions = vi.fn((..._perms: string[]) => false);
const fetchAllUsers = vi.fn<(token: string) => Promise<AdminUser[]>>();

vi.mock("../../auth/auth", () => ({
  hasPermissions: (...perms: string[]) => hasPermissions(...perms),
  getToken: vi.fn(async () => "tok"),
}));
vi.mock("../adminApi", () => ({ fetchAllUsers: (token: string) => fetchAllUsers(token), ROLE_GUEST: 0 }));

// knownUsers.ts's Set/directoryLoadPromise are module-level singleton
// state, same reasoning activeUsers.test.ts already documents -- fresh
// module instance per test via resetModules() + a dynamic re-import.
let getKnownUsers: typeof GetKnownUsers;
let recordKnownUser: typeof RecordKnownUser;
let subscribeKnownUsers: typeof SubscribeKnownUsers;
let loadKnownUsersFromDirectory: typeof LoadKnownUsersFromDirectory;
let isGuestUser: typeof IsGuestUser;

describe("knownUsers", () => {
  beforeEach(async () => {
    vi.resetModules();
    hasPermissions.mockReset().mockReturnValue(false);
    fetchAllUsers.mockReset();
    ({ getKnownUsers, recordKnownUser, subscribeKnownUsers, loadKnownUsersFromDirectory, isGuestUser } = await import("../knownUsers"));
  });

  it("starts empty", () => {
    expect(getKnownUsers()).toEqual([]);
  });

  it("records a seen username", () => {
    recordKnownUser("bob");
    expect(getKnownUsers()).toEqual(["bob"]);
  });

  it("never decays -- recording is permanent, unlike activeUsers.ts", () => {
    recordKnownUser("bob");
    recordKnownUser("carol");
    expect(getKnownUsers()).toEqual(["bob", "carol"]);
  });

  it("doesn't duplicate an already-known user", () => {
    recordKnownUser("bob");
    recordKnownUser("bob");
    expect(getKnownUsers()).toEqual(["bob"]);
  });

  it("sorts alphabetically", () => {
    recordKnownUser("carol");
    recordKnownUser("alice");
    expect(getKnownUsers()).toEqual(["alice", "carol"]);
  });

  it("notifies subscribers when a new user is recorded", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeKnownUsers(listener);
    recordKnownUser("bob");
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("skips the directory fetch entirely when the role can't see other users", async () => {
    hasPermissions.mockReturnValue(false);
    loadKnownUsersFromDirectory();
    await vi.waitFor(() => expect(fetchAllUsers).not.toHaveBeenCalled());
  });

  it("merges the full user list in when the role permits it", async () => {
    hasPermissions.mockReturnValue(true);
    fetchAllUsers.mockResolvedValue([{ name: "dave", role: 1 }, { name: "erin", role: 1 }]);

    loadKnownUsersFromDirectory();
    await vi.waitFor(() => expect(getKnownUsers()).toEqual(["dave", "erin"]));
  });

  it("only fetches the directory once per session", async () => {
    hasPermissions.mockReturnValue(true);
    fetchAllUsers.mockResolvedValue([{ name: "dave", role: 1 }]);

    loadKnownUsersFromDirectory();
    loadKnownUsersFromDirectory();
    await vi.waitFor(() => expect(getKnownUsers()).toEqual(["dave"]));
    expect(fetchAllUsers).toHaveBeenCalledTimes(1);
  });

  it("re-fetches the directory when force is true, e.g. a user created since the first load", async () => {
    hasPermissions.mockReturnValue(true);
    fetchAllUsers.mockResolvedValueOnce([{ name: "dave", role: 1 }]);
    loadKnownUsersFromDirectory();
    await vi.waitFor(() => expect(getKnownUsers()).toEqual(["dave"]));

    fetchAllUsers.mockResolvedValueOnce([{ name: "dave", role: 1 }, { name: "erin", role: 1 }]);
    loadKnownUsersFromDirectory(true);
    await vi.waitFor(() => expect(getKnownUsers()).toEqual(["dave", "erin"]));
    expect(fetchAllUsers).toHaveBeenCalledTimes(2);
  });

  it("keeps a guest out of getKnownUsers() -- they can't be messaged", async () => {
    hasPermissions.mockReturnValue(true);
    fetchAllUsers.mockResolvedValue([{ name: "dave", role: 1 }, { name: "gale", role: 0 }]);

    loadKnownUsersFromDirectory();
    await vi.waitFor(() => expect(getKnownUsers()).toEqual(["dave"]));
    expect(isGuestUser("gale")).toBe(true);
    expect(isGuestUser("dave")).toBe(false);
  });

  it("doesn't assume a live-sync-recorded username (no role info) is a guest", () => {
    recordKnownUser("bob");
    expect(isGuestUser("bob")).toBe(false);
    expect(getKnownUsers()).toEqual(["bob"]);
  });

  it("drops a user from the snapshot if the directory later reports them promoted out of guest, and vice versa", async () => {
    hasPermissions.mockReturnValue(true);
    fetchAllUsers.mockResolvedValueOnce([{ name: "gale", role: 0 }]);
    loadKnownUsersFromDirectory();
    await vi.waitFor(() => expect(isGuestUser("gale")).toBe(true));
    expect(getKnownUsers()).toEqual([]);

    fetchAllUsers.mockResolvedValueOnce([{ name: "gale", role: 1 }]);
    loadKnownUsersFromDirectory(true);
    await vi.waitFor(() => expect(getKnownUsers()).toEqual(["gale"]));
    expect(isGuestUser("gale")).toBe(false);
  });
});
