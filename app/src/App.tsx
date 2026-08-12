import { useEffect, useSyncExternalStore } from "react";
import { AppShell, Group, Image, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { VIEWS } from "./store/views";
import { getViewStore } from "./store/registry";
import { getAuthSnapshot, subscribe as subscribeAuth } from "./auth/auth";
import { LoginForm } from "./auth/LoginForm";
import { Sidebar } from "./components/Sidebar";
import { MenuBar } from "./components/MenuBar";
import { UserMenu } from "./components/UserMenu";
import { FilterBar } from "./components/FilterBar";
import { TeamNoteComposer } from "./components/TeamNoteComposer";
import { DataTable } from "./components/DataTable";
import { AsideSplit } from "./components/AsideSplit";
import { StatusBar } from "./components/StatusBar";
import { useHistorySync } from "./hooks/useHistorySync";
import { useLiveSync } from "./hooks/useLiveSync";
import type { TreeChangeNotification } from "./store/historyPoll";
import { startCatchupSweep, type JobsPollCallbacks } from "./store/jobsPoll";
import { notifyBrowser } from "./store/browserNotifications";
import logo from "./assets/icons/gramps-logo.svg";

export function App() {
  const loggedIn = useSyncExternalStore(subscribeAuth, getAuthSnapshot);
  return loggedIn ? <AuthenticatedApp /> : <LoginForm />;
}

/** In-app toasts for the job-status watcher (store/jobsPoll.ts) -- shared
 * by the catch-up sweep started below, and available for a future report/
 * export trigger UI (out of scope here, see the plan) to pass to
 * trackJob() for the dispatch-scoped loop's own completion toast. */
const jobsPollCallbacks: JobsPollCallbacks = {
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

/** Toast for a Notes-table change by someone else, per useLiveSync's
 * onRemoteNoteChange -- same notifications.show + notifyBrowser shape as
 * jobsPollCallbacks above. changedBy is non-null whenever this fires (see
 * useLiveSync's own guard). */
const NOTE_OP_VERB: Record<TreeChangeNotification["op"], string> = {
  INSERT: "made",
  UPDATE: "made",
  DELETE: "deleted",
};

function onRemoteNoteChange(notification: TreeChangeNotification) {
  const title = "Gramps Connect message";
  const message = `User ${notification.changedBy} ${NOTE_OP_VERB[notification.op]} a message`;
  notifications.show({ color: "blue", title, message });
  notifyBrowser(title, message);
}

function AuthenticatedApp() {
  const { activeKey, setActiveKey } = useHistorySync();
  const liveSyncStatus = useLiveSync(onRemoteNoteChange);
  const view = VIEWS.find((v) => v.key === activeKey)!;

  // Lazy per-view load, same as the original spike's ensureViewLoaded()
  // call in selectView() -- a no-op if this view was already loaded
  // earlier this session.
  useEffect(() => {
    getViewStore(activeKey).ensureLoaded().catch((err) => {
      console.error(`[${activeKey}] failed to load`, err);
    });
  }, [activeKey]);

  // Server-driven catch-up sweep for reports/exports whose dispatching tab
  // is gone -- see jobsPoll.ts's startCatchupSweep. Mounted once for the
  // whole authenticated app, same lifetime as useLiveSync() above.
  useEffect(() => {
    return startCatchupSweep(jobsPollCallbacks);
  }, []);

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 68, breakpoint: "sm" }}
      aside={{ width: "50%", breakpoint: "sm" }}
      footer={{ height: 36 }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="lg">
            <Group gap="xs">
              <Image src={logo} alt="" w={32} h={32} />
              <Title order={4} fw={600}>Gramps Connect</Title>
            </Group>
            <MenuBar />
          </Group>
          <UserMenu />
        </Group>
      </AppShell.Header>

      <AppShell.Navbar>
        <Sidebar activeKey={activeKey} onSelect={setActiveKey} />
      </AppShell.Navbar>

      <AppShell.Main>
        {/* Keyed by view.key so switching views remounts fresh local state
            (filter input/error, scroll position) rather than carrying it
            over from the previous view. Prefixed distinctly per element --
            React requires keys to be unique only among *siblings*, and
            these two are both direct children of the same fragment; reusing
            the bare view.key for both produced a real bug (a "duplicate
            key" warning, and FilterBar instances piling up instead of
            unmounting) caught by an end-to-end smoke test. */}
        <FilterBar key={`filter-${view.key}`} view={view} />
        {view.key === "team_note" && <TeamNoteComposer key={`compose-${view.key}`} />}
        <DataTable key={`table-${view.key}`} view={view} />
      </AppShell.Main>

      <AppShell.Aside>
        <AsideSplit key={`detail-${view.key}`} view={view} />
      </AppShell.Aside>

      <AppShell.Footer>
        <StatusBar view={view} liveSyncStatus={liveSyncStatus} />
      </AppShell.Footer>
    </AppShell>
  );
}
