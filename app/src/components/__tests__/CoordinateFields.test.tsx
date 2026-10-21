// @vitest-environment jsdom
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "../../testUtils/renderWithProviders";

const i18n = vi.hoisted(() => ({ snapshot: { lang: "en", strings: {} } }));
vi.mock("../../i18n/i18n", () => ({
  getI18nSnapshot: () => i18n.snapshot,
  subscribe: () => () => {},
  t: (s: string) => s,
}));

import { CoordinateFields } from "../CoordinateFields";

const changes: { lat?: string; long?: string }[] = [];

function Harness({ lat = "", long = "" }: { lat?: string; long?: string }) {
  const [value, setValue] = useState({ lat, long });
  return (
    <CoordinateFields
      lat={value.lat}
      long={value.long}
      onChange={(patch) => {
        changes.push(patch);
        setValue((v) => ({ ...v, ...patch }));
      }}
    />
  );
}

const latInput = () => screen.getByLabelText("Latitude") as HTMLInputElement;
const longInput = () => screen.getByLabelText("Longitude") as HTMLInputElement;

describe("CoordinateFields", () => {
  beforeEach(() => {
    i18n.snapshot = { lang: "en", strings: {} };
    changes.length = 0;
  });

  it("previews DMS as the decimal the map will use", () => {
    renderWithProviders(<Harness lat="42° 41′ 55″ N" long="2° 53′ 44″ W" />);
    expect(screen.getByText("= 42.698611° N")).toBeTruthy();
    expect(screen.getByText("= 2.895556° W")).toBeTruthy();
  });

  it("previews as you type", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness long="2.8956" />);
    await user.type(latInput(), "-33:52:7.68");
    expect(screen.getByText("= 33.868800° S")).toBeTruthy();
  });

  it("shows nothing for an empty pair", () => {
    renderWithProviders(<Harness />);
    expect(screen.queryByText(/^= /)).toBeNull();
    expect(screen.queryByText(/Gramps can read/)).toBeNull();
    expect(screen.queryByText(/Needed too/)).toBeNull();
  });

  it("flags a value the map can't read", () => {
    renderWithProviders(<Harness lat="42° 61′ N" long="east-ish" />);
    expect(screen.getByText(/Not a latitude Gramps can read/)).toBeTruthy();
    expect(screen.getByText(/Not a longitude Gramps can read/)).toBeTruthy();
    expect(latInput().getAttribute("aria-invalid")).toBe("true");
  });

  it("flags a direction letter on the wrong axis", () => {
    renderWithProviders(<Harness lat="42.6986 E" long="2.8956 N" />);
    expect(screen.getByText(/Not a latitude/)).toBeTruthy();
    expect(screen.getByText(/Not a longitude/)).toBeTruthy();
  });

  it("says the other half is needed too", () => {
    renderWithProviders(<Harness lat="42.6986" />);
    expect(screen.getByText("Needed too for this place to appear on the map")).toBeTruthy();
  });

  it("reads O as west in French and east in German", () => {
    i18n.snapshot = { lang: "fr", strings: {} };
    const { unmount } = renderWithProviders(<Harness lat="42N" long={"2°53'44\"O"} />);
    expect(screen.getByText("= 2.895556° W")).toBeTruthy();
    unmount();
    i18n.snapshot = { lang: "de", strings: {} };
    renderWithProviders(<Harness lat="42N" long={"2°53'44\"O"} />);
    expect(screen.getByText("= 2.895556° E")).toBeTruthy();
  });

  it("doesn't take another language's letter", () => {
    renderWithProviders(<Harness lat="42N" long={"2°53'44\"O"} />);
    expect(screen.getByText(/Not a longitude/)).toBeTruthy();
  });

  it("splits a pasted lat, long pair into both fields", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.click(longInput());
    await user.paste("42.69861, 2.89556");
    expect(changes).toEqual([{ lat: "42.69861", long: "2.89556" }]);
    expect(latInput().value).toBe("42.69861");
    expect(longInput().value).toBe("2.89556");
  });

  it("pastes a single value normally", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.click(latInput());
    await user.paste("42,6986");
    expect(latInput().value).toBe("42,6986");
    expect(longInput().value).toBe("");
  });
});
