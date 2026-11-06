// Stacking order shared by every free-floating window (components/
// FloatingWindow.tsx): Gramplet windows and the External Search window.
// One list, so clicking any of them brings it above all the others, not
// just above its own kind. Ids are namespaced by their owner
// ("gramplet:<id>", "external-search"). Plain module state plus a listener
// set, like bottomDock.ts.

/** Below ordinary modals (Mantine's default zIndex 200), so an edit dialog
 * or the confirm dialog opened while a floating window is up still lands on
 * top of it, and above the page itself. Each window gets its own value from
 * here up, by stacking order. */
export const WINDOW_BASE_Z_INDEX = 150;

/** Bottom-most first -- the last one is drawn on top. */
let stack: string[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Puts `id` on top (adding it if new). A no-op if it's already on top. */
export function raiseWindow(id: string): void {
  if (stack[stack.length - 1] === id) return;
  stack = [...stack.filter((s) => s !== id), id];
  notify();
}

export function removeWindow(id: string): void {
  const next = stack.filter((s) => s !== id);
  if (next.length === stack.length) return;
  stack = next;
  notify();
}

export function getWindowStack(): string[] {
  return stack;
}

export function subscribeWindowStack(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `id`'s z-index for a `getWindowStack()` snapshot. */
export function windowZIndex(windowStack: string[], id: string): number {
  return WINDOW_BASE_Z_INDEX + Math.max(0, windowStack.indexOf(id));
}
