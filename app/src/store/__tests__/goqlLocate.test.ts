import { describe, expect, it } from "vitest";
import { goqlStringInPython, maskTemplateFields } from "../goqlLocate";

/** Cursor at the `|` in `marked`. */
function at(marked: string): [string, number] {
  const cursor = marked.indexOf("|");
  return [marked.slice(0, cursor) + marked.slice(cursor + 1), cursor];
}

function locate(marked: string) {
  const [code, cursor] = at(marked);
  const found = goqlStringInPython(code, cursor);
  return found && { namespace: found.namespace, text: code.slice(found.start, found.end), quote: found.quote };
}

describe("maskTemplateFields", () => {
  it("masks {param} and f-string fields to equal-length zeros", () => {
    expect(maskTemplateFields("birth.date.sortval < {minAge} and x")).toBe("birth.date.sortval < 00000000 and x");
    expect(maskTemplateFields("surname == '{name.upper()}'")).toBe("surname == '00000000000000'");
    expect(maskTemplateFields("gender == {unfinished")).toBe("gender == {unfinished");
  });
});

describe("goqlStringInPython", () => {
  it("finds the where string of the plural functions", () => {
    expect(locate('for p in people("gender == |1"):')).toEqual({ namespace: "Person", text: "gender == 1", quote: '"' });
    expect(locate("families(where='fa|')")).toEqual({ namespace: "Family", text: "fa", quote: "'" });
    expect(locate('events(limit=10, where="ty|pe")')?.namespace).toBe("Event");
    expect(locate('x = await places(f"title == \'{name}|\'")')?.namespace).toBe("Place");
  });

  it("finds the where string of filter/count/get_number_of", () => {
    expect(locate('filter("Person", "bi|")')?.namespace).toBe("Person");
    expect(locate("count('family', where='|')")?.namespace).toBe("Family");
    expect(locate('db.get_number_of("Event", "|")')?.namespace).toBe("Event");
  });

  it("is null outside a GOQL string", () => {
    expect(locate('people("gender == 1")|')).toBeNull();
    expect(locate('print("hello |")')).toBeNull();
    expect(locate('filter("Per|son", "x")')).toBeNull();
    expect(locate('# people("gen|der")')).toBeNull();
    expect(locate('people("a") + 1|')).toBeNull();
    expect(locate('filter("Nosuch", "|")')).toBeNull();
  });

  it("handles escapes, triple quotes and earlier strings", () => {
    expect(locate('s = "a\\"b"\nnotes("|")')?.namespace).toBe("Note");
    expect(locate('people("""gender\n== |1""")')?.text).toBe("gender\n== 1");
    expect(locate('x = "people(" ; tags("na|")')?.namespace).toBe("Tag");
  });

  it("an unterminated string runs to the end of its line", () => {
    expect(locate('people("gender == |\nprint(1)')?.text).toBe("gender == ");
  });
});
