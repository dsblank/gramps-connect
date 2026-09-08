import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getRefreshToken, loginWithRefreshToken } = vi.hoisted(() => ({
  getRefreshToken: vi.fn<() => string | null>(),
  loginWithRefreshToken: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../auth", () => ({ getRefreshToken, loginWithRefreshToken }));

// vite.config.ts's test environment is "node", not jsdom -- there's no real
// `window`/MessageEvent here, so this stands in with just enough of a
// window (an addEventListener/removeEventListener registry, `location`,
// `open`, `opener`) for openHandoffWindow/tryHandoffLogin to run against.
// `dispatch` fakes a same-window "message" event arriving, without needing
// a real EventTarget or a second browsing context.
class FakeWindow {
  location = { origin: "http://localhost" };
  opener: { postMessage: ReturnType<typeof vi.fn> } | null = null;
  open = vi.fn<() => { postMessage: ReturnType<typeof vi.fn> } | null>(() => null);
  private listeners: Array<(event: any) => void> = [];

  addEventListener(type: string, fn: (event: any) => void) {
    if (type === "message") this.listeners.push(fn);
  }
  removeEventListener(type: string, fn: (event: any) => void) {
    if (type === "message") this.listeners = this.listeners.filter((f) => f !== fn);
  }
  dispatch(event: { origin: string; source: unknown; data: unknown }) {
    for (const fn of [...this.listeners]) fn(event);
  }
}

let fakeWindow: FakeWindow;

beforeEach(() => {
  fakeWindow = new FakeWindow();
  vi.stubGlobal("window", fakeWindow);
  loginWithRefreshToken.mockClear();
  getRefreshToken.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("openHandoffWindow (opener side)", () => {
  it("does nothing if the popup was blocked", async () => {
    fakeWindow.open.mockReturnValue(null);
    getRefreshToken.mockReturnValue("refresh-token");
    const { openHandoffWindow } = await import("../windowHandoff");

    openHandoffWindow();

    fakeWindow.dispatch({ origin: "http://localhost", source: null, data: { type: "gramps-connect:handoff-ready" } });
    expect(loginWithRefreshToken).not.toHaveBeenCalled();
  });

  it("replies with the refresh token once the exact opened window asks, at the right origin", async () => {
    const child = { postMessage: vi.fn() };
    fakeWindow.open.mockReturnValue(child);
    getRefreshToken.mockReturnValue("refresh-token");
    const { openHandoffWindow } = await import("../windowHandoff");

    openHandoffWindow();
    fakeWindow.dispatch({ origin: "http://localhost", source: child, data: { type: "gramps-connect:handoff-ready" } });

    expect(child.postMessage).toHaveBeenCalledWith(
      { type: "gramps-connect:handoff-token", refreshToken: "refresh-token" },
      "http://localhost",
    );
  });

  it("ignores a ready message from the wrong window or wrong origin", async () => {
    const child = { postMessage: vi.fn() };
    const impostor = { postMessage: vi.fn() };
    fakeWindow.open.mockReturnValue(child);
    getRefreshToken.mockReturnValue("refresh-token");
    const { openHandoffWindow } = await import("../windowHandoff");

    openHandoffWindow();
    fakeWindow.dispatch({ origin: "http://localhost", source: impostor, data: { type: "gramps-connect:handoff-ready" } });
    fakeWindow.dispatch({ origin: "http://evil.example", source: child, data: { type: "gramps-connect:handoff-ready" } });

    expect(child.postMessage).not.toHaveBeenCalled();
  });
});

describe("tryHandoffLogin (receiving side)", () => {
  it("resolves immediately without an opener", async () => {
    fakeWindow.opener = null;
    const { tryHandoffLogin } = await import("../windowHandoff");

    await tryHandoffLogin();

    expect(loginWithRefreshToken).not.toHaveBeenCalled();
  });

  it("announces readiness and logs in once the opener replies with a token", async () => {
    fakeWindow.opener = { postMessage: vi.fn() };
    const { tryHandoffLogin } = await import("../windowHandoff");

    const pending = tryHandoffLogin();
    expect(fakeWindow.opener.postMessage).toHaveBeenCalledWith(
      { type: "gramps-connect:handoff-ready" },
      "http://localhost",
    );

    fakeWindow.dispatch({
      origin: "http://localhost",
      source: fakeWindow.opener,
      data: { type: "gramps-connect:handoff-token", refreshToken: "refresh-token" },
    });
    await pending;

    expect(loginWithRefreshToken).toHaveBeenCalledWith("refresh-token");
  });

  it("ignores a token reply from the wrong source or origin", async () => {
    fakeWindow.opener = { postMessage: vi.fn() };
    const impostor = { postMessage: vi.fn() };
    vi.useFakeTimers();
    const { tryHandoffLogin } = await import("../windowHandoff");

    const pending = tryHandoffLogin();
    fakeWindow.dispatch({
      origin: "http://localhost",
      source: impostor,
      data: { type: "gramps-connect:handoff-token", refreshToken: "stolen" },
    });
    fakeWindow.dispatch({
      origin: "http://evil.example",
      source: fakeWindow.opener,
      data: { type: "gramps-connect:handoff-token", refreshToken: "stolen" },
    });
    expect(loginWithRefreshToken).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10000);
    await pending;

    expect(loginWithRefreshToken).not.toHaveBeenCalled();
  });

  it("gives up after the timeout if the opener never replies", async () => {
    fakeWindow.opener = { postMessage: vi.fn() };
    vi.useFakeTimers();
    const { tryHandoffLogin } = await import("../windowHandoff");

    const pending = tryHandoffLogin();
    await vi.advanceTimersByTimeAsync(10000);
    await pending;

    expect(loginWithRefreshToken).not.toHaveBeenCalled();
  });
});
