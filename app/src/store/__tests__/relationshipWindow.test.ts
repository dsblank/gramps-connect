import { afterEach, describe, expect, it } from "vitest";
import { getDock } from "../bottomDock";
import {
  closeRelationshipWindow,
  getRelationshipWindow,
  openRelationshipWindow,
  RELATIONSHIP_WINDOW_ID,
  setRelationshipWindowMinimized,
  subscribeRelationshipWindow,
} from "../relationshipWindow";
import { getWindowStack } from "../windowStack";

afterEach(() => closeRelationshipWindow());

describe("relationshipWindow", () => {
  it("is one window, on the pair it was last opened for", () => {
    let notified = 0;
    const unsubscribe = subscribeRelationshipWindow(() => notified++);
    openRelationshipWindow("H", "X");
    openRelationshipWindow("H", "Y");
    expect(getRelationshipWindow()).toEqual({ from: "H", to: "Y", minimized: false });
    expect(getWindowStack().filter((id) => id === RELATIONSHIP_WINDOW_ID)).toHaveLength(1);
    expect(notified).toBe(2);
    unsubscribe();
  });

  it("minimizes to the dock, and opening again restores it", () => {
    openRelationshipWindow("H", "X");
    setRelationshipWindowMinimized(true);
    expect(getRelationshipWindow()?.minimized).toBe(true);
    expect(JSON.stringify(getDock())).toContain(RELATIONSHIP_WINDOW_ID);
    openRelationshipWindow("A", "B");
    expect(getRelationshipWindow()).toEqual({ from: "A", to: "B", minimized: false });
    expect(JSON.stringify(getDock())).not.toContain(RELATIONSHIP_WINDOW_ID);
  });

  it("closes", () => {
    openRelationshipWindow("H", "X");
    closeRelationshipWindow();
    expect(getRelationshipWindow()).toBeNull();
    expect(getWindowStack()).not.toContain(RELATIONSHIP_WINDOW_ID);
  });
});
