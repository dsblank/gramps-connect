import { useEffect, useState, useSyncExternalStore } from "react";
import "./components/App.css";
import { VIEWS } from "./store/views";
import { getViewStore } from "./store/registry";
import { getAuthSnapshot, subscribe as subscribeAuth, logout } from "./auth/auth";
import { LoginForm } from "./auth/LoginForm";
import { Sidebar } from "./components/Sidebar";
import { FilterBar } from "./components/FilterBar";
import { DataTable } from "./components/DataTable";
import { StatusBar } from "./components/StatusBar";
import { useLiveSync } from "./hooks/useLiveSync";

export function App() {
  const loggedIn = useSyncExternalStore(subscribeAuth, getAuthSnapshot);
  return loggedIn ? <AuthenticatedApp /> : <LoginForm />;
}

function AuthenticatedApp() {
  const [activeKey, setActiveKey] = useState(VIEWS[0].key);
  const liveSyncStatus = useLiveSync();
  const view = VIEWS.find((v) => v.key === activeKey)!;

  // Lazy per-view load, same as the original spike's ensureViewLoaded()
  // call in selectView() -- a no-op if this view was already loaded
  // earlier this session.
  useEffect(() => {
    getViewStore(activeKey).ensureLoaded().catch((err) => {
      console.error(`[${activeKey}] failed to load`, err);
    });
  }, [activeKey]);

  return (
    <div className="app-layout">
      <Sidebar activeKey={activeKey} onSelect={setActiveKey} />
      <main className="app-main">
        <div className="app-header">
          <h1>Gramps Connect</h1>
          <button onClick={logout}>Sign out</button>
        </div>
        {/* Keyed by view.key so switching views remounts fresh local state
            (filter input/error, scroll position) rather than carrying it
            over from the previous view. Prefixed distinctly per element --
            React requires keys to be unique only among *siblings*, and
            these two are both direct children of the same <main>; reusing
            the bare view.key for both produced a real bug (a "duplicate
            key" warning, and FilterBar instances piling up instead of
            unmounting) caught by an end-to-end smoke test. */}
        <FilterBar key={`filter-${view.key}`} view={view} />
        <StatusBar view={view} liveSyncStatus={liveSyncStatus} />
        <DataTable key={`table-${view.key}`} view={view} />
      </main>
    </div>
  );
}
