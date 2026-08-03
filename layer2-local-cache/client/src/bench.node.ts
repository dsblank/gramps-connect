// Node-runnable benchmark: loads the fixture dataset fetched from a
// real gramps-web-api /api/people/ instance, builds the local SQLite
// mirror, and times filter/sort queries against it. This is the
// client-side analog of the discourse thread's benchmark (PLAN.md
// Layer 2 success criteria: sub-50ms local queries against a few
// thousand cached records).
import * as fs from "fs";
import * as path from "path";
import initSqlJs from "sql.js";
import { CREATE_TABLE_SQL, personToRow } from "./schema";

async function main() {
  const peoplePath = process.argv[2];
  if (!peoplePath) {
    console.error("usage: bench.node.js <people.json>");
    process.exit(1);
  }

  const people = JSON.parse(fs.readFileSync(peoplePath, "utf-8"));
  console.log(`loaded ${people.length} people from ${peoplePath}`);

  const SQL = await initSqlJs({
    locateFile: (file) =>
      path.join(require.resolve("sql.js"), "..", file),
  });
  const db = new SQL.Database();
  db.run(CREATE_TABLE_SQL);

  const insertStart = performance.now();
  db.run("BEGIN TRANSACTION;");
  const stmt = db.prepare(
    `INSERT INTO person
     (handle, gramps_id, surname, given_name, birth_date, death_date, change)
     VALUES (?, ?, ?, ?, ?, ?, ?);`
  );
  for (const person of people) {
    const row = personToRow(person);
    stmt.run([
      row.handle,
      row.gramps_id,
      row.surname,
      row.given_name,
      row.birth_date,
      row.death_date,
      row.change,
    ]);
  }
  stmt.free();
  db.run("COMMIT;");
  const insertMs = performance.now() - insertStart;
  console.log(`mapped + inserted ${people.length} rows in ${insertMs.toFixed(1)}ms`);

  function timeQuery(label: string, sql: string, params: any[] = []) {
    const t0 = performance.now();
    const result = db.exec(sql, params);
    const ms = performance.now() - t0;
    const rowCount = result[0]?.values.length ?? 0;
    console.log(`${label}: ${ms.toFixed(2)}ms, ${rowCount} rows`);
    return ms;
  }

  console.log("\n--- queries (client-side, local SQLite) ---");
  // personToRow leaves birth_date/death_date null (see its own docstring
  // -- this fixture has no event table to resolve against), so this is a
  // NULL-filter timing check, not a meaningful death-date-narrowed one;
  // still exercises the same "filtered, sorted page" shape as the real
  // browser.ts diagnostic.
  timeQuery(
    "filter has death_date, sorted by surname",
    "SELECT handle, given_name, surname FROM person WHERE death_date IS NOT NULL ORDER BY surname LIMIT 50;"
  );
  // Plain browse-list page load.
  timeQuery(
    "sort by surname, page 1",
    "SELECT handle, given_name, surname FROM person ORDER BY surname LIMIT 50;"
  );
  // Prefix search, the kind of thing the discourse thread's 104s
  // baseline was measuring server-side.
  timeQuery(
    "surname prefix search",
    "SELECT handle, given_name, surname FROM person WHERE surname LIKE 'A%' ORDER BY surname;"
  );
  // Full-table scan sanity check.
  timeQuery("count all", "SELECT COUNT(*) FROM person;");

  db.close();
}

main();
