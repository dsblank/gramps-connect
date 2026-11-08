// One-time move of browser storage keys from their old, mixed names
// ("gramps-connect.lang", "gramps-connect_column_widths",
// "mantine-color-scheme-value", ...) to the single "gramps-connect:<name>"
// convention in storageKeys.ts. Runs first thing in main.tsx, before i18n
// reads the language or Mantine reads the color scheme. Moving the
// sessionStorage sign-in keys too keeps everyone signed in across the
// upgrade. Safe to repeat: once the old keys are gone it does nothing.
// Added 2026-11-08 -- delete after a few releases.
import { STORAGE_KEYS } from "./storageKeys";

const K = STORAGE_KEYS;

const LOCAL_EXACT: [string, string][] = [
  ["mantine-color-scheme-value", K.colorScheme],
  ["gramps-connect.lang", K.language],
  ["gramps-connect_tree_manual_expand", K.treeManualExpand],
  ["gramps-connect_browser_notifications_enabled", K.browserNotifications],
  ["gramps-connect.largeImageChoice", K.largeImageChoice],
  ["gramps-connect_aside_widths", K.asideWidths],
  ["gramps-connect_column_widths", K.columnWidths],
  ["gramps-connect:map-viewport", K.mapViewport],
  ["gramps-connect:pyodidePocPanelHeight", K.viewGrampletPanelHeight],
  ["gramps-connect_chart_export", K.chartExport],
  ["gramps-connect_external_search", K.externalSearch],
  ["gramps-connect_anniversaries_only_living", K.anniversariesOnlyLiving],
  ["gramps-connect_home_person", K.homePerson],
  ["gramps-connect_visited", K.visited],
];

const LOCAL_PREFIX: [string, string][] = [
  ["gramps-connect:pyodidePocPanelCollapsed:", "gramps-connect:viewGrampletPanelCollapsed:"],
  ["gramps-connect:blog-draft:", "gramps-connect:blogDraft:"],
];

const SESSION_EXACT: [string, string][] = [
  ["gramps-connect.token", K.token],
  ["gramps-connect.refreshToken", K.refreshToken],
  ["gramps-connect.username", K.username],
  ["gramps-connect.clockSkewMs", K.clockSkewMs],
  ["gramps-connect.pendingIndexTasks", K.pendingIndexTasks],
  ["gramps-connect_nav_max", K.navMax],
];

function move(storage: Storage, from: string, to: string): void {
  const value = storage.getItem(from);
  if (value === null) return;
  if (storage.getItem(to) === null) storage.setItem(to, value);
  storage.removeItem(from);
}

function migrate(storage: Storage, exact: [string, string][], prefixes: [string, string][]): void {
  for (const [from, to] of exact) move(storage, from, to);
  if (prefixes.length === 0) return;
  // Collect first: removing keys while indexing shifts the indexes.
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null) keys.push(key);
  }
  for (const key of keys) {
    for (const [from, to] of prefixes) {
      if (key.startsWith(from)) move(storage, key, to + key.slice(from.length));
    }
  }
}

export function migrateStorageKeys(): void {
  try {
    migrate(localStorage, LOCAL_EXACT, LOCAL_PREFIX);
  } catch {
    // storage blocked (private browsing etc.) -- nothing to move
  }
  try {
    migrate(sessionStorage, SESSION_EXACT, []);
  } catch {
    // same
  }
}
