import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminUser } from "../adminApi";
import type {
  getKnownUsers as GetKnownUsers,
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
vi.mock("../adminApi", () => ({ fetchAllUsers: (token: string) => fetchAllUsers(token) }));

// knownUsers.ts's Set/directoryLoadPromise are module-level singleton
// state, same reasoning activeUsers.test.ts already documents -- fresh
// module instance per test via resetModules() + a dynamic re-import.
let getKnownUsers: typeof GetKnownUsers;
let recordKnownUser: typeof RecordKnownUser;
let subscribeKnownUsers: typeof SubscribeKnownUsers;
let loadKnownUsersFromDirectory: typeof LoadKnownUsersFromDirectory;

describe("knownUsers", () => {
  beforeEach(async () => {
    vi.resetModules();
    hasPermissions.mockReset().mockReturnValue(false);
    fetchAllUsers.mockReset();
    ({ getKnownUsers, recordKnownUser, subscribeKnownUsers, loadKnownUsersFromDirectory } = await import("../knownUsers"));
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
});
