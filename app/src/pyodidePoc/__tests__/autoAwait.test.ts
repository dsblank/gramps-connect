import { createRequire } from "node:module";
import { dirname } from "node:path";
import { loadPyodide, type PyodideInterface } from "pyodide";
import { beforeAll, describe, expect, it } from "vitest";
import { AUTO_AWAIT_PY } from "../autoAwait";

// Real Pyodide (node_modules/pyodide, under Node) -- the transform is
// Python's own ast module, so there's nothing meaningful to stub. indexURL
// is explicit because Pyodide can't find its own files from inside vitest.
let pyodide: PyodideInterface;

beforeAll(async () => {
  pyodide = await loadPyodide({
    indexURL: dirname(createRequire(import.meta.url).resolve("pyodide/package.json")) + "/",
  });
  await pyodide.runPythonAsync(AUTO_AWAIT_PY);
}, 60_000);

function rewrite(source: string): string {
  return pyodide.runPython(`_auto_await_source(${JSON.stringify(source)})`) as string;
}

describe("auto-await AST transform", () => {
  it("awaits a bare builtin call", () => {
    expect(rewrite("x = tags()")).toBe("x = await tags()");
  });

  it("awaits the call, not a trailing subscript or attribute", () => {
    expect(rewrite("x = tags()[0]")).toBe("x = (await tags())[0]");
    expect(rewrite("n = get_home_person().gramps_id")).toBe("n = (await get_home_person()).gramps_id");
  });

  it("awaits db.<method>() calls", () => {
    expect(rewrite("g = db.get_person_from_handle(h).gramps_id")).toBe(
      "g = (await db.get_person_from_handle(h)).gramps_id"
    );
  });

  it("awaits nested and multi-line calls", () => {
    expect(rewrite("p = people(get_object(h))[0]")).toBe("p = (await people(await get_object(h)))[0]");
    expect(rewrite("r = filter('Person',\n    where={'a': [1, (2)]})[0]")).toBe(
      "r = (await filter('Person', where={'a': [1, 2]}))[0]"
    );
  });

  it("leaves call sites inside strings and comments alone", () => {
    expect(rewrite("s = 'tags()'  # tags()")).toBe("s = 'tags()'");
  });

  it("leaves explicit awaits alone but still visits their arguments", () => {
    expect(rewrite("y = await tags()")).toBe("y = await tags()");
    expect(rewrite("y = await people(get_object(h))")).toBe("y = await people(await get_object(h))");
  });

  it("leaves method calls on other objects alone", () => {
    expect(rewrite("x = obj.filter(1)")).toBe("x = obj.filter(1)");
    expect(rewrite("x = mydb.get(1)")).toBe("x = mydb.get(1)");
  });

  it("leaves names the Gramplet defines or imports itself alone", () => {
    expect(rewrite("def tags():\n    return 1\nx = tags()")).toBe("def tags():\n    return 1\nx = tags()");
    expect(rewrite("from mylib import count\nn = count()")).toBe("from mylib import count\nn = count()");
  });

  it("leaves a parameter shadowing a builtin alone, only inside that function", () => {
    expect(rewrite("f = lambda media: media()\nm = media()")).toBe("f = lambda media: media()\nm = await media()");
  });

  it("treats a plain assignment as using the builtin", () => {
    expect(rewrite("media = media()")).toBe("media = await media()");
  });

  it("leaves Python's own filter(function, iterable) alone", () => {
    expect(rewrite("z = list(filter(lambda q: q, values))")).toBe("z = list(filter(lambda q: q, values))");
    expect(rewrite("z = list(filter(None, values))")).toBe("z = list(filter(None, values))");
  });
});

describe("_run_gramplet", () => {
  beforeAll(async () => {
    await pyodide.runPythonAsync(`
async def tags():
    return ["a", "b"]

class _FakeDb:
    async def get_person_from_handle(self, handle):
        return {"handle": handle}

db = _FakeDb()
`);
  });

  async function run(source: string): Promise<unknown> {
    const result = await pyodide.runPythonAsync(`await _run_gramplet(${JSON.stringify(source)})`);
    return result && typeof result === "object" && "toJs" in result
      ? (result as { toJs: (o: object) => unknown }).toJs({ dict_converter: Object.fromEntries })
      : result;
  }

  it("returns the last expression's value, with calls awaited", async () => {
    expect(await run("x = tags()[1]\nx")).toBe("b");
    expect(await run("db.get_person_from_handle('h1')['handle']")).toBe("h1");
  });

  it("runs in the shared globals, like runPythonAsync", async () => {
    await run("kept = len(tags())");
    expect(await run("kept")).toBe(2);
  });

  it("reports a Gramplet's errors at its own line numbers", async () => {
    await expect(run("x = 1\ny = tags()[5]")).rejects.toThrow(/File "<gramplet>", line 2, in <module>\nIndexError/);
  });
});
