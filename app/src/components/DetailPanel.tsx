import { useMemo } from "react";
import { Stack, Text, Title } from "@mantine/core";
import { useViewStore } from "../hooks/useViewStore";
import { getViewStore } from "../store/registry";
import type { ViewConfig } from "../store/views";
import { PersonDetail } from "./PersonDetail";

interface DetailPanelProps {
  view: ViewConfig;
}

/** Right-hand panel for the row DataTable's selection points at (see
 * ViewStore.select()). Person gets a rich, server-fetched layout (see
 * PersonDetail.tsx); every other object type falls back to a plain
 * key/value list of the columns already cached locally -- a fuller
 * per-type layout is future scope, same phased treatment the rest of this
 * app's UI has had. */
export function DetailPanel({ view }: DetailPanelProps) {
  const snapshot = useViewStore(view.key);
  const store = getViewStore(view.key);

  const row = useMemo(() => {
    if (snapshot.selectedIndex === null) return null;
    return store.getRows(snapshot.selectedIndex, 1)[0] ?? null;
  }, [store, snapshot.selectedIndex, snapshot.revision]);

  if (snapshot.selectedIndex === null || snapshot.selectedHandle === null || !row) {
    return (
      <Stack p="md">
        <Text c="dimmed" size="md">Select a row to see its details.</Text>
      </Stack>
    );
  }

  if (view.key === "person") {
    return <PersonDetail handle={snapshot.selectedHandle} revision={snapshot.revision} />;
  }

  return (
    <Stack p="md" gap="sm">
      <Title order={4}>{view.label}</Title>
      <Stack gap="sm">
        {view.columns.map((col, i) => (
          <div key={col.key}>
            <Text size="sm" c="dimmed">{col.label}</Text>
            <Text size="md">{col.toDisplay ? col.toDisplay(row[i]) : row[i] == null ? "" : String(row[i])}</Text>
          </div>
        ))}
      </Stack>
    </Stack>
  );
}
