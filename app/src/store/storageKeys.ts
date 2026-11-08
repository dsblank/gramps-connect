// Every localStorage/sessionStorage key gramps-connect uses, in one place.
// All follow one convention: "gramps-connect:<camelCaseName>", with
// ":"-separated parts for keys built at runtime (per Gramplet, per view,
// per tree and user). No other module writes a key literal of its own --
// storageKeys.test.ts enforces that -- so a new key has to be added here
// and tagged, which is what keeps Preferences > General's Download / Load
// / Reset settings (localSettings.ts) from silently missing one.
//
// `setting`: a per-browser preference in localStorage, part of Download /
// Load / Reset. `excluded`: kept out of all three -- sessionStorage
// (sign-in, per-tab state) and the Visited history.

const P = "gramps-connect:";

type Tag = "setting" | "excluded";

interface KeyDef {
  /** The exact key, or the prefix of a key built at runtime. */
  key: string;
  prefix?: boolean;
  tag: Tag;
}

const DEFS = {
  // localStorage, settings
  colorScheme: { key: `${P}colorScheme`, tag: "setting" },
  language: { key: `${P}language`, tag: "setting" },
  treeManualExpand: { key: `${P}treeManualExpand`, tag: "setting" },
  browserNotifications: { key: `${P}browserNotifications`, tag: "setting" },
  largeImageChoice: { key: `${P}largeImageChoice`, tag: "setting" },
  asideWidths: { key: `${P}asideWidths`, tag: "setting" },
  columnWidths: { key: `${P}columnWidths`, tag: "setting" },
  mapViewport: { key: `${P}mapViewport`, tag: "setting" },
  externalSearchWindowGeometry: { key: `${P}externalSearchWindowGeometry`, tag: "setting" },
  viewGrampletPanelHeight: { key: `${P}viewGrampletPanelHeight`, tag: "setting" },
  viewGrampletPanelCollapsed: { key: `${P}viewGrampletPanelCollapsed:`, prefix: true, tag: "setting" },
  grampletWindowGeometry: { key: `${P}grampletWindowGeometry:`, prefix: true, tag: "setting" },
  grampletAddedViews: { key: `${P}grampletAddedViews:`, prefix: true, tag: "setting" },
  chartExport: { key: `${P}chartExport`, tag: "setting" },
  externalSearch: { key: `${P}externalSearch`, tag: "setting" },
  anniversariesOnlyLiving: { key: `${P}anniversariesOnlyLiving`, tag: "setting" },
  homePerson: { key: `${P}homePerson`, tag: "setting" },
  blogDraft: { key: `${P}blogDraft:`, prefix: true, tag: "setting" },
  // localStorage, excluded
  visited: { key: `${P}visited`, tag: "excluded" },
  // sessionStorage
  token: { key: `${P}token`, tag: "excluded" },
  refreshToken: { key: `${P}refreshToken`, tag: "excluded" },
  username: { key: `${P}username`, tag: "excluded" },
  clockSkewMs: { key: `${P}clockSkewMs`, tag: "excluded" },
  pendingIndexTasks: { key: `${P}pendingIndexTasks`, tag: "excluded" },
  navMax: { key: `${P}navMax`, tag: "excluded" },
} satisfies Record<string, KeyDef>;

type Name = keyof typeof DEFS;
type ExactName = { [K in Name]: (typeof DEFS)[K] extends { prefix: true } ? never : K }[Name];

/** Exact keys by name, e.g. `STORAGE_KEYS.columnWidths`. */
export const STORAGE_KEYS = Object.fromEntries(
  Object.entries(DEFS)
    .filter(([, d]) => !(d as KeyDef).prefix)
    .map(([name, d]) => [name, d.key]),
) as Record<ExactName, string>;

export const viewGrampletPanelCollapsedKey = (viewKey: string) => `${DEFS.viewGrampletPanelCollapsed.key}${viewKey}`;
export const grampletWindowGeometryKey = (grampletId: string) => `${DEFS.grampletWindowGeometry.key}${grampletId}`;
export const grampletAddedViewsKey = (grampletId: string) => `${DEFS.grampletAddedViews.key}${grampletId}`;
export const blogDraftKey = (treeId: string, username: string) => `${DEFS.blogDraft.key}${treeId}:${username}`;

/** True if `key` is a localStorage setting that Download / Load / Reset
 * cover. */
export function isSettingKey(key: string): boolean {
  return Object.values(DEFS).some((d) => {
    const def = d as KeyDef;
    return def.tag === "setting" && (def.prefix ? key.startsWith(def.key) && key.length > def.key.length : key === def.key);
  });
}

/** Every key definition, for the guard test. */
export function allKeyDefs(): readonly KeyDef[] {
  return Object.values(DEFS);
}
