import { describe, expect, it } from "vitest";
import { applyChanges, ChangeBuilder } from "../board/changes";
import { addEventRef, newEvent, newPerson, newPlace, setEventPlace } from "../board/links";
import { blank } from "../board/records";
import { boardSearchTerms } from "../board/searchTerms";

describe("boardSearchTerms", () => {
  it("reads names, years and place from the board's own (unsaved) records", () => {
    const b = new ChangeBuilder({});
    const anna = newPerson(b, { first: "Anna Maria", surname: "Miller", gender: "F" });
    const born = newEvent(b, "BIRTH", { date: blank("Date", { dateval: [3, 2, 1901, false] }) });
    const town = newPlace(b, "Springfield");
    setEventPlace(b, born, town);
    addEventRef(b, anna, born);
    const died = newEvent(b, "DEATH", { date: blank("Date", { dateval: [0, 0, 1970, false] }) });
    addEventRef(b, anna, died);
    const records = applyChanges({}, [b.change("x")]);

    expect(boardSearchTerms(anna, records)).toEqual({
      name_given: "Anna Maria",
      name_middle: "Maria",
      name_surname: "Miller",
      place_name: "Springfield",
      birth_year: "1901",
      death_year: "1970",
    });
  });
});
