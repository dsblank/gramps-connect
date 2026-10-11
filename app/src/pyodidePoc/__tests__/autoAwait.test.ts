import { describe, expect, it } from "vitest";
import { autoAwaitGrampletCode as autoAwait } from "../autoAwait";

describe("autoAwaitGrampletCode", () => {
  it("wraps a bare builtin call in parens with await", () => {
    expect(autoAwait("x = tags()")).toBe("x = (await tags())");
  });

  it("awaits the call, not a trailing subscript or attribute", () => {
    expect(autoAwait("x = tags()[0]")).toBe("x = (await tags())[0]");
    expect(autoAwait("n = get_home_person().gramps_id")).toBe("n = (await get_home_person()).gramps_id");
  });

  it("still works when the author already parenthesized the call", () => {
    expect(autoAwait("x = (tags())[0]")).toBe("x = ((await tags()))[0]");
  });

  it("wraps db.<method>() calls", () => {
    expect(autoAwait("g = db.get_person_from_handle(h).gramps_id")).toBe(
      "g = (await db.get_person_from_handle(h)).gramps_id"
    );
  });

  it("wraps nested call sites independently", () => {
    expect(autoAwait("p = people(get_object(h))[0]")).toBe("p = (await people((await get_object(h))))[0]");
  });

  it("finds the closing paren across nested brackets and lines", () => {
    expect(autoAwait("r = filter('Person', where={'a': [1, (2)]},\n    limit=3)[0]")).toBe(
      "r = (await filter('Person', where={'a': [1, (2)]},\n    limit=3))[0]"
    );
  });

  it("ignores parens inside string arguments and comments", () => {
    expect(autoAwait(`c = count("Person", where="a(")  # )`)).toBe(`c = (await count("Person", where="a("))  # )`);
    expect(autoAwait("c = count('x)', '''\n)''')[0]")).toBe("c = (await count('x)', '''\n)'''))[0]");
  });

  it("leaves call sites inside strings and comments alone", () => {
    const code = "s = 'tags()'  # tags()\nt = \"\"\"people()\"\"\"";
    expect(autoAwait(code)).toBe(code);
  });

  it("leaves explicitly awaited calls alone", () => {
    expect(autoAwait("y = await tags()")).toBe("y = await tags()");
    expect(autoAwait("y = await db.get_person_from_handle(h)")).toBe("y = await db.get_person_from_handle(h)");
  });

  it("leaves method calls and shadowing defs alone", () => {
    expect(autoAwait("x = obj.filter(1)")).toBe("x = obj.filter(1)");
    expect(autoAwait("x = mydb.get(1)")).toBe("x = mydb.get(1)");
    expect(autoAwait("def filter(x):\n    pass")).toBe("def filter(x):\n    pass");
  });

  it("falls back to a bare await prefix when the call is unbalanced", () => {
    expect(autoAwait("w = tags(")).toBe("w = await tags(");
  });
});
