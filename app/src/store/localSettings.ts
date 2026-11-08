// Preferences > General's Download / Load / Reset settings: every
// localStorage key storageKeys.ts tags as a `setting`, copied as the raw
// stored strings so no per-setting code is needed. Sign-in
// (sessionStorage) and the Visited history are never touched. Callers
// reload the page afterwards, since most settings are only read at startup.
import { isSettingKey } from "./storageKeys";

export const SETTINGS_FORMAT = "gramps-connect-settings";
export const SETTINGS_VERSION = 1;

export interface SettingsFile {
  format: typeof SETTINGS_FORMAT;
  version: number;
  exported: string;
  settings: Record<string, string>;
}

/** Why a file can't be loaded -- the UI turns these into messages. */
export type SettingsFileError = "notJson" | "wrongFormat" | "newerVersion";

export class SettingsFileInvalid extends Error {
  constructor(readonly reason: SettingsFileError) {
    super(reason);
  }
}

function settingKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key !== null && isSettingKey(key)) keys.push(key);
  }
  return keys.sort();
}

export function exportLocalSettings(now: Date = new Date()): SettingsFile {
  const settings: Record<string, string> = {};
  for (const key of settingKeys()) {
    const value = localStorage.getItem(key);
    if (value !== null) settings[key] = value;
  }
  return { format: SETTINGS_FORMAT, version: SETTINGS_VERSION, exported: now.toISOString(), settings };
}

/** Parses and checks a settings file, splitting its entries into the ones
 * that would be loaded and the count of ones that would be skipped
 * (unknown keys or non-string values). Throws SettingsFileInvalid. */
export function parseSettingsFile(text: string): { settings: Record<string, string>; skipped: number } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SettingsFileInvalid("notJson");
  }
  const file = data as Partial<SettingsFile> | null;
  if (!file || typeof file !== "object" || file.format !== SETTINGS_FORMAT || typeof file.version !== "number") {
    throw new SettingsFileInvalid("wrongFormat");
  }
  if (file.version > SETTINGS_VERSION) throw new SettingsFileInvalid("newerVersion");
  const raw = file.settings && typeof file.settings === "object" ? file.settings : {};
  const settings: Record<string, string> = {};
  let skipped = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (isSettingKey(key) && typeof value === "string") settings[key] = value;
    else skipped++;
  }
  return { settings, skipped };
}

/** Merges: writes each setting in `settings`, leaves every other current
 * setting as it is. Takes parseSettingsFile()'s output. */
export function importLocalSettings(settings: Record<string, string>): void {
  for (const [key, value] of Object.entries(settings)) {
    if (isSettingKey(key)) localStorage.setItem(key, value);
  }
}

export function resetLocalSettings(): void {
  for (const key of settingKeys()) localStorage.removeItem(key);
}

export function settingsFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `gramps-connect-settings-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}
