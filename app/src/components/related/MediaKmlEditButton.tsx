import { lazy, Suspense, useState } from "react";
import { Box, Loader, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { hasPermissions } from "../../auth/auth";
import type { ObjectDetail } from "../../store/objectDetail";
import { KML_MIME } from "../../store/visualData";
import { t } from "../../i18n/i18n";

// maplibre-gl and terra-draw are the heaviest thing this app can pull in
// (see MapItemEditorDialog.tsx's own doc comment) -- lazy so a session that
// never opens this editor never fetches either, same reasoning as
// MapView.tsx's own lazy MapCanvas import.
const MapItemEditorDialog = lazy(() =>
  import("../MapItemEditorDialog").then((m) => ({ default: m.MapItemEditorDialog })));

/** A KML media object's own "edit its shapes" action -- same header slot as
 * EditButton.tsx's ✎ (which excludes Media, see its own doc comment: a
 * generic Media has no form to edit, only an uploaded file), but for the
 * one Media type this app *can* meaningfully edit in place: its own drawn
 * points/lines/polygons, via MapItemEditorDialog.tsx's terra-draw canvas
 * re-opened on this object's existing shapes. Non-KML media still has
 * nothing here to edit, so this renders nothing for any other mime. */
export function MediaKmlEditButton({ detail, onSaved }: { detail: ObjectDetail; onSaved: () => void }) {
  const [opened, setOpened] = useState(false);
  if (detail.mime !== KML_MIME || !hasPermissions("EditObject")) return null;

  const label = t("Edit this map item's shapes");

  return (
    <>
      <Tooltip label={label} withArrow>
        <UnstyledButton onClick={() => setOpened(true)} aria-label={label}>
          <Text size="lg" lh={1}>✎</Text>
        </UnstyledButton>
      </Tooltip>
      {opened && (
        <Suspense
          fallback={
            <Box style={{ position: "fixed", inset: 0, zIndex: 300 }}>
              <Loader size="sm" style={{ position: "absolute", top: "50%", left: "50%" }} />
            </Box>
          }
        >
          <MapItemEditorDialog
            target={{ kind: "edit", handle: detail.handle }}
            onClose={() => setOpened(false)}
            onSaved={onSaved}
          />
        </Suspense>
      )}
    </>
  );
}
