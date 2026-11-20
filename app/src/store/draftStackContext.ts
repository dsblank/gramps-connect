// The app's one draft stack (App.tsx's useDraftStack()), for components
// deep in the Related Pane whose "+" can create a record (AttachControl.tsx)
// without threading it through every section's props. Null outside App
// (tests, standalone renders): those "+" controls then only pick existing
// records.
import { createContext, useContext } from "react";
import type { UseDraftStack } from "./draftStack";

export const DraftStackContext = createContext<UseDraftStack | null>(null);

export function useDraftStackContext(): UseDraftStack | null {
  return useContext(DraftStackContext);
}
