// The one set of user-facing callbacks for the report/export job watcher
// (jobsPoll.ts). Shared rather than per-caller so a finished job is
// announced identically however it was found: App.tsx starts the
// server-driven catch-up sweep with these, and ReportDialog.tsx hands the
// same object to trackJob() for a report it just dispatched itself.
import { notifications } from "@mantine/notifications";
import type { JobsPollCallbacks } from "./jobsPoll";
import type { JobKind } from "./jobsPromote";
import { notifyBrowser } from "./browserNotifications";

/** Acknowledges a job the user just asked for. In-app only, deliberately:
 * unlike the finished/failed toasts below, the user is right here looking
 * at the tab they clicked Generate in, so a desktop notification would be
 * redundant. */
export function notifyJobStarted(kind: JobKind, what: string): void {
  notifications.show({
    color: "blue",
    title: kind === "report" ? "Generating report" : "Generating export",
    message: `${what} — you'll be notified when it's ready.`,
  });
}

export const jobsPollCallbacks: JobsPollCallbacks = {
  onPromoted: (result, kind) => {
    const title = kind === "report" ? "Report ready" : "Export ready";
    notifications.show({ color: "green", title, message: result.desc });
    notifyBrowser(title, result.desc);
  },
  onFailed: (kind, message) => {
    const title = kind === "report" ? "Report failed" : "Export failed";
    notifications.show({ color: "red", title, message });
    notifyBrowser(title, message);
  },
};
