// Opening Preferences from anywhere (e.g. a Citation's Format dialog's
// "Make one in Preferences"): UserMenu.tsx owns the dialog and listens
// here, so a caller needs no reference to it.

export interface PreferencesTarget {
  tab: "general" | "tree";
  /** A section of the tab to scroll to: DisplaySettingsPanel's
   * `preferences-<section>` ids, e.g. "citations". */
  section?: string;
}

type Listener = (target: PreferencesTarget) => void;
const listeners = new Set<Listener>();

export function openPreferences(target: PreferencesTarget): void {
  for (const listener of listeners) listener(target);
}

export function subscribePreferencesRequests(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
