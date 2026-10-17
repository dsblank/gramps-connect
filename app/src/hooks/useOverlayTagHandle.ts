import { useEffect, useState } from "react";
import { findOverlayTagHandle } from "../store/mapOverlays";

/** The map overlay tag's handle (mapOverlays.ts), for telling overlays
 * apart in a record's media list: `undefined` while it's being looked up,
 * `null` if no overlay has been made yet. */
export function useOverlayTagHandle(): string | null | undefined {
  const [handle, setHandle] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void findOverlayTagHandle().then((found) => {
      if (!cancelled) setHandle(found);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return handle;
}
