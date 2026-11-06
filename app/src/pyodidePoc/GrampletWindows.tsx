import { useEffect, useSyncExternalStore } from "react";
import { DOCK_MARGIN, dockOffsets, getDock, subscribeDock } from "../store/bottomDock";
import { GrampletWindow } from "./GrampletWindow";
import {
  getGrampletWindows, grampletDockId, isAnyGrampletRunning, subscribeGrampletWindows,
} from "../store/grampletWindows";
import { getWindowStack, subscribeWindowStack, windowZIndex } from "../store/windowStack";

/** Mounted once, outside AppShell (see App.tsx, next to
 * FloatingTopicWindows) -- every open (window) Gramplet, so they survive
 * navigating between views. */
export function GrampletWindows() {
  const windows = useSyncExternalStore(subscribeGrampletWindows, getGrampletWindows);
  const stack = useSyncExternalStore(subscribeWindowStack, getWindowStack);
  const offsets = dockOffsets(useSyncExternalStore(subscribeDock, getDock));

  // Leaving or reloading the page kills every run in progress -- the
  // browser asks first. (Browsers show their own generic wording; the
  // message itself can't be customized.)
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!isAnyGrampletRunning()) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  return (
    <>
      {windows.map((entry, i) => (
        <GrampletWindow
          key={`${entry.gramplet.id}:${entry.generation}`}
          entry={entry}
          zIndex={windowZIndex(stack, grampletDockId(entry.gramplet.id))}
          chipRight={offsets.get(grampletDockId(entry.gramplet.id)) ?? DOCK_MARGIN}
          cascadeIndex={i}
        />
      ))}
    </>
  );
}
