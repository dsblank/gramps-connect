// Tree columns: a list's custom columns, shared with everyone on the tree.
// Each is an ordinary Media object tagged "List Column" holding the
// column's definition as JSON -- the same pattern as Custom Rules
// (customRuleMedia.ts): no gramps-web-api change, and editing or deleting
// one is a normal Media change, undoable from History.
//
// Which tree columns a list shows, and in what order, stays per browser
// (columnSettings.ts's ColumnLayout). This module only fetches and writes
// the definitions, and keeps columnSettings.ts's synchronous copy fresh.
import { getToken, getTreeId } from "../auth/auth";
import { API_BASE } from "../config";
import { fetchPage, parseErrorMessage } from "./api";
import { apiFetch } from "./apiFetch";
import { wasApplied, setTreeColumns, type TreeColumn } from "./columnSettings";
import { getOrCreateTagHandle, setMediaDesc, tagAndDescribeMedia, updateMediaFile, uploadMedia } from "./jobsApi";
import { allViewStores } from "./registry";
import { subscribeTreeChange } from "./treeChangeBus";
import { MEDIA_VIEW, VIEWS } from "./views";

export const TREE_COLUMN_TAG_NAME = "List Column";
const TREE_COLUMN_MIME = "application/json";

function isTreeColumn(value: unknown): value is TreeColumn {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    /^goql_[a-z0-9]+$/.test(c.id) &&
    typeof c.view === "string" &&
    typeof c.expr === "string" &&
    (c.title === undefined || typeof c.title === "string") &&
    (c.thenBy === undefined || typeof c.thenBy === "string")
  );
}

/** What the Media object's description says: the title, else the
 * expression, with the list it belongs to. */
function mediaDescription(column: TreeColumn): string {
  const list = VIEWS.find((v) => v.key === column.view)?.label ?? column.view;
  return `${column.title?.trim() || column.expr} (${list} column)`;
}

function manifest(column: TreeColumn): Blob {
  const { handle: _handle, ...rest } = column;
  return new Blob([JSON.stringify(rest, null, 2)], { type: TREE_COLUMN_MIME });
}

/** Every Media object tagged "List Column", parsed. One that isn't a valid
 * column is skipped, not thrown; two with the same id keep the first. */
export async function fetchTreeColumns(): Promise<TreeColumn[]> {
  const token = await getToken();
  const { page } = await fetchPage(
    MEDIA_VIEW,
    token,
    null,
    false,
    `any(t.name == ${JSON.stringify(TREE_COLUMN_TAG_NAME)} for t in tags)`,
    MEDIA_VIEW.orderBy,
    500,
  );
  const columns = await Promise.all(
    page.items.map(async (item): Promise<TreeColumn | null> => {
      try {
        const res = await apiFetch(`${API_BASE}/api/media/${encodeURIComponent(item.handle)}/file`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(await parseErrorMessage(res));
        const parsed: unknown = JSON.parse(await res.text());
        if (!isTreeColumn(parsed)) throw new Error("not a valid list column");
        return { ...parsed, handle: item.handle };
      } catch (err) {
        console.warn(`[treeColumns] skipping ${item.handle}:`, err);
        return null;
      }
    }),
  );
  const seen = new Set<string>();
  return columns.filter((c): c is TreeColumn => {
    if (!c || seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

/** Adds `column` to the tree as a new tagged Media object; its handle. */
export async function uploadTreeColumn(column: TreeColumn): Promise<string> {
  const token = await getToken();
  const handle = await uploadMedia(token, manifest(column), TREE_COLUMN_MIME);
  const tagHandle = await getOrCreateTagHandle(token, TREE_COLUMN_TAG_NAME);
  await tagAndDescribeMedia(token, handle, mediaDescription(column), tagHandle);
  return handle;
}

/** Replaces an existing tree column's definition in place (same handle). */
export async function saveTreeColumn(handle: string, column: TreeColumn): Promise<void> {
  const token = await getToken();
  await updateMediaFile(token, handle, manifest(column), TREE_COLUMN_MIME);
  await setMediaDesc(token, handle, mediaDescription(column));
}

/** Fetches the tree's columns into columnSettings.ts, then re-applies them
 * to every list that has already applied its columns, so one whose tree
 * column changed elsewhere refetches. Lists not loaded yet pick them up
 * when they load. */
export async function refreshTreeColumns(): Promise<TreeColumn[]> {
  const tree = getTreeId();
  const columns = await fetchTreeColumns();
  if (getTreeId() !== tree) return columns; // switched trees meanwhile
  if (setTreeColumns(columns)) {
    for (const store of allViewStores()) {
      if (!wasApplied(store.view)) continue;
      store.applyColumnChange().catch((err) => {
        console.error(`[${store.view.label}] applying tree columns failed`, err);
      });
    }
  }
  return columns;
}

const REFRESH_DELAY_MS = 3000;

/** Once per app: fetch the tree's columns now, and again shortly after any
 * Media change (someone else editing, adding or deleting a column; one
 * batch of changes refetches once). Returns a stop function. */
export function startTreeColumnsSync(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const refresh = () => {
    refreshTreeColumns().catch((err) => console.warn("[treeColumns] refresh failed", err));
  };
  refresh();
  const unsubscribe = subscribeTreeChange((n) => {
    if (n.table !== "media") return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      refresh();
    }, REFRESH_DELAY_MS);
  });
  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
  };
}
