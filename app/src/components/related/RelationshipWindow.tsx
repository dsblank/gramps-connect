// The Relationship window: how two people are related -- the sentence and
// the chart (RelationshipBetween.tsx, chart always open) -- in a floating
// window rather than a dialog, so it can stay up beside other records, and
// across navigation, while you research the people on it. Mounted once in
// App.tsx next to ExternalSearchWindow; opened by the "Home person's ..."
// line on a person and by Relationship for two selected people
// (store/relationshipWindow.ts). It stays on the pair it was opened for.
import { useSyncExternalStore } from "react";
import { t } from "../../i18n/i18n";
import { usePeople } from "../../pyodidePoc/RelationshipChart";
import { DOCK_MARGIN, dockOffsets, getDock, subscribeDock } from "../../store/bottomDock";
import {
  closeRelationshipWindow,
  getRelationshipWindow,
  raiseRelationshipWindow,
  RELATIONSHIP_CHIP_WIDTH,
  RELATIONSHIP_WINDOW_ID,
  setRelationshipWindowMinimized,
  subscribeRelationshipWindow,
  type RelationshipWindowState,
} from "../../store/relationshipWindow";
import { STORAGE_KEYS } from "../../store/storageKeys";
import { getWindowStack, subscribeWindowStack, windowZIndex } from "../../store/windowStack";
import { FloatingWindow } from "../FloatingWindow";
import { RelationshipBetween } from "./RelationshipBetween";

export function RelationshipWindow() {
  const win = useSyncExternalStore(subscribeRelationshipWindow, getRelationshipWindow);
  if (!win) return null;
  return <OpenRelationshipWindow win={win} />;
}

function OpenRelationshipWindow({ win }: { win: RelationshipWindowState }) {
  const stack = useSyncExternalStore(subscribeWindowStack, getWindowStack);
  const offsets = dockOffsets(useSyncExternalStore(subscribeDock, getDock));
  const people = usePeople([win.from, win.to]);
  const names = [people.get(win.from)?.name, people.get(win.to)?.name];
  return (
    <FloatingWindow
      storageKey={STORAGE_KEYS.relationshipWindowGeometry}
      title={names[0] && names[1] ? `${t("Relationship")}: ${names[0]} → ${names[1]}` : t("Relationship")}
      zIndex={windowZIndex(stack, RELATIONSHIP_WINDOW_ID)}
      minimized={win.minimized}
      chipRight={offsets.get(RELATIONSHIP_WINDOW_ID) ?? DOCK_MARGIN}
      chipWidth={RELATIONSHIP_CHIP_WIDTH}
      defaultWidth={640}
      defaultHeight={520}
      onFocus={raiseRelationshipWindow}
      onMinimize={setRelationshipWindowMinimized}
      onClose={closeRelationshipWindow}
    >
      <RelationshipBetween from={win.from} to={win.to} revision={0} chart="always" />
    </FloatingWindow>
  );
}
