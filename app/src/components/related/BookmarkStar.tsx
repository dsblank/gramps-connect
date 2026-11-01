import { useEffect, useState, useSyncExternalStore } from "react";
import { ActionIcon, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { getToken } from "../../auth/auth";
import {
  bookmarksLoaded, canEditBookmarks, getBookmarksVersion, isBookmarkable, isBookmarked, loadBookmarks,
  setBookmarked, subscribeBookmarks,
} from "../../store/bookmarks";
import { t } from "../../i18n/i18n";

function StarIcon({ filled, size = 18 }: { filled: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
      <polygon points="12 2.8 14.9 8.7 21.4 9.6 16.7 14.2 17.8 20.7 12 17.6 6.2 20.7 7.3 14.2 2.6 9.6 9.1 8.7" />
    </svg>
  );
}

/** The star beside a record's title in its detail pane: filled when the
 * record is one of the tree's bookmarks (store/bookmarks.ts). Clicking it
 * adds or removes the bookmark -- for everyone, since Gramps bookmarks are
 * shared -- which needs EditObject. Without it, the star only shows (filled,
 * not clickable) on a record that's bookmarked. Renders nothing for a type
 * Gramps has no bookmarks for (Tags, and the app's own pages). */
export function BookmarkStar({ type, handle }: { type: string; handle: string }) {
  useSyncExternalStore(subscribeBookmarks, getBookmarksVersion);
  const [busy, setBusy] = useState(false);
  const bookmarkable = isBookmarkable(type);

  useEffect(() => {
    if (!bookmarkable || bookmarksLoaded()) return;
    getToken()
      .then((token) => loadBookmarks(token))
      .catch((err) => console.warn("[bookmarks] load failed", err));
  }, [bookmarkable]);

  if (!bookmarkable || !bookmarksLoaded()) return null;
  const on = isBookmarked(type, handle);
  const editable = canEditBookmarks();
  if (!editable && !on) return null;

  if (!editable) {
    return (
      <Tooltip label={t("Bookmarked")} withArrow>
        <span style={{ display: "inline-flex", color: "var(--mantine-color-yellow-6)" }} aria-label={t("Bookmarked")}>
          <StarIcon filled />
        </span>
      </Tooltip>
    );
  }

  async function toggle() {
    setBusy(true);
    try {
      await setBookmarked(await getToken(), type, handle, !on);
    } catch (err: any) {
      notifications.show({
        color: "red",
        title: on ? t("Couldn't remove the bookmark") : t("Couldn't add the bookmark"),
        message: err?.message ?? String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  const label = on ? t("Remove bookmark") : t("Bookmark");
  return (
    <Tooltip label={label} withArrow>
      <ActionIcon
        variant="subtle"
        color={on ? "yellow" : "gray"}
        onClick={toggle}
        disabled={busy}
        aria-label={label}
        aria-pressed={on}
      >
        <StarIcon filled={on} />
      </ActionIcon>
    </Tooltip>
  );
}
