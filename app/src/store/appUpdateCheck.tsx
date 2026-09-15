// Detects a new deploy landing under this tab's feet and offers a reload,
// rather than leaving a stale bundle running silently (see the "click here
// to refresh" ask this was built for). Compares the content-hashed JS
// bundle filename Vite emits (index-<hash>.js, see index.html) against
// what the server's index.html currently references -- any rebuild changes
// that hash, whether or not package.json's version was bumped, so this
// catches every deploy, not just ones that remembered to bump __APP_VERSION__.
import { Button, Group, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { t } from "../i18n/i18n";

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const NOTIFICATION_ID = "app-update-available";

function getCurrentBundleSrc(): string | null {
  return document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src ?? null;
}

async function getServerBundleSrc(): Promise<string | null> {
  const res = await fetch("/", { cache: "no-store" });
  if (!res.ok) return null;
  const html = await res.text();
  const match = html.match(/<script[^>]*type="module"[^>]*\ssrc="([^"]+)"/);
  return match ? new URL(match[1], location.href).href : null;
}

function showUpdateNotification() {
  notifications.show({
    id: NOTIFICATION_ID,
    color: "blue",
    title: t("Update available"),
    autoClose: false,
    withCloseButton: true,
    message: (
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Text size="sm">{t("A new version of Gramps Connect is ready.")}</Text>
        <Button size="xs" onClick={() => window.location.reload()}>
          {t("Reload")}
        </Button>
      </Group>
    ),
  });
}

/** Mounted once for the whole app's lifetime (logged in or not -- a login
 * screen left open overnight is exactly the stale-tab case this targets).
 * Skipped in dev: Vite's dev server serves an unhashed module entry
 * (/src/main.tsx), so there's no bundle-filename change to detect, and
 * every HMR update would otherwise look like a new deploy. Returns a
 * cleanup, same shape as jobsPoll.ts's startCatchupSweep. */
export function startAppUpdateCheck(): () => void {
  if (import.meta.env.DEV) return () => {};

  const initialSrc = getCurrentBundleSrc();
  if (!initialSrc) return () => {};

  let shown = false;
  const check = () => {
    if (shown || document.visibilityState !== "visible") return;
    getServerBundleSrc()
      .then((latestSrc) => {
        if (latestSrc && latestSrc !== initialSrc && !shown) {
          shown = true;
          showUpdateNotification();
        }
      })
      .catch(() => {
        // Best-effort -- a failed check (offline, backend restarting) just
        // tries again next interval rather than erroring the whole app.
      });
  };

  const interval = setInterval(check, CHECK_INTERVAL_MS);
  // Also check right away whenever the tab regains focus, not just on the
  // fixed interval -- that's when a long-idle tab is most likely stale.
  document.addEventListener("visibilitychange", check);
  return () => {
    clearInterval(interval);
    document.removeEventListener("visibilitychange", check);
  };
}
