// One-off: flips `private` on every existing Gramps Connect message note
// (Note.type == "message", see ../src/store/notesApi.ts's MESSAGE_TYPE)
// that predates notesApi.ts's createMessage always sending private: true.
// Not run by any build/install step -- there's no server-side
// bulk-field-update endpoint (see notesApi.ts's toggleMessageDone for the
// same GET-then-PUT shape this loop uses per note, just looped over every
// match instead of one handle), so this is meant to be run by hand, once,
// against a given tree:
//
//   GRAMPS_USERNAME=... GRAMPS_PASSWORD=... node app/scripts/migrate-private-messages.mjs [API_BASE]
//
// API_BASE defaults to http://localhost:5555 (gramps-web-api's dev
// default); pass it as the one positional arg to target another server.
// Requires an account whose role can both query and PUT every message note
// (EditObject at least) -- an Owner/Admin login is the safe default.
import process from "node:process";

const API_BASE = process.argv[2] ?? "http://localhost:5555";
const USERNAME = process.env.GRAMPS_USERNAME;
const PASSWORD = process.env.GRAMPS_PASSWORD;
const PAGE_SIZE = 1000;

if (!USERNAME || !PASSWORD) {
  console.error("Set GRAMPS_USERNAME and GRAMPS_PASSWORD in the environment before running this script.");
  process.exit(1);
}

async function parseErrorMessage(res) {
  const body = await res.text();
  try {
    return JSON.parse(body)?.error?.message ?? body;
  } catch {
    return body;
  }
}

async function login() {
  const res = await fetch(`${API_BASE}/api/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const { access_token } = await res.json();
  return access_token;
}

/** Every message note's handle, paginated the same keyset way fetchPage()
 * (../src/store/api.ts) does -- `select` only asks for `handle` since this
 * is just gathering the worklist, not anything toggleMessageDone-style
 * would need to display. */
async function fetchMessageHandles(token) {
  const handles = [];
  let after;
  for (;;) {
    const res = await fetch(`${API_BASE}/api/notes/query/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        select: ["handle"],
        order_by: [{ column: "handle", direction: "asc" }],
        limit: PAGE_SIZE,
        after,
        where_expr: "type.string == 'message'",
      }),
    });
    if (!res.ok) throw new Error(await parseErrorMessage(res));
    const page = await res.json();
    for (const item of page.items) handles.push(item.handle);
    if (!page.next_after) break;
    after = page.next_after;
  }
  return handles;
}

/** GET-then-PUT a single note with private forced true -- a full replace
 * (same reasoning as notesApi.ts's toggleMessageDone), skipped entirely
 * when the note is already private so a re-run of this script is a no-op
 * over already-migrated notes. */
async function makePrivate(token, handle) {
  const getRes = await fetch(`${API_BASE}/api/notes/${encodeURIComponent(handle)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!getRes.ok) throw new Error(await parseErrorMessage(getRes));
  const obj = await getRes.json();
  if (obj.private) return false;

  obj.private = true;
  const putRes = await fetch(`${API_BASE}/api/notes/${encodeURIComponent(handle)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(obj),
  });
  if (!putRes.ok) throw new Error(await parseErrorMessage(putRes));
  return true;
}

const token = await login();
const handles = await fetchMessageHandles(token);
console.log(`Found ${handles.length} message note(s).`);

let updated = 0;
for (const handle of handles) {
  try {
    if (await makePrivate(token, handle)) {
      updated++;
      console.log(`  ${handle}: marked private`);
    }
  } catch (err) {
    console.error(`  ${handle}: FAILED -- ${err.message ?? err}`);
  }
}
console.log(`Done. ${updated} note(s) newly marked private (${handles.length - updated} already were).`);
