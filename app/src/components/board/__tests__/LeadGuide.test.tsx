// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, renderWithProviders, screen } from "../../../testUtils/renderWithProviders";
import { blank, GENDER, type GrampsRecord, type Records } from "../../../store/board/records";

// No network: searches and record loads come back empty.
vi.mock("../../../store/searchApi", () => ({ fetchSearch: vi.fn(async () => ({ hits: [] })) }));
vi.mock("../../../store/board/records", async (orig) => ({ ...(await orig<object>()), loadRecords: vi.fn(async () => ({})) }));
vi.mock("../../../auth/auth", async (orig) => ({ ...(await orig<object>()), getToken: vi.fn(async () => "tok") }));

import { LeadGuide, NEW_LEAD, type LeadActions, type LeadState } from "../LeadGuide";

const person = (handle: string, first: string, extra: Record<string, unknown> = {}) =>
  blank<GrampsRecord>("Person", {
    handle, gramps_id: handle, gender: GENDER.FEMALE,
    primary_name: blank("Name", { first_name: first, surname_list: [blank("Surname", { surname: "Miller" })] }),
    ...extra,
  });
const records: Records = { anna: person("anna", "Anna"), ruth: person("ruth", "Ruth") };

function actions(): LeadActions {
  return {
    onFile: vi.fn(async () => {}), onMedia: vi.fn(async () => {}), onWhat: vi.fn(), onWhere: vi.fn(), onPerson: vi.fn(), onRelate: vi.fn(), onEvent: vi.fn(),
    onRole: vi.fn(), onHome: vi.fn(), onSave: vi.fn(), onStep: vi.fn(), onAnother: vi.fn(), onClose: vi.fn(),
  };
}
const at = (step: LeadState["step"], extra: Partial<LeadState> = {}): LeadState => ({ ...NEW_LEAD, step, ...extra });

describe("LeadGuide", () => {
  it("starts with the file, and can go on without one", () => {
    const a = actions();
    renderWithProviders(<LeadGuide lead={at("file")} records={records} home={null} actions={a} />);
    expect(screen.getByText("Start with the evidence itself.")).toBeTruthy();
    fireEvent.click(screen.getByText("I don't have a copy"));
    expect(a.onStep).toHaveBeenCalledWith("what");
  });

  it("prefills the title from the kind and passes it on", () => {
    const a = actions();
    renderWithProviders(<LeadGuide lead={at("what")} records={records} home={null} actions={a} />);
    fireEvent.click(screen.getByText("Marriage certificate"));
    fireEvent.click(screen.getByText("Next"));
    expect(a.onWhat).toHaveBeenCalledWith("Marriage certificate");
  });

  it("asks who you are without a Home person, and lists the people in the document", () => {
    renderWithProviders(<LeadGuide lead={at("who", { people: ["anna", "ruth"], newPeople: ["ruth"] })} records={records} home={null} actions={actions()} />);
    expect(screen.getByText("Who are you? Your family is suggested from there.")).toBeTruthy();
    expect(screen.getByText("In this document")).toBeTruthy();
    expect(screen.getAllByText("Anna Miller").length).toBeGreaterThan(0);
  });

  it("offers the occasions and adds one", () => {
    const a = actions();
    renderWithProviders(<LeadGuide lead={at("occasion", { people: ["anna"] })} records={records} home="anna" actions={a} />);
    fireEvent.click(screen.getByText("Birth"));
    fireEvent.change(screen.getByLabelText("When? (a year is fine)"), { target: { value: "1935" } });
    fireEvent.click(screen.getByText("Add the birth"));
    expect(a.onEvent).toHaveBeenCalledWith(expect.objectContaining({ who1: "anna", existing: null, place: null }));
  });

  it("asks the others' parts, then finishes", () => {
    const a = actions();
    const { unmount } = renderWithProviders(<LeadGuide lead={at("roles", { people: ["anna", "ruth"], eventPeople: ["anna"], event: null })} records={records} home="anna" actions={a} />);
    fireEvent.click(screen.getByText("Witness"));
    expect(a.onRole).toHaveBeenCalledWith("ruth", expect.objectContaining({ role: "WITNESS" }));
    unmount();
    renderWithProviders(<LeadGuide lead={at("done", { title: "Wedding photo" })} records={records} home="anna" actions={a} />);
    fireEvent.click(screen.getByText("Another document"));
    expect(a.onAnother).toHaveBeenCalled();
  });
});
