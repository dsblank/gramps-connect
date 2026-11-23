import { fetchPage } from "./api";
import { TAG_VIEW } from "./views";
import { toTagInfo, type TagInfo } from "../charts/personColors";

/** Every tag in the tree, by handle, with its color made CSS-ready -- for
 * "Color by tag" in the charts. Pages through TAG_VIEW's own query, so it
 * costs one request for any tree with up to 1000 tags. */
export async function fetchAllTags(token: string): Promise<Map<string, TagInfo>> {
  const tags = new Map<string, TagInfo>();
  let after: string | null = null;
  do {
    const { page } = await fetchPage(TAG_VIEW, token, after, false, null);
    for (const item of page.items) tags.set(item.handle, toTagInfo(item));
    after = page.next_after;
  } while (after);
  return tags;
}
