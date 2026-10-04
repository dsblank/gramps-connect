// The one set of user-facing callbacks for the report/export job watcher
// (jobsPoll.ts). Shared rather than per-caller so a finished job is
// announced identically however it was found: App.tsx starts the
// server-driven catch-up sweep with these, and ReportDialog.tsx hands the
// same object to trackJob() for a report it just dispatched itself.
import { Anchor } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { formatHash } from "../hash";
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
    const reportHint = "Some data couldn't be exported — see the report attached to it.";
    // Links into the Output view (GENERATED_VIEW, key "generated") at the
    // promoted Media object itself -- same formatHash-Anchor shape as
    // EditDialogs.tsx's own save toast. notifyBrowser gets the plain desc:
    // an OS notification has no room for a link, and clicking one doesn't
    // focus this tab/route anyway.
    // A job that came back with a report (promoteJob attached it as a
    // Note) toasts yellow and says so, so it isn't mistaken for a clean run.
    notifications.show({
      color: result.hasReport ? "yellow" : "green",
      title,
      autoClose: result.hasReport ? false : undefined,
      message: (
        <>
          <Anchor component="a" href={formatHash({ viewKey: "generated", handle: result.handle })} underline="never">
            {result.desc}
          </Anchor>
          {result.hasReport && <div>{reportHint}</div>}
        </>
      ),
    });
    notifyBrowser(title, result.hasReport ? `${result.desc} — ${reportHint}` : result.desc);
  },
  onDownloaded: (desc, kind) => {
    // Media archives never reach onPromoted -- see
    // jobsPromote.ts's downloadArchiveLocally doc comment -- so there's no
    // Output-view row to link to here, just an acknowledgement that the
    // browser's own save prompt already fired.
    const title = kind === "report" ? "Report ready" : "Export ready";
    const message = `${desc} — saved to your downloads.`;
    notifications.show({ color: "green", title, message });
    notifyBrowser(title, message);
  },
  onFailed: (kind, message) => {
    const title = kind === "report" ? "Report failed" : "Export failed";
    notifications.show({ color: "red", title, message });
    notifyBrowser(title, message);
  },
};
