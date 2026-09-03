import { useState } from "react";
import { Button } from "@mantine/core";
import { hasPermissions } from "../../auth/auth";
import { MERGE_SUPPORTED_VIEWS } from "../../store/mergeApi";
import type { ViewConfig } from "../../store/views";
import { MergeDialog } from "./MergeDialog";
import { t } from "../../i18n/i18n";

/** The shared header button SelectionMergeView.tsx shows in place of every
 * per-object Edit/Delete/Message when exactly two rows of a mergeable type
 * are selected. Gated the same way the backend's merge routes are
 * (require_permissions([PERM_EDIT_OBJ, PERM_DEL_OBJ]) --
 * gramps_webapi/api/resources/merge.py -- "one object survives edited, the
 * other is deleted"), plus MERGE_SUPPORTED_VIEWS since not every type has a
 * merge route at all. Renders nothing when ineligible -- SelectionMergeView
 * then shows no action row for that pair, matching the 2-selected spec
 * ("Merge-or-nothing", no Edit/Delete/Message fallback). */
export function MergeButton({ view, handles }: { view: ViewConfig; handles: [string, string] }) {
  const [opened, setOpened] = useState(false);
  const eligible = MERGE_SUPPORTED_VIEWS.includes(view.key) && hasPermissions("EditObject", "DeleteObject");
  if (!eligible) return null;

  return (
    <>
      <Button variant="default" size="xs" onClick={() => setOpened(true)}>
        {t("Merge")}
      </Button>
      <MergeDialog
        opened={opened}
        onClose={() => setOpened(false)}
        view={view}
        handles={handles}
        onMerged={() => setOpened(false)}
      />
    </>
  );
}
