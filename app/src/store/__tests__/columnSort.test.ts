import { describe, expect, it } from "vitest";
import { columnSort, headerSortColumn, locateSortKey, sortColumnFor } from "../columnSort";
import {
  CITATION_VIEW, EVENT_VIEW, NOTE_VIEW, PERSON_VIEW, PLACE_VIEW, TOPIC_MESSAGES_VIEW, VIEWS, defaultOrderBy,
  type ColumnConfig, type ViewConfig,
} from "../views";

// Shown columns that deliberately don't sort: a Gramps type (stored as a
// number whose order isn't its name's), and columns whose shown value is
// computed here or is one field of a stored JSON spec.
const UNSORTABLE = new Set([
  "event.event_type", "media.category", "topics.title", "story.title",
  // Each one field of a case file's stored JSON, like story.title.
  "casefile.name", "casefile.question", "casefile.cards", "casefile.started_by",
]);

const allViews: ViewConfig[] = [...VIEWS, TOPIC_MESSAGES_VIEW];
const shown = (view: ViewConfig) => view.columns.filter((c) => !c.hidden);
const column = (view: ViewConfig, key: string) => view.columns.find((c) => c.key === key) as ColumnConfig;

describe("column sorting, over every view", () => {
  it("sorts every shown column except the deliberate few", () => {
    for (const view of allViews) {
      for (const c of shown(view)) {
        const id = `${view.key}.${c.key}`;
        expect(columnSort(view, c) === null, id).toBe(UNSORTABLE.has(id));
      }
    }
  });

  it("caches every sort key, so the list can place a row", () => {
    for (const view of allViews) {
      const keys = [
        ...defaultOrderBy(view).map((o) => o.column),
        ...shown(view).flatMap((c) => columnSort(view, c)?.keys ?? []),
      ];
      for (const key of keys) expect(locateSortKey(view, key), `${view.key}: ${key}`).toBeDefined();
    }
  });

  it("only limits a column that reads inside each record beyond the default order", () => {
    for (const view of allViews) {
      for (const c of shown(view)) {
        const sort = columnSort(view, c);
        // A flat column was never limited, and isn't now.
        if (sort && typeof c.select === "string") expect(sort.limited, `${view.key}.${c.key}`).toBe(false);
      }
    }
    expect(columnSort(PERSON_VIEW, column(PERSON_VIEW, "primary_name"))?.limited).toBe(false);
    expect(columnSort(PLACE_VIEW, column(PLACE_VIEW, "title"))?.limited).toBe(false);
    expect(columnSort(PERSON_VIEW, column(PERSON_VIEW, "birth_date"))?.limited).toBe(true);
  });
});

describe("column sort keys", () => {
  it("breaks ties by thenBy, then the default order", () => {
    expect(columnSort(CITATION_VIEW, column(CITATION_VIEW, "source_title"))).toEqual({
      keys: ["source.title", "page", "gramps_id"], limited: true,
    });
    expect(columnSort(EVENT_VIEW, column(EVENT_VIEW, "date"))?.keys).toEqual(["date.sortval", "description", "gramps_id"]);
    expect(columnSort(PERSON_VIEW, column(PERSON_VIEW, "gramps_id"))?.keys).toEqual(["gramps_id", "surname", "given_name"]);
  });

  it("sorts an event's place as the Places list does", () => {
    expect(columnSort(EVENT_VIEW, column(EVENT_VIEW, "place_title"))?.keys).toEqual([
      "place.name.value", "place.title", "gramps_id",
    ]);
  });

  it("sorts note and message text by the text", () => {
    expect(headerSortColumn(NOTE_VIEW, column(NOTE_VIEW, "text"))).toBe("text.string");
    expect(headerSortColumn(TOPIC_MESSAGES_VIEW, column(TOPIC_MESSAGES_VIEW, "text"))).toBe("text.string");
  });

  it("finds the shown column before a hidden one with the same first key", () => {
    expect(sortColumnFor(PERSON_VIEW, "surname")?.key).toBe("primary_name");
    expect(sortColumnFor(PERSON_VIEW, "given_name")?.key).toBe("given_name");
  });
});
