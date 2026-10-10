import { useEffect, useSyncExternalStore } from "react";
import { DOCK_MARGIN, dockOffsets, getDock, subscribeDock } from "../store/bottomDock";
import { GrampletWindow } from "./GrampletWindow";
import {
  getGrampletWindowZOrder, getGrampletWindows, grampletDockId, isAnyGrampletRunning, subscribeGrampletWindows,
} from "../store/grampletWindows";

/** Below ordinary modals (Mantine's default zIndex 200), so an edit dialog
 * or the confirm dialog opened while a Gramplet window is up still lands on
 * top of it, and above the page itself. Each window gets its own value from
 * here up, by stacking order. */
const BASE_Z_INDEX = 150;

/** Mounted once, outside AppShell (see App.tsx, next to
 * FloatingTopicWindows) -- every open (window) Gramplet, so they survive
 * navigating between views. */
export function GrampletWindows() {
  const windows = useSyncExternalStore(subscribeGrampletWindows, getGrampletWindows);
  const zOrder = useSyncExternalStore(subscribeGrampletWindows, getGrampletWindowZOrder);
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
          zIndex={BASE_Z_INDEX + Math.max(0, zOrder.indexOf(entry.gramplet.id))}
          chipRight={offsets.get(grampletDockId(entry.gramplet.id)) ?? DOCK_MARGIN}
          cascadeIndex={i}
        />
      ))}
    </>
  );
}
