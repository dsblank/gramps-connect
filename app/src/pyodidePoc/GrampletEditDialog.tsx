// Creates or edits a "Gramplet"-tagged Media object's own JSON manifest
// (name/views/code) -- "Add Gramplet…" (MenuBar's Add menu) and an existing
// Gramplet's "Edit Gramplet" (MediaGrampletEditButton.tsx, the header
// action slot RelatedPanel.tsx already gives MediaKmlEditButton.tsx for
// the other Media type this app can meaningfully edit) both open this,
// mirroring MapItemEditorDialog.tsx's own new-vs-edit `target` shape.
// Self-contained GET-then-PUT for edit / POST for new, same shape
// RefEditDialog.tsx uses for a small, one-record edit that doesn't need
// the full stacked-draft flow EditButton.tsx's PersonEditDialog/etc. use.
// `id` is never shown/edited here -- purely an internal tab key (see
// types.ts), nothing a Gramplet author needs to think about. `addedViews`
// (which lists currently show this as a tab) isn't edited here either --
// that's PyodidePocPanel.tsx's own per-list (+)/(-) glyphs, not a
// whole-object-edit concern. Name is enforced unique across every other
// Gramplet on the tree (case-insensitive) -- the "+ Add Gramplet" menu
// identifies its options by name alone, so a duplicate would be
// indistinguishable there.
import { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Group, Loader, Modal, Select, Stack, Text, TextInput } from "@mantine/core";
import { getToken } from "../auth/auth";
import { InfoButton } from "../components/InfoButton";
import { fetchGramplets, fetchGrampletManifest, saveGrampletManifest, uploadGramplet } from "./grampletMedia";
import { GrampletHelpDialog } from "./GrampletHelpDialog";
import { GrampletResultView, type RunStatus } from "./GrampletResultView";
import { OBJECT_TYPES, OBJECT_TYPE_LABELS } from "./objectEndpoints";
import { t } from "../i18n/i18n";
import { PythonCodeEditor } from "./PythonCodeEditor";
import type { Gramplet, PyodideWorkerResponse } from "./types";

export type GrampletEditorTarget =
  | {
      kind: "new";
      /** Set by PyodidePocPanel.tsx's own "Create new Gramplet" trigger
       * (next to its "+ Add Gramplet" menu) -- defaults the new
       * Gramplet's `views` to just this one type instead of "All", and
       * pre-adds it to this same view's `addedViews`, so saving it
       * (Cancel aside) makes it show up as a tab right there without a
       * separate "+ Add Gramplet" step. MenuBar.tsx's generic "Add
       * Gramplet…" (no particular list in context) omits this. */
      defaultViewKey?: string;
    }
  | { kind: "edit"; handle: string };

type Status = "loading" | "ready" | "error";

// "Can be used on" is one specific type or every type -- not an arbitrary
// subset (an earlier version of this dialog had a checkbox group for
// that; simplified to a single Select per the user's own call: a
// Gramplet is realistically either general-purpose or built for one
// object type, never "these particular 4 of 10"). `views` itself is
// still stored as a plain string array (see types.ts) -- "all" is just
// OBJECT_TYPES spelled out in full, not a separate sentinel value on the
// wire, so PyodidePocPanel.tsx's `views.includes(viewKey)` checks don't
// need to know this UI simplification exists at all.
const ALL_VIEWS_OPTION = "all";

/** The Select's own value for whatever `views` currently is -- a single
 * type shows as itself; anything else (missing, all 10, or some other
 * combination a manifest might carry from before this was a single
 * Select) shows as "All", since that's the closest honest reading of
 * "not narrowed to one specific type". */
function viewSelectValue(views: string[] | undefined): string {
  if (views && views.length === 1) return views[0];
  return ALL_VIEWS_OPTION;
}

// people() (and where -- Gramps Object Query Language, see the (i) button
// above) plus row() -- the last 10 people changed, most recent first.
// row() takes person and when straight (no columns() call, no field
// picked out by hand): a primary object renders as a clickable link
// (ObjectCellButton.tsx) and a datetime renders as a formatted date
// (pyodideWorker.ts's _pp()/_format_stdlib_datetime()), and since every
// row agrees on each column's kind, the table heads them "Person"/"Date"
// on its own too (_cell_kind()).
const NEW_GRAMPLET_CODE = `import datetime

for person in people(order=[{"column": "change", "direction": "desc"}], limit=10):
    row(person, datetime.datetime.fromtimestamp(person.change))
`;

