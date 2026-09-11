import { useSyncExternalStore } from "react";
import { CARD_GAP, CARD_WIDTH, FloatingTopicWindow, VIEWPORT_MARGIN } from "./FloatingTopicWindow";
import { getTopicWindows, subscribeTopicWindows } from "../store/topicWindows";

/** Mounted once, outside AppShell (see App.tsx) -- every open Topic chat as
 * a Messenger-style chat head anchored to the bottom-right of the
 * viewport. Just a thin loop handing each FloatingTopicWindow its own
 * `rightOffset` (see that component's own doc comment for why each card is
 * independently `position: fixed` rather than a child in a shared flex
 * row) -- newest-opened first, so the most recently opened/reopened window
 * sits closest to the corner. No wrapping onto a second row here: with
 * `windows` capped at topicWindows.ts's own MAX_OPEN_WINDOWS (5), five
 * fixed 320px-wide slots plus margins/gaps comfortably fits inside any
 * realistic viewport width, so a window running off the left edge of the
 * screen shouldn't happen in practice any more (it did before the cap
 * existed, with no way back short of closing newer ones in front of it). */
export function FloatingTopicWindows() {
  const windows = useSyncExternalStore(subscribeTopicWindows, getTopicWindows);
  if (windows.length === 0) return null;

  return (
    <>
      {[...windows].reverse().map((w, i) => (
        <FloatingTopicWindow
          key={w.handle}
          handle={w.handle}
          minimized={w.minimized}
          rightOffset={VIEWPORT_MARGIN + i * (CARD_WIDTH + CARD_GAP)}
        />
      ))}
    </>
  );
}
