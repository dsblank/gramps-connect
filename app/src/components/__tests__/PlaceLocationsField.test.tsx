// @vitest-environment jsdom
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "../../testUtils/renderWithProviders";

vi.mock("../../i18n/i18n", () => ({
  getI18nSnapshot: () => ({ lang: "en", strings: {} }),
  subscribe: () => () => {},
  t: (s: string) => s,
}));

import { PlaceLocationsField, type PlaceLocation } from "../PlaceLocationsField";

let latest: PlaceLocation[] = [];

function Harness({ initial }: { initial: PlaceLocation[] }) {
  const [items, setItems] = useState(initial);
  return (
    <PlaceLocationsField
      items={items}
      onChange={(next) => {
        latest = next;
        setItems(next);
      }}
    />
  );
}

describe("PlaceLocationsField", () => {
  beforeEach(() => {
    latest = [];
  });

  it("shows an existing location's fields, parish included", () => {
    renderWithProviders(<Harness initial={[{ _class: "Location", city: "Ripon", parish: "St Wilfrid", country: "England" }]} />);
    expect((screen.getByLabelText("City") as HTMLInputElement).value).toBe("Ripon");
    expect((screen.getByLabelText("Parish") as HTMLInputElement).value).toBe("St Wilfrid");
    expect((screen.getByLabelText("Country") as HTMLInputElement).value).toBe("England");
  });

  it("adds a Location and edits it, keeping the other fields", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={[]} />);
    await user.click(screen.getByRole("button", { name: "Add alternate location" }));
    await user.type(screen.getByLabelText("County"), "Yorkshire");
    await user.type(screen.getByLabelText("Parish"), "Ripon");
    expect(latest).toEqual([{ _class: "Location", county: "Yorkshire", parish: "Ripon" }]);
  });

  it("removes a location", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={[{ _class: "Location", city: "A" }, { _class: "Location", city: "B" }]} />);
    await user.click(screen.getAllByRole("button", { name: "Remove alternate locations row" })[0]);
    expect(latest).toEqual([{ _class: "Location", city: "B" }]);
  });
});
