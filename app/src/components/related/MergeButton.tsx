import { useState } from "react";
import { Button } from "@mantine/core";
import { hasPermissions } from "../../auth/auth";
import { isMergeable } from "../../store/mergeApi";
import type { ViewConfig } from "../../store/views";
import { MergeDialog } from "./MergeDialog";
import { t } from "../../i18n/i18n";

/** The shared header button SelectionDetailView.tsx shows in place of every
 * per-object Edit/Delete/Message when exactly two rows of a mergeable type
 * are selected. Gated the same way the backend's merge routes are
 * (require_permissions([PERM_EDIT_OBJ, PERM_DEL_OBJ]) --
 * gramps_webapi/api/resources/merge.py -- "one object survives edited, the
 * other is deleted"), plus isMergeable() since not every type has a merge
 * route (or, for Tag, this app's own client-orchestrated equivalent --
 * mergeApi.ts's mergeTags()) at all. Renders nothing when ineligible --
 * SelectionDetailView then shows no action row for that pair, matching the
 * 2-selected spec ("Merge-or-nothing", no Edit/Delete/Message fallback). */
export function MergeButton({ view, handles }: { view: ViewConfig; handles: [string, string] }) {
  const [opened, setOpened] = useState(false);
  const eligible = isMergeable(view.key) && hasPermissions("EditObject", "DeleteObject");
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
