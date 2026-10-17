import { useState } from "react";
import { Anchor, Button } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { hasPermissions } from "../../auth/auth";
import { formatHash } from "../../hash";
import type { ObjectDetail } from "../../store/objectDetail";
import { isMapFileMime } from "../../store/mapFileMime";
import { isOverlay, makeOverlayForMediaDetail } from "../../store/mapOverlays";
import { useOverlayTagHandle } from "../../hooks/useOverlayTagHandle";
import { t } from "../../i18n/i18n";

/** A map file's (KML/GPX/GeoJSON someone uploaded, or attached from Gramps
 * desktop) own "make an overlay from this" action -- the file itself is
 * never edited or converted (mapOverlays.ts); the new overlay goes on every
 * place this file is attached to. Hidden on an overlay, which is edited
 * directly instead (MediaKmlEditButton.tsx). */
export function MakeOverlayButton({ detail, onSaved }: { detail: ObjectDetail; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const overlayTag = useOverlayTagHandle();
  if (overlayTag === undefined || !isMapFileMime(detail.mime) || isOverlay(detail, overlayTag)) return null;
  if (!hasPermissions("AddObject", "EditObject")) return null;

  async function handleClick() {
    setBusy(true);
    try {
      const handle = await makeOverlayForMediaDetail(detail.handle);
      if (!handle) {
        notifications.show({ color: "yellow", title: t("Nothing to draw"), message: t("No shapes were found in this file.") });
        return;
      }
      notifications.show({
        color: "green",
        title: t("Map overlay made"),
        message: (
          <Anchor component="a" href={formatHash({ viewKey: "media", handle })} underline="never">
            {t("Open it")}
          </Anchor>
        ),
      });
      onSaved();
    } catch (err: any) {
      notifications.show({ color: "red", title: t("Couldn't make a map overlay"), message: err.message ?? String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="default" size="xs" onClick={handleClick} loading={busy}>
      {t("Make map overlay")}
    </Button>
  );
}
