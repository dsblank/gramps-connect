import { useEffect, useState, useSyncExternalStore } from "react";
import { AppShell, Group, Image, SegmentedControl, Title, Button, useMantineColorScheme, useComputedColorScheme } from "@mantine/core";
import { VIEWS } from "./store/views";
import { getViewStore } from "./store/registry";
import { getAuthSnapshot, subscribe as subscribeAuth, logout } from "./auth/auth";
import { LoginForm } from "./auth/LoginForm";
import { Sidebar } from "./components/Sidebar";
import { FilterBar } from "./components/FilterBar";
import { DataTable } from "./components/DataTable";
import { StatusBar } from "./components/StatusBar";
import { useLiveSync } from "./hooks/useLiveSync";
import logo from "./assets/icons/gramps-logo.svg";

export function App() {
  const loggedIn = useSyncExternalStore(subscribeAuth, getAuthSnapshot);
  return loggedIn ? <AuthenticatedApp /> : <LoginForm />;
}

function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme("light");
  return (
    <SegmentedControl
      size="xs"
      value={computed}
      onChange={(value) => setColorScheme(value as "light" | "dark")}
      data={[
        { label: "Light", value: "light" },
        { label: "Dark", value: "dark" },
      ]}
    />
  );
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
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 68, breakpoint: "sm" }}
      footer={{ height: 36 }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="xs">
            <Image src={logo} alt="" w={32} h={32} />
            <Title order={4} fw={600}>Gramps Connect</Title>
          </Group>
          <Group gap="md">
            <ColorSchemeToggle />
            <Button variant="subtle" size="xs" onClick={logout}>Sign out</Button>
          </Group>
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
        <DataTable key={`table-${view.key}`} view={view} />
      </AppShell.Main>

      <AppShell.Footer>
        <StatusBar view={view} liveSyncStatus={liveSyncStatus} />
      </AppShell.Footer>
    </AppShell>
  );
}
