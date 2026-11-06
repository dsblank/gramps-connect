import { openExternalSearchWindow } from "../../store/externalSearchWindow";
import type { ObjectDetail } from "../../store/objectDetail";
import { t } from "../../i18n/i18n";
import { ViewButton } from "./ViewButton";

/** "External Search" on a person's RelatedPanel, in VisualButtons' row
 * beside Map/Timeline/Graphs: opens (or switches to this person) the
 * floating External Search window, ExternalSearchWindow.tsx. An onClick
 * ViewButton rather than one of VisualButtons' own route links, since it
 * opens a window here instead of another view of this app. */
export function ExternalSearchButton({ detail }: { detail: ObjectDetail }) {
  return (
    <ViewButton
      label={t("External Search")}
      hint={t("Search external services for matching records.")}
      onClick={() => openExternalSearchWindow(detail)}
    />
  );
}
