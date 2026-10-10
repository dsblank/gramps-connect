import { useSyncExternalStore } from "react";
import { FloatingTopicWindow } from "./FloatingTopicWindow";
import { DOCK_MARGIN, dockOffsets, getDock, subscribeDock } from "../store/bottomDock";
import { getTopicWindows, subscribeTopicWindows, topicDockId } from "../store/topicWindows";

/** Mounted once, outside AppShell (see App.tsx) -- every open Topic chat as
 * a Messenger-style chat head anchored to the bottom-right of the
 * viewport. Just a thin loop handing each FloatingTopicWindow its own
 * `rightOffset` (see that component's own doc comment for why each card is
 * independently `position: fixed` rather than a child in a shared flex
 * row), read from the bottom dock (store/bottomDock.ts) it shares with
 * minimized Gramplet windows, so the two never overlap -- newest-docked
 * closest to the corner. No wrapping onto a second row here: with
 * `windows` capped at topicWindows.ts's own MAX_OPEN_WINDOWS (5), five
 * fixed 320px-wide slots plus margins/gaps comfortably fits inside any
 * realistic viewport width, so a window running off the left edge of the
 * screen shouldn't happen in practice any more (it did before the cap
 * existed, with no way back short of closing newer ones in front of it). */
export function FloatingTopicWindows() {
  const windows = useSyncExternalStore(subscribeTopicWindows, getTopicWindows);
  const offsets = dockOffsets(useSyncExternalStore(subscribeDock, getDock));
  if (windows.length === 0) return null;

  return (
    <>
      {windows.map((w) => (
        <FloatingTopicWindow
          key={w.handle}
          handle={w.handle}
          minimized={w.minimized}
          rightOffset={offsets.get(topicDockId(w.handle)) ?? DOCK_MARGIN}
        />
      ))}
    </>
  );
}
