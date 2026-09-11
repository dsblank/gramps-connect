// Promise-based replacement for window.confirm, backed by a single
// app-wide Mantine Modal (ConfirmDialogHost.tsx) -- same module-state-plus-
// listener-set shape as topicWindows.ts, rather than a context provider,
// since every call site here is a plain function (a section's handleRemove,
// not a component) that just wants to await a yes/no answer.
//
// This is deliberately lighter than DeleteButton.tsx's own confirm Modal
// (title, cascade-delete copy, disabled orphan-cleanup checkbox, inline
// error state): that one is the single "delete this record" action per
// panel and owns real failure state of its own (the delete call can
// itself fail). Everything routed through confirmDialog() is a plain
// "remove this reference / delete this item" yes-or-no, so one shared
// instance is enough -- only one can ever be open at a time (nothing here
// is triggered from more than one place at once), so a second call while
// one is already pending would just replace it rather than queueing.
export interface ConfirmRequest {
  message: string;
  confirmLabel?: string;
  resolve: (ok: boolean) => void;
}

let pending: ConfirmRequest | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeConfirmDialog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getConfirmDialogRequest(): ConfirmRequest | null {
  return pending;
}

/** Shows the shared confirm modal with `message` and resolves once it's
 * answered -- `true` for the confirm button, `false` for Cancel or closing
 * the modal any other way (Escape, backdrop click). `confirmLabel` defaults
 * to "Remove" in ConfirmDialogHost (the common case: every RelatedPanel
 * section's unlink action); pass "Delete" at the few call sites that
 * actually delete the record rather than just unlinking a reference. */
export function confirmDialog(message: string, confirmLabel?: string): Promise<boolean> {
  return new Promise((resolve) => {
    pending = { message, confirmLabel, resolve };
    notify();
  });
}

export function resolveConfirmDialog(ok: boolean): void {
  pending?.resolve(ok);
  pending = null;
  notify();
}
