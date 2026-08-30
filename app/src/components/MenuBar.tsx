import { Fragment, lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { Box, Button, Divider, Group, Loader, Menu } from "@mantine/core";
import { getToken, hasPermissions } from "../auth/auth";
import { addDesktopTranslations, getI18nSnapshot, subscribe as subscribeI18n, t } from "../i18n/i18n";
import { ImportDialog } from "./ImportDialog";
import { ImportMediaDialog } from "./ImportMediaDialog";
import { ExportDialog } from "./ExportDialog";
import { DeleteAllDialog } from "./DeleteAllDialog";
import { ReportDialog } from "./ReportDialog";
import { OverviewDialog } from "./OverviewDialog";
import { SystemInfoDialog } from "./SystemInfoDialog";
import { AboutDialog } from "./AboutDialog";
import { formatHash } from "../hash";
import { listReports, REPORT_CATEGORIES, type ReportSummary } from "../store/reportsApi";
import { DRAFT_TYPE_LABELS, EDITABLE_TYPES, type UseDraftStack } from "../store/draftStack";
import { runMediaExport } from "../store/mediaExportApi";
import { exportLabel, downloadArchiveLocally } from "../store/jobsPromote";
import { trackJob } from "../store/jobsPoll";
import { jobsPollCallbacks, notifyJobStarted } from "../store/jobsCallbacks";
import { GRAMPLET_AUTHOR_PERMISSION } from "../pyodidePoc/grampletMedia";

// maplibre-gl and terra-draw are the heaviest thing this app can pull in
// (see MapItemEditorDialog.tsx's own doc comment) -- lazy so a session that
// never opens "Add Map Item…" never fetches either, same reasoning as
// MapView.tsx's own lazy MapCanvas import.
const MapItemEditorDialog = lazy(() =>
  import("./MapItemEditorDialog").then((m) => ({ default: m.MapItemEditorDialog })));

// pyodidePoc/ pulls in prismjs/react-simple-code-editor -- lazy for the
// same reason MapItemEditorDialog above is: a session that never opens
// "Add Gramplet…" never fetches either. GRAMPLET_AUTHOR_PERMISSION below
// is a plain string constant from the same directory's grampletMedia.ts,
// not GrampletEditDialog.tsx itself, so importing it plainly doesn't pull
// prismjs/react-simple-code-editor in regardless.
const GrampletEditDialog = lazy(() =>
  import("../pyodidePoc/GrampletEditDialog").then((m) => ({ default: m.GrampletEditDialog })));

// Matches gramps-web-api's PERMISSIONS map (auth/const.py) -- both granted
// at ROLE_OWNER and above.
const PERM_IMPORT_FILE = "ImportFile";
const PERM_DEL_OBJ_BATCH = "BatchDeleteObjects";
// Exporting itself needs no permission (any logged-in user may POST to the
// exporters endpoint), but *delivering* the result does: the finished file
// is handed over as a Media object the client creates, tags and describes
// (store/jobsPromote.ts), so a user who can't do that would watch the
// export succeed and then fail on the way out. Checking EditObject alone
// covers the whole promotion: it's granted from ROLE_EDITOR up, and every
// role holding it also holds AddObject (which arrives one role earlier, at
// ROLE_CONTRIBUTOR) -- so a contributor, who could upload the file but not
// then tag it, is correctly excluded too.
const PERM_EDIT_OBJ = "EditObject";
// Creating a Person needs only this. Creating a Family needs it *and*
// EditObject -- families.py's FamiliesResource.post() checks both, because
// adding a Family also rewrites its parents' Person records (family_list).
const PERM_ADD_OBJ = "AddObject";

interface MenuItemSpec {
  label: string;
  /** gramps-web-api permission name(s) required to show this item (see
   * auth/const.py's PERMISSIONS map) -- omitted means every logged-in user
   * sees it; an array requires all of them. */
  perm?: string | string[];
  onClick?: () => void;
  /** Renders a divider above this item -- used to set a destructive action
   * apart from the rest of its menu. */
  separatorBefore?: boolean;
  danger?: boolean;
  /** Turns this item into a submenu. Mutually exclusive with onClick. */
  children?: MenuItemSpec[];
}

interface AppMenuProps {
  label: string;
  items: MenuItemSpec[];
  /** Called each time the dropdown opens -- lets a menu whose contents
   * come from the server (Reports) hold off fetching until someone
   * actually looks at it. */
  onOpen?: () => void;
}

/** One row of a dropdown: a plain item, or a submenu when it has children.
 * Recursive, though nothing nests deeper than one level today. */
function AppMenuItem({ item }: { item: MenuItemSpec }) {
  const body = item.children ? (
    <Menu.Sub>
      <Menu.Sub.Target>
        <Menu.Sub.Item>{item.label}</Menu.Sub.Item>
      </Menu.Sub.Target>
      <Menu.Sub.Dropdown>
        {item.children.map((child) => (
          <AppMenuItem key={child.label} item={child} />
        ))}
      </Menu.Sub.Dropdown>
    </Menu.Sub>
  ) : (
    <Menu.Item onClick={item.onClick} c={item.danger ? "red" : undefined}>
      {item.label}
    </Menu.Item>
  );
  return (
    <>
      {item.separatorBefore && <Divider />}
      {body}
    </>
  );
}

/** One top-level dropdown in the bar. Filters items down to ones the
 * current user is permitted to see; if that leaves nothing (either the
 * menu has no real items yet, or none the user is allowed), the dropdown
 * still opens but shows a single disabled row rather than the menu
 * disappearing or being unclickable -- keeps the bar's layout stable as
 * items land menu by menu instead of the whole row reflowing each time. */
function AppMenu({ label, items, onOpen }: AppMenuProps) {
  const visibleItems = items.filter(
    (item) => !item.perm || hasPermissions(...(Array.isArray(item.perm) ? item.perm : [item.perm]))
  );
  return (
    <Menu shadow="md" width={200} position="bottom-start" onOpen={onOpen}>
      <Menu.Target>
        <Button variant="subtle" size="xs">
          {label}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {visibleItems.length === 0 ? (
          <Menu.Item disabled>{t("Nothing here yet")}</Menu.Item>
        ) : (
          visibleItems.map((item) => (
            <Fragment key={item.label}>
              <AppMenuItem item={item} />
            </Fragment>
          ))
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

// Fetched once per session, on the first open of the Reports menu, and
// shared by every MenuBar instance (App.tsx renders one of two header
// layouts, and swaps between them on resize). The list is fixed for the
// life of the server process -- it's the set of installed report plugins,
// not tree data -- so there's nothing to invalidate.
let reportsPromise: Promise<ReportSummary[]> | null = null;

function loadReports(): Promise<ReportSummary[]> {
  if (!reportsPromise) {
    reportsPromise = (async () => listReports(await getToken()))().catch((err) => {
      // Don't cache the failure: the next open should try again.
      reportsPromise = null;
      throw err;
    });
  }
  return reportsPromise;
}

/** The Reports menu's items: one submenu per report category, in desktop
 * Gramps' own order (REPORT_CATEGORIES), skipping any category no
 * installed report belongs to. */
function reportMenuItems(reports: ReportSummary[], onPick: (id: string) => void): MenuItemSpec[] {
  return REPORT_CATEGORIES.flatMap(({ category, label }) => {
    const inCategory = reports.filter((report) => report.category === category);
    if (inCategory.length === 0) return [];
    return [
      {
        label: t(label),
        children: inCategory.map((report) => ({
          label: t(report.name),
          onClick: () => onPick(report.id),
        })),
      },
    ];
  });
}

/** A menu item that navigates rather than opening something -- written to
 * the same location.hash channel useHistorySync listens on, so it lands in
 * browser history like any other view switch. */
function goTo(viewKey: string) {
  window.location.hash = formatHash({ viewKey, handle: null });
}

/** Export -> Media…: unlike the Family Tree export, there's no format or
 * option to pick -- one archive, every Media file the caller may see -- so
 * this dispatches straight from the menu instead of opening a dialog first.
 * Otherwise the same fire-and-forget pipeline as ExportDialog's
 * handleExport: the POST returns fast either way (a task id to poll, or --
 * no Celery broker -- the finished archive already sitting there). The
 * result is never promoted into the tree as Media, unlike every other job
 * kind -- see jobsPromote.ts's downloadArchiveLocally doc comment on why a
 * copy of the tree's whole media collection has no business being stored
 * *in* the tree a second time -- it goes straight to the user's disk. */
function handleExportMedia() {
  const desc = exportLabel("Media");
  notifyJobStarted("export", "Media");

  (async () => {
    const token = await getToken();
    const result = await runMediaExport(token);
    if (result.kind === "task") {
      trackJob(result.taskId, "export", jobsPollCallbacks, desc);
      return;
    }
    if (await downloadArchiveLocally(token, result.url, desc)) jobsPollCallbacks.onDownloaded(desc, "export");
  })().catch((err: any) => {
    jobsPollCallbacks.onFailed("export", err.message ?? String(err));
  });
}

/** The desktop-Gramps-style menu bar, following ~/gramps/gramps'
 * viewmanager.py menu layout and order. Only the menus with something in
 * them are shown: desktop Gramps' Edit and Tools are left out until they
 * have items, rather than standing empty ("Nothing here yet"). Add now has
 * its first two items -- New Person/Family, opening the stacked create
 * dialogs in EditDialogs.tsx (see draftStack.ts). */
interface MenuBarProps {
  /** Owned by App.tsx, not here -- see its doc comment on why: the header
   * swaps between two MenuBar instances on resize, and only one is ever
   * mounted at a time, so state local to this component wouldn't survive
   * that. */
  draftStack: UseDraftStack;
}

export function MenuBar({ draftStack }: MenuBarProps) {
  const [importOpened, setImportOpened] = useState(false);
  const [importMediaOpened, setImportMediaOpened] = useState(false);
  const [exportOpened, setExportOpened] = useState(false);
  const [deleteAllOpened, setDeleteAllOpened] = useState(false);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [reportId, setReportId] = useState<string | null>(null);
  const [overviewOpened, setOverviewOpened] = useState(false);
  const [systemInfoOpened, setSystemInfoOpened] = useState(false);
  const [aboutOpened, setAboutOpened] = useState(false);
  const [mapItemOpened, setMapItemOpened] = useState(false);
  const [grampletOpened, setGrampletOpened] = useState(false);

  // App.tsx mounts a second MenuBar when the header switches layouts, so
  // the fetch is deduplicated in loadReports() and only its result is
  // per-instance state. An error leaves `reports` empty, which AppMenu
  // already renders as the standard "Nothing here yet" row.
  const [reportsRequested, setReportsRequested] = useState(false);
  useEffect(() => {
    if (!reportsRequested) return;
    let cancelled = false;
    loadReports()
      .then((list) => {
        if (!cancelled) setReports(list);
      })
      .catch((err) => console.error("failed to list reports", err));
    return () => {
      cancelled = true;
    };
  }, [reportsRequested]);

  // Report names come from whatever plugins the server has installed --
  // unlike i18n.ts's static desktopStrings list, there's no way to know
  // them ahead of time, so they're translated as a separate batch once
  // loaded (see addDesktopTranslations' doc comment). Depends on `lang` too:
  // the report list itself is cached for the session (loadReports()), but a
  // language change needs this batch re-translated for the new language.
  const { lang } = useSyncExternalStore(subscribeI18n, getI18nSnapshot);
  useEffect(() => {
    if (reports.length > 0) addDesktopTranslations(reports.map((r) => r.name));
  }, [reports, lang]);

  return (
    <>
      {/* Never wraps: the header it sits in has a fixed height, so a
          second line would render straight through the bottom of it and
          end up behind the search box. Whoever places the bar decides what
          happens when it doesn't fit -- App.tsx's narrow header gives it a
          row of its own that scrolls sideways. */}
      <Group gap={2} wrap="nowrap">
        <AppMenu
          label={t("Family Trees")}
          items={[
            {
              label: "Import…",
              perm: PERM_IMPORT_FILE,
              children: [
                { label: "Family Tree…", onClick: () => setImportOpened(true) },
                { label: "Media…", onClick: () => setImportMediaOpened(true) },
              ],
            },
            {
              label: "Export…",
              perm: PERM_EDIT_OBJ,
              children: [
                { label: "Family Tree…", onClick: () => setExportOpened(true) },
                { label: "Media…", onClick: handleExportMedia },
              ],
            },
            {
              label: "Delete…",
              perm: PERM_DEL_OBJ_BATCH,
              onClick: () => setDeleteAllOpened(true),
              separatorBefore: true,
              danger: true,
            },
          ]}
        />
        <AppMenu
          label={t("Add")}
          // "story" is in EDITABLE_TYPES only so EditButton.tsx's shared
          // eligibility check offers Edit on an existing story note (see
          // draftStack.ts's own doc comment) -- filtered back out here
          // since a blank story has no person to attach to; the only way
          // to create one is the person-scoped "+ Add a story" generate
          // flow (NotesSection.tsx's AddStoryControl, via
          // storyApi.ts's generatePersonStory).
          items={[
            ...EDITABLE_TYPES.filter((type) => type !== "story").map((type) => ({
              label: `New ${DRAFT_TYPE_LABELS[type]}…`,
              // Family alone needs EditObject too -- families.py's
              // FamiliesResource.post() checks both, because adding a
              // Family also rewrites its parents' Person records
              // (family_list). Every other type's resource has no such
              // post() override (confirmed against gramps-web-api's
              // events/places/sources/citations/repositories/notes/tags.py),
              // so plain AddObject is correct for the rest.
              perm: type === "family" ? [PERM_ADD_OBJ, PERM_EDIT_OBJ] : PERM_ADD_OBJ,
              onClick: () => draftStack.openDraft(type),
            })),
            {
              // Not a draft type (see draftStack.ts's own exclusion of
              // Media) -- opens MapItemEditorDialog.tsx directly instead of
              // going through draftStack.openDraft.
              label: "Add Map Item…",
              perm: PERM_ADD_OBJ,
              onClick: () => setMapItemOpened(true),
              separatorBefore: true,
            },
            {
              // Also not a draft type -- opens GrampletEditDialog.tsx
              // directly, same as Add Map Item just above. Gated well
              // above the AddObject/EditObject an ordinary Media upload
              // needs -- see grampletMedia.ts's GRAMPLET_AUTHOR_PERMISSION
              // doc comment (discussion #4, F9): Gramplet code runs in
              // every viewer's browser who adds it to their own view, not
              // just the author's, so authoring one needs a higher bar
              // than editing an ordinary Media object does.
              label: "Add Gramplet…",
              perm: GRAMPLET_AUTHOR_PERMISSION,
              onClick: () => setGrampletOpened(true),
            },
          ]}
        />
        {/* None needs a permission: Map/Timeline read data the app already
            has cached locally, and Graphs' per-open fetch needs nothing
            beyond being logged in, same as opening any other table. Each is
            a route rather than a dialog (see hash.ts), so picking one is an
            ordinary navigation -- App.tsx renders it over the whole content
            area, and Back returns to the table you came from. */}
        <AppMenu
          label={t("View")}
          items={[
            { label: "Map", onClick: () => goTo("map") },
            { label: "Timeline", onClick: () => goTo("timeline") },
            { label: "Graphs", onClick: () => goTo("tree") },
          ]}
        />
        <AppMenu
          label={t("Reports")}
          items={reportMenuItems(reports, setReportId)}
          onOpen={() => setReportsRequested(true)}
        />
        {/* No permissions here: Overview and About are prose about the app
            itself, the same for every reader, and someone with the fewest
            privileges is the one most likely to be new and want them.
            System Information reads /api/metadata/, which every logged-in
            user may call (it's a ProtectedResource, not a permissioned
            one) -- and reporting a bug is exactly what a reader with no
            privileges still needs to be able to do. */}
        <AppMenu
          label={t("Help")}
          items={[
            { label: "Overview", onClick: () => setOverviewOpened(true) },
            { label: "System Information", onClick: () => setSystemInfoOpened(true) },
            { label: "About", onClick: () => setAboutOpened(true), separatorBefore: true },
          ]}
        />
      </Group>
      <ImportDialog opened={importOpened} onClose={() => setImportOpened(false)} />
      <ImportMediaDialog opened={importMediaOpened} onClose={() => setImportMediaOpened(false)} />
      <ExportDialog opened={exportOpened} onClose={() => setExportOpened(false)} />
      <DeleteAllDialog opened={deleteAllOpened} onClose={() => setDeleteAllOpened(false)} />
      <ReportDialog reportId={reportId} onClose={() => setReportId(null)} />
      <OverviewDialog opened={overviewOpened} onClose={() => setOverviewOpened(false)} />
      <SystemInfoDialog opened={systemInfoOpened} onClose={() => setSystemInfoOpened(false)} />
      {/* About's overview link hands over to the Overview dialog rather
          than stacking a second modal on top of the first. */}
      <AboutDialog
        opened={aboutOpened}
        onClose={() => setAboutOpened(false)}
        onShowOverview={() => {
          setAboutOpened(false);
          setOverviewOpened(true);
        }}
      />
      {mapItemOpened && (
        <Suspense
          fallback={
            <Box style={{ position: "fixed", inset: 0, zIndex: 300 }}>
              <Loader size="sm" style={{ position: "absolute", top: "50%", left: "50%" }} />
            </Box>
          }
        >
          <MapItemEditorDialog target={{ kind: "new" }} onClose={() => setMapItemOpened(false)} />
        </Suspense>
      )}
      {grampletOpened && (
        <Suspense
          fallback={
            <Box style={{ position: "fixed", inset: 0, zIndex: 300 }}>
              <Loader size="sm" style={{ position: "absolute", top: "50%", left: "50%" }} />
            </Box>
          }
        >
          <GrampletEditDialog target={{ kind: "new" }} onClose={() => setGrampletOpened(false)} />
        </Suspense>
      )}
    </>
  );
}
