import { describe, expect, it } from "vitest";
import { applyChanges, ChangeBuilder } from "../board/changes";
import { photosOf, subjectsFromBacklinks, subjectsOnBoard, type PhotoSubject } from "../board/faces";
import { makeMainPhoto, removeMediaRef, setMediaRegion } from "../board/links";
import { blank, type GrampsRecord, type Records } from "../board/records";

const person = (handle: string, first: string, media_list: unknown[] = []) =>
  blank<GrampsRecord>("Person", {
    handle, gramps_id: handle, media_list,
    primary_name: blank("Name", { first_name: first, surname_list: [blank("Surname", { surname: "Miller" })] }),
  });
const media = (handle: string, mime = "image/jpeg") => blank<GrampsRecord>("Media", { handle, gramps_id: handle, mime });
const ref = (m: string, rect: number[] | null = null) => blank("MediaRef", { ref: m, rect });

function act(records: Records, action: (b: ChangeBuilder) => void): Records {
  const b = new ChangeBuilder(records);
  action(b);
  return applyChanges(records, [b.change("x")]);
}

describe("subjectsFromBacklinks", () => {
  it("lists people with or without a face, and other records only with a region", () => {
    const detail = {
      extended: {
        backlinks: {
          person: [
            { handle: "anna", primary_name: { first_name: "Anna", surname_list: [{ surname: "Miller" }] }, media_list: [{ ref: "M1", rect: [10, 10, 30, 40] }] },
            { handle: "john", primary_name: { first_name: "John" }, media_list: [{ ref: "M1", rect: [0, 0, 0, 0] }] },
          ],
          event: [
            { handle: "e1", gramps_id: "E1", media_list: [{ ref: "M1" }] },
            { handle: "e2", gramps_id: "E2", media_list: [{ ref: "M1", rect: [1, 1, 50, 50] }] },
          ],
        },
      },
    };
    expect(subjectsFromBacklinks(detail, "M1")).toEqual([
      { cls: "Person", handle: "anna", label: "Anna Miller", rect: [10, 10, 30, 40] },
      { cls: "Person", handle: "john", label: "John", rect: null },
      { cls: "Event", handle: "e2", label: "E2", rect: [1, 1, 50, 50] },
    ]);
  });
});

describe("subjectsOnBoard", () => {
  const fromTree: PhotoSubject[] = [
    { cls: "Person", handle: "anna", label: "Anna Miller", rect: [10, 10, 30, 40] },
    { cls: "Person", handle: "walter", label: "Walter Miller", rect: null },
  ];

  it("keeps the tree's list for records the board hasn't loaded", () => {
    expect(subjectsOnBoard(fromTree, {}, "M1").map((s) => s.handle)).toEqual(["anna", "walter"]);
  });

  it("shows a face marked on the board, someone added, and someone taken out", () => {
    let working: Records = { anna: person("anna", "Anna", [ref("M1", [10, 10, 30, 40])]), ruth: person("ruth", "Ruth"), walter: person("walter", "Walter", [ref("M1")]) };
    working = act(working, (b) => {
      setMediaRegion(b, "anna", "M1", [50, 5, 70, 30]);
      setMediaRegion(b, "ruth", "M1", [1, 2, 20, 25]);
      removeMediaRef(b, "walter", "M1");
    });
    expect(subjectsOnBoard(fromTree, working, "M1")).toEqual([
      { cls: "Person", handle: "anna", label: "Anna Miller", rect: [50, 5, 70, 30] },
      { cls: "Person", handle: "ruth", label: "Ruth Miller", rect: [1, 2, 20, 25] },
    ]);
  });
});

describe("photosOf and makeMainPhoto", () => {
  it("lists only image references, and moving one first makes it the card's photo", () => {
    let records: Records = {
      anna: person("anna", "Anna", [ref("DOC"), ref("M1", [1, 1, 9, 9]), ref("M2")]),
      DOC: media("DOC", "application/pdf"),
      M1: media("M1"),
      M2: media("M2"),
    };
    expect(photosOf("anna", records)).toEqual([{ media: "M1", rect: [1, 1, 9, 9] }, { media: "M2", rect: null }]);
    records = act(records, (b) => makeMainPhoto(b, "anna", "M2"));
    expect((records.anna.media_list as { ref: string }[]).map((m) => m.ref)).toEqual(["M2", "DOC", "M1"]);
    expect(photosOf("anna", records)[0].media).toBe("M2");
  });
});
