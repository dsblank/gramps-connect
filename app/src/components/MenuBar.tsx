import { Fragment, useState } from "react";
import { Button, Divider, Group, Menu } from "@mantine/core";
import { hasPermissions } from "../auth/auth";
import { ImportDialog } from "./ImportDialog";
import { DeleteAllDialog } from "./DeleteAllDialog";

// Matches gramps-web-api's PERMISSIONS map (auth/const.py) -- both granted
// at ROLE_OWNER and above.
const PERM_IMPORT_FILE = "ImportFile";
const PERM_DEL_OBJ_BATCH = "BatchDeleteObjects";

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
}

interface AppMenuProps {
  label: string;
  items: MenuItemSpec[];
}

/** One top-level dropdown in the bar. Filters items down to ones the
 * current user is permitted to see; if that leaves nothing (either the
 * menu has no real items yet, or none the user is allowed), the dropdown
 * still opens but shows a single disabled row rather than the menu
 * disappearing or being unclickable -- keeps the bar's layout stable as
 * items land menu by menu instead of the whole row reflowing each time. */
function AppMenu({ label, items }: AppMenuProps) {
  const visibleItems = items.filter((item) => !item.perm || hasPermissions(item.perm));
  return (
    <Menu shadow="md" width={200} position="bottom-start">
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
              {item.separatorBefore && <Divider />}
              <Menu.Item onClick={item.onClick} c={item.danger ? "red" : undefined}>
                {item.label}
              </Menu.Item>
            </Fragment>
          ))
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

/** The desktop-Gramps-style menu bar (Family Trees/Add/Edit/View/Reports/
 * Tools/Help, per ~/gramps/gramps' viewmanager.py menu layout) -- all seven
 * are shown now to reserve the bar's layout, but most are still empty
 * ("Nothing here yet") until their features exist; Family Trees > Import
 * is the first real one. */
export function MenuBar() {
  const [importOpened, setImportOpened] = useState(false);
  const [deleteAllOpened, setDeleteAllOpened] = useState(false);

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
        <AppMenu label="View" items={[]} />
        <AppMenu label="Reports" items={[]} />
        <AppMenu label="Tools" items={[]} />
        <AppMenu label="Help" items={[]} />
      </Group>
      <ImportDialog opened={importOpened} onClose={() => setImportOpened(false)} />
      <DeleteAllDialog opened={deleteAllOpened} onClose={() => setDeleteAllOpened(false)} />
    </>
  );
}