// With no `defaultViewKey` (MenuBar's generic "Add Gramplet…"): usable
// everywhere (`views`) but shown nowhere yet (`addedViews: []`) -- a
// list's own "+ Add Gramplet" is how it actually starts appearing as a
// tab, same deliberate-curation model item 0/3/4 this whole views/
// addedViews split exists for. With one (PyodidePocPanel's "Create new
// Gramplet"): scoped to just that type on both fields instead, so it's
// immediately usable and already showing as a tab back where it was
// created from.
function newGramplet(defaultViewKey?: string): Gramplet {
  const views = defaultViewKey ? [defaultViewKey] : OBJECT_TYPES;
  const addedViews = defaultViewKey ? [defaultViewKey] : [];
  return { id: crypto.randomUUID(), label: "New Gramplet", code: NEW_GRAMPLET_CODE, views, addedViews };
}

export function GrampletEditDialog({
  target,
  onClose,
  onSaved,
}: {
  target: GrampletEditorTarget;
  onClose: () => void;
  /** Fired after any successful save, new or edit -- unlike
   * MapItemEditorDialog.tsx's own onSaved (deliberately edit-only there,
   * since "Add Map Item…" has no particular list watching for a new
   * one), PyodidePocPanel.tsx's "Create new Gramplet" *does* have
   * somewhere to refresh: its own tab list. Passed the just-saved
   * Gramplet (its `id` at least -- `handle` is only set for the edit
   * case, or after a "new" upload if the caller wants to fetch it fresh)
   * so a caller can e.g. select it as the active tab. */
  onSaved?: (gramplet: Gramplet) => void;
}) {
  const [status, setStatus] = useState<Status>(target.kind === "new" ? "ready" : "loading");
  const [error, setError] = useState("");
  const [gramplet, setGramplet] = useState<Gramplet | null>(
    target.kind === "new" ? newGramplet(target.defaultViewKey) : null
  );
  const [saving, setSaving] = useState(false);
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [runResponse, setRunResponse] = useState<PyodideWorkerResponse | null>(null);
  // Every other Gramplet's own name -- the "+ Add Gramplet" menu
  // (PyodidePocPanel.tsx) identifies its options by `label` alone, so two
  // Gramplets sharing a name would be indistinguishable there. Best-effort
  // fetch (a failure here shouldn't block editing the one Gramplet this
  // dialog is actually for) rather than folded into the `status`/`error`
  // state that already covers the manifest fetch itself.
  const [otherNames, setOtherNames] = useState<{ handle?: string; label: string }[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  // The runId (see RunGrampletRequest in types.ts) of the most recent
  // handleExecute() call -- pyodideWorker.ts serializes execution but can't
  // cancel a still-running earlier Gramplet outright, so its messages can
  // still arrive after a newer Execute click; worker.onmessage below drops
  // anything whose runId doesn't match this.
  const activeRunIdRef = useRef("");

  useEffect(() => {
    fetchGramplets()
      .then((list) => setOtherNames(list.map((g) => ({ handle: g.handle, label: g.label }))))
      .catch((err) => console.error("[gramplets] failed to check for duplicate names", err));
  }, []);

  useEffect(() => {
    if (target.kind !== "edit") return;
    let cancelled = false;
    fetchGrampletManifest(target.handle)
      .then((manifest) => {
        if (cancelled) return;
        setGramplet(manifest);
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [target]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  function getWorker(): Worker {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL("./pyodideWorker.ts", import.meta.url), {
        type: "module",
      });
    }
    return workerRef.current;
  }

  // Runs whatever's currently in the code editor -- deliberately not
  // gated on Save first, so a Gramplet author can iterate (edit, execute,
  // edit again) without round-tripping through Media each time. `widgetEvent`
  // is set when this run was triggered by clicking an st.*-widget in the
  // preview below (GrampletResultView's onWidgetEvent prop / stBootstrap.ts's
  // st.button()) rather than the Execute button itself.
  async function handleExecute(widgetEvent?: { key: string; value: unknown }) {
    if (!gramplet) return;
    const runId = crypto.randomUUID();
    activeRunIdRef.current = runId;
    setRunStatus("loading");
    // Only for a genuine Execute click, not a widget rerun of the exact
    // same code -- GrampletResultView.tsx keeps rendering the *previous*
    // response's blocks through "loading" when one is available, so a
    // widget rerun updates in place (the clicked button/input stays on
    // screen) instead of flickering out to placeholder text and back. A
    // fresh Execute, though, may be running just-edited code that no
    // longer matches what's still on screen, so that one still clears it.
    if (!widgetEvent) setRunResponse(null);
    try {
      const token = await getToken();
      const worker = getWorker();
      worker.onmessage = (event: MessageEvent<PyodideWorkerResponse>) => {
        // Stale -- pyodideWorker.ts serializes execution but can't cancel a
        // still-running earlier Gramplet outright (see activeRunIdRef's own
        // doc comment above), so a message for a run superseded by a later
        // Execute click can still arrive; drop it rather than clobbering
        // what's now showing.
        if (event.data.runId !== activeRunIdRef.current) return;
        // "started" and "progress" aren't terminal (see PyodideWorkerResponse
        // in types.ts) -- "started" just confirms execution actually began
        // (nothing to show yet, runStatus already reads "loading" from
        // handleExecute() above), and "progress" is a fresher snapshot of
        // the same status. Status only moves to "done"/"error" on the one
        // message that actually ends the run, and only that one (plus
        // "progress") carries a response worth displaying.
        if (event.data.type === "started") return;
        if (event.data.type !== "progress") {
          setRunStatus(event.data.type === "error" ? "error" : "done");
        }
        setRunResponse(event.data);
      };
      worker.postMessage({
        type: "run-gramplet",
        code: gramplet.code,
        token,
        runId,
        grampletId: gramplet.id,
        ...(widgetEvent ? { widgetEvent } : {}),
      });
    } catch (err) {
      setRunStatus("error");
      setRunResponse({ type: "error", text: err instanceof Error ? err.message : String(err), blocks: [], runId });
    }
  }

  const selfHandle = target.kind === "edit" ? target.handle : undefined;
  const trimmedLabel = gramplet?.label.trim() ?? "";
  const isDuplicateName =
    trimmedLabel.length > 0 &&
    otherNames.some((other) => other.handle !== selfHandle && other.label.trim().toLowerCase() === trimmedLabel.toLowerCase());

  async function handleSave() {
    if (!gramplet || isDuplicateName) return;
    setSaving(true);
    setError("");
    try {
      // Narrowing `views` (e.g. from "All" down to one type) shouldn't
      // leave this added to a list it's no longer allowed on --
      // PyodidePocPanel.tsx's own tab filter only checks `addedViews`,
      // not `views`, so that inconsistency would otherwise silently
      // persist rather than showing up anywhere.
      const views = gramplet.views ?? OBJECT_TYPES;
      const toSave = { ...gramplet, views, addedViews: (gramplet.addedViews ?? OBJECT_TYPES).filter((v) => views.includes(v)) };
      if (target.kind === "new") {
        await uploadGramplet(toSave);
      } else {
        await saveGrampletManifest(target.handle, toSave);
      }
      onSaved?.(toSave);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal opened onClose={onClose} title={target.kind === "new" ? t("Add Gramplet") : t("Edit Gramplet")} size="90%">
      {status === "loading" && <Loader size="sm" />}
      {status === "error" && !gramplet && <Alert color="red">{error}</Alert>}
      {gramplet && (
        <Stack gap="sm">
          <TextInput
            label={t("Name")}
            value={gramplet.label}
            onChange={(e) => setGramplet({ ...gramplet, label: e.currentTarget.value })}
            error={isDuplicateName ? t("Another Gramplet already has this name") : undefined}
          />
          <Select
            label={t("View")}
            data={[
              { value: ALL_VIEWS_OPTION, label: t("All") },
              ...OBJECT_TYPES.map((type) => ({ value: type, label: t(OBJECT_TYPE_LABELS[type]) })),
            ]}
            value={viewSelectValue(gramplet.views)}
            onChange={(value) => {
              if (!value) return;
              setGramplet({ ...gramplet, views: value === ALL_VIEWS_OPTION ? OBJECT_TYPES : [value] });
            }}
            allowDeselect={false}
          />
          <Group gap="xs">
            <Text size="sm" fw={500}>
              {t("Code")}
            </Text>
            <InfoButton label={t("How to write a Gramplet")} onClick={() => setHelpOpen(true)} />
          </Group>
          <PythonCodeEditor
            value={gramplet.code}
            onChange={(code) => setGramplet({ ...gramplet, code })}
            minHeight={320}
          />
          <Group justify="center">
            <Button size="xs" color="green" onClick={() => handleExecute()} loading={runStatus === "loading"}>
              {t("Execute")}
            </Button>
          </Group>
          <Box>
            <Text size="sm" fw={500} mb={4}>
              {t("Result")}
            </Text>
            <Box
              p="sm"
              style={{
                minHeight: 100,
                border: "1px solid var(--mantine-color-default-border)",
                borderRadius: "var(--mantine-radius-sm)",
              }}
            >
              <GrampletResultView
                status={runStatus}
                response={runResponse}
                interactive={false}
                onWidgetEvent={(key, value) => handleExecute({ key, value })}
              />
            </Box>
          </Box>
          {error && <Alert color="red">{error}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button onClick={handleSave} loading={saving} disabled={isDuplicateName}>
              {t("Save")}
            </Button>
          </Group>
        </Stack>
      )}
      <GrampletHelpDialog opened={helpOpen} onClose={() => setHelpOpen(false)} />
    </Modal>
  );
}
