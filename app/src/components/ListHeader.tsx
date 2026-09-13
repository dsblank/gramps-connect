import { Group, Title } from "@mantine/core";
import type { ViewConfig } from "../store/views";
import { t } from "../i18n/i18n";

/** Row above FilterBar's search box, spanning just the list panel (App.tsx
 * mounts this inside the same Box as FilterBar/DataTable, not the aside) --
 * just the view's plural label (e.g. "People", "Places"). The per-type
 * "Add a Person"/"Start a discussion" action used to live here too; it now
 * lives beside RelatedPanel's own Edit/Delete/etc row instead (see
 * related/AddButton.tsx's own doc comment for why). */
export function ListHeader({ view }: { view: ViewConfig }) {
  return (
    <Group justify="space-between" mb="sm" wrap="nowrap">
      <Title order={4}>{t(view.label)}</Title>
    </Group>
  );
}
