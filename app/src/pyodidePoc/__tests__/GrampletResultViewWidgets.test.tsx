// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, renderWithProviders, screen } from "../../testUtils/renderWithProviders";
import { GrampletResultView } from "../GrampletResultView";

// The markup stBootstrap.ts's st.radio()/st.number_input() emit -- the
// page side only sees their data-gramplet-* attributes, the same contract
// every other st.* widget uses.
const RADIO =
  '<div class="st-radio" role="radiogroup"><div class="st-radio-label">Colour</div>' +
  '<label class="st-radio-option"><input type="radio" name="st-radio-x" value="Red" data-gramplet-key="Colour" data-gramplet-event="change">Red</label>' +
  '<label class="st-radio-option"><input type="radio" name="st-radio-x" value="Green" data-gramplet-key="Colour" data-gramplet-event="change" checked>Green</label></div>';
const NUMBER =
  '<label class="st-number-input">Count<input type="number" data-gramplet-key="Count" data-gramplet-event="change" value="3" step="1" min="1"></label>';

function renderBlocks(markup: string, onWidgetEvent: (key: string, value: unknown) => void) {
  return renderWithProviders(
    <GrampletResultView
      status="done"
      response={{ type: "blocks", runId: "r", blocks: [{ type: "html", markup }] }}
      onWidgetEvent={onWidgetEvent}
    />
  );
}

describe("st.radio / st.number_input on the page", () => {
  it("a radio choice reports its key and the chosen option's value", async () => {
    const onWidgetEvent = vi.fn();
    renderBlocks(RADIO, onWidgetEvent);
    await userEvent.setup().click(screen.getByLabelText("Red"));
    expect(onWidgetEvent).toHaveBeenCalledWith("Colour", "Red");
  });

  it("a number input reports its key and the typed value", () => {
    const onWidgetEvent = vi.fn();
    renderBlocks(NUMBER, onWidgetEvent);
    const input = screen.getByLabelText("Count");
    fireEvent.change(input, { target: { value: "7" } });
    expect(onWidgetEvent).toHaveBeenCalledWith("Count", "7");
  });
});
