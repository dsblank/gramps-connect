import { Fragment, useEffect, useState } from "react";
import { Button, Divider, Group, Menu } from "@mantine/core";
import { getToken, hasPermissions } from "../auth/auth";
import { ImportDialog } from "./ImportDialog";
import { ExportDialog } from "./ExportDialog";
import { DeleteAllDialog } from "./DeleteAllDialog";
import { ReportDialog } from "./ReportDialog";
import { formatHash } from "../hash";
import { listReports, REPORT_CATEGORIES, type ReportSummary } from "../store/reportsApi";

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

interface MenuItemSpec {
  label: string;
  /** gramps-web-api permission name required to show this item (see
   * auth/const.py's PERMISSIONS map) -- omitted means every logged-in user
   * sees it. */
  perm?: string;
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
  const visibleItems = items.filter((item) => !item.perm || hasPermissions(item.perm));
  return (
    <Menu shadow="md" width={200} position="bottom-start" onOpen={onOpen}>
      <Menu.Target>
        <Button variant="subtle" size="xs">
          {label}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {visibleItems.length === 0 ? (
          <Menu.Item disabled>Nothing here yet</Menu.Item>
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
        label,
        children: inCategory.map((report) => ({
          label: report.name,
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

/** The desktop-Gramps-style menu bar (Family Trees/Add/Edit/View/Reports/
 * Tools/Help, per ~/gramps/gramps' viewmanager.py menu layout) -- all seven
 * are shown now to reserve the bar's layout, but most are still empty
 * ("Nothing here yet") until their features exist; Family Trees > Import
 * is the first real one. */
export function MenuBar() {
  const [importOpened, setImportOpened] = useState(false);
  const [exportOpened, setExportOpened] = useState(false);
  const [deleteAllOpened, setDeleteAllOpened] = useState(false);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [reportId, setReportId] = useState<string | null>(null);

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

  return (
    <>
      {/* Never wraps: the header it sits in has a fixed height, so a
          second line would render straight through the bottom of it and
          end up behind the search box. Whoever places the bar decides what
          happens when it doesn't fit -- App.tsx's narrow header gives it a
          row of its own that scrolls sideways. */}
      <Group gap={2} wrap="nowrap">
        <AppMenu
          label="Family Trees"
          items={[
            { label: "Import…", perm: PERM_IMPORT_FILE, onClick: () => setImportOpened(true) },
            { label: "Export…", perm: PERM_EDIT_OBJ, onClick: () => setExportOpened(true) },
            {
              label: "Delete…",
              perm: PERM_DEL_OBJ_BATCH,
              onClick: () => setDeleteAllOpened(true),
              separatorBefore: true,
              danger: true,
            },
          ]}
        />
        <AppMenu label="Add" items={[]} />
        <AppMenu label="Edit" items={[]} />
        {/* Both are whole-tree overviews of data the app already has cached
            locally, so neither needs a permission: anyone who can see the
            Places and Events tables can see these. Each is a route rather
            than a dialog (see hash.ts), so picking one is an ordinary
            navigation -- App.tsx renders it over the whole content area,
            and Back returns to the table you came from. */}
        <AppMenu
          label="View"
          items={[
            { label: "Map", onClick: () => goTo("map") },
            { label: "Timeline", onClick: () => goTo("timeline") },
          ]}
        />
        <AppMenu
          label="Reports"
          items={reportMenuItems(reports, setReportId)}
          onOpen={() => setReportsRequested(true)}
        />
        <AppMenu label="Tools" items={[]} />
        <AppMenu label="Help" items={[]} />
      </Group>
      <ImportDialog opened={importOpened} onClose={() => setImportOpened(false)} />
      <ExportDialog opened={exportOpened} onClose={() => setExportOpened(false)} />
      <DeleteAllDialog opened={deleteAllOpened} onClose={() => setDeleteAllOpened(false)} />
      <ReportDialog reportId={reportId} onClose={() => setReportId(null)} />
    </>
  );
}
