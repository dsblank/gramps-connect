import { useSyncExternalStore } from "react";
import { CARD_GAP, CARD_WIDTH, FloatingTopicWindow, VIEWPORT_MARGIN } from "./FloatingTopicWindow";
import { getTopicWindows, subscribeTopicWindows } from "../store/topicWindows";

/** Mounted once, outside AppShell (see App.tsx) -- every open Topic chat as
 * a Messenger-style chat head anchored to the bottom-right of the
 * viewport. Just a thin loop handing each FloatingTopicWindow its own
 * `rightOffset` (see that component's own doc comment for why each card is
 * independently `position: fixed` rather than a child in a shared flex
 * row) -- newest-opened first, so the most recently opened/reopened window
 * sits closest to the corner. Windows past the right edge of the screen
 * are simply left off-canvas for now rather than wrapped onto a second
 * row or capped -- acceptable for the handful anyone would realistically
 * have open at once; worth revisiting once there's real usage data on how
 * many that actually is. */
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
