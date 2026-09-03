import { useEffect, useState } from "react";
import { Alert, Button, Group, Loader, Modal, Radio, Stack, Text } from "@mantine/core";
import { getToken } from "../../auth/auth";
import { getViewStore } from "../../store/registry";
import { fetchPlainObject } from "../../store/objectsApi";
import { mergeObjects, mergeTags, mergeMessageFor } from "../../store/mergeApi";
import { PERSON_VIEW } from "../../store/views";
import type { ViewConfig } from "../../store/views";
import { summaryLine } from "./summary";
import { t } from "../../i18n/i18n";

/** One role (father or mother) where the two families being merged
 * disagree -- relative to `handles[0]`/`handles[1]` (not phoenix/titanic:
 * computed once when both objects load, before a survivor is even picked,
 * so flipping the survivor radio never needs a re-fetch). */
interface ParentConflict {
  role: "father" | "mother";
  handle0: string | null;
  handle1: string | null;
  label0: string;
  label1: string;
}

async function personLabel(token: string, handle: string | null): Promise<string> {
  if (handle === null) return t("(none)");
  return summaryLine("person", await fetchPlainObject(token, PERSON_VIEW, handle));
}

/** Only meaningful for Family -- Family.merge()'s own docstring says the
 * survivor's father/mother always wins, the other family's is simply lost,
 * unless the caller opts in per-role via phoenix_father_handle/
 * phoenix_mother_handle (merge.py's FamilyMergeArgs). Symmetric in
 * handle0/handle1 on purpose (see ParentConflict) -- which one ends up
 * "phoenix" is decided later, by the survivor radio, and doesn't change
 * what the two families actually disagree on. */
async function diffParents(
  token: string,
  obj0: Record<string, unknown>,
  obj1: Record<string, unknown>
): Promise<ParentConflict[]> {
  const roles: { role: "father" | "mother"; key: "father_handle" | "mother_handle" }[] = [
    { role: "father", key: "father_handle" },
    { role: "mother", key: "mother_handle" },
  ];
  const conflicts: ParentConflict[] = [];
  for (const { role, key } of roles) {
    const handle0 = (obj0[key] as string | undefined) ?? null;
    const handle1 = (obj1[key] as string | undefined) ?? null;
    if (handle0 === handle1) continue;
    const [label0, label1] = await Promise.all([personLabel(token, handle0), personLabel(token, handle1)]);
    conflicts.push({ role, handle0, handle1, label0, label1 });
  }
  return conflicts;
}

/** Whichever side is the *only* valid outcome for this role, or null when
 * both sides are real (and different) people, a genuine choice.
 * MergeFamilyQuery treats "the survivor ends up with nobody in this role"
 * as an error, not a valid "drop it" outcome, whenever the *other* family
 * actually had someone there (mergefamilyquery.py's merge_person: a None
 * phoenix side paired with a non-None titanic side raises MergeError). So
 * when only one side has a real handle, that side isn't optional -- it's
 * forced, and not worth asking about (there's nothing to pick). */
function forcedSide(c: ParentConflict): "handle0" | "handle1" | null {
  if (c.handle0 === null) return "handle1";
  if (c.handle1 === null) return "handle0";
  return null;
}

/** The "which one survives?" picker for MergeButton.tsx -- a standalone
 * Modal (not part of the edit-dialog Modal.Stack: opened from a DataTable
 * selection, not from inside a draft) mirroring gramps-web's own merge
 * dialog (GrampsjsViewObjectsBase.js's _renderMergeDialog/_handleMerge):
 * pick which of the two selected records is "phoenix" (kept, edited with
 * the merged data) vs. "titanic" (deleted). A Radio.Group, not two
 * immediately-acting buttons -- selecting a survivor is just a selection,
 * with a single "Merge" button at the bottom to actually commit, same as
 * everything else in the dialog.
 *
 * The message above the radios is per-type (mergeMessageFor) -- every
 * mergeable type in Gramps only unions its list-shaped fields (notes/
 * citations/attributes/media/tags); its own defining content always comes
 * from whichever record survives, and *which* fields that covers varies a
 * lot by type. The two radio labels (summaryLine) already surface that
 * content side by side for every type, which is what lets a generic
 * "these differ" panel be skipped entirely here -- reading the two labels
 * already shows what's being kept vs. discarded.
 *
 * Family is the one type with an actual API to act on a disagreement
 * (phoenix_father_handle/phoenix_mother_handle): `diffParents` computes
 * that once, up front (handle0/handle1-relative, not phoenix-relative), so
 * flipping the survivor radio just re-derives which side is "phoenix's own"
 * from already-fetched labels -- no re-fetch. A role where only one family
 * has anyone at all isn't offered as a choice (see forcedSide) -- the
 * outcome there is forced, not optional, so the app just sends the right
 * override silently rather than asking a question with only one non-broken
 * answer.
 *
 * Tag has no merge route in gramps-web-api at all -- gramps has never had a
 * server-side Tag merge. mergeTags() (mergeApi.ts) implements the same
 * "repoint every reference, then delete the loser" idea entirely
 * client-side via the loser's own backlinks, so it's offered here too, just
 * routed to a different call at the bottom.
 *
 * NOT the same thing as related/CompareModal.tsx (an unrelated before/after
 * image slider for Media's "Comparisons" section) -- named differently on
 * purpose to avoid confusion with that existing feature. */
export function MergeDialog({
  opened, onClose, view, handles, onMerged,
}: {
  opened: boolean;
  onClose: () => void;
  view: ViewConfig;
  handles: [string, string];
  onMerged: () => void;
}) {
  const [objs, setObjs] = useState<[Record<string, unknown>, Record<string, unknown>] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [phoenix, setPhoenix] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ParentConflict[]>([]);
  const [roleOverride, setRoleOverride] = useState<Partial<Record<"father" | "mother", "handle0" | "handle1">>>({});
  const [loadingConflicts, setLoadingConflicts] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setObjs(null);
    setError(null);
    setPhoenix(null);
    setConflicts([]);
    setRoleOverride({});
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const fetched = await Promise.all(handles.map((h) => fetchPlainObject(token, view, h)));
        if (!cancelled) setObjs(fetched as [Record<string, unknown>, Record<string, unknown>]);
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opened, view, handles[0], handles[1]]);

  // Family-only, and independent of `phoenix` -- see diffParents' own doc
  // comment on why this is safe to compute once rather than per survivor
  // pick.
  useEffect(() => {
    if (!objs || view.key !== "family") {
      setConflicts([]);
      return;
    }
    let cancelled = false;
    setLoadingConflicts(true);
    (async () => {
      try {
        const token = await getToken();
        const result = await diffParents(token, objs[0], objs[1]);
        if (!cancelled) setConflicts(result);
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? String(err));
      } finally {
        if (!cancelled) setLoadingConflicts(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objs, view.key]);

  function effectiveChoice(c: ParentConflict): "handle0" | "handle1" {
    return forcedSide(c) ?? roleOverride[c.role] ?? "handle0";
  }

  async function handleMergeClick() {
    if (phoenix === null) return;
    const titanic = phoenix === handles[0] ? handles[1] : handles[0];
    setMerging(true);
    setError(null);
    try {
      const token = await getToken();
      if (view.key === "tag") {
        await mergeTags(token, phoenix, titanic);
      } else {
        const args: Record<string, unknown> = {};
        for (const c of conflicts) {
          const chosen = effectiveChoice(c);
          const chosenHandle = chosen === "handle0" ? c.handle0 : c.handle1;
          const phoenixOwnHandle = phoenix === handles[0] ? c.handle0 : c.handle1;
          if (chosenHandle !== phoenixOwnHandle) {
            args[c.role === "father" ? "phoenix_father_handle" : "phoenix_mother_handle"] = chosenHandle;
          }
        }
        await mergeObjects(token, view, phoenix, titanic, Object.keys(args).length ? args : undefined);
      }
      getViewStore(view.key).requeryDebounced();
      getViewStore(view.key).clearSelection();
      onMerged();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setMerging(false);
    }
  }

  const labels = objs ? ([summaryLine(view.key, objs[0]), summaryLine(view.key, objs[1])] as const) : null;
  const pickableConflicts = conflicts.filter((c) => forcedSide(c) === null);

  return (
    <Modal opened={opened} onClose={onClose} title={t("Merge")}>
      <Stack gap="md">
        {error && (
          <Alert color="red" title={t("Could not merge")}>
            {error}
          </Alert>
        )}
        {labels === null ? (
          <Group justify="center" p="md">
            <Loader size="sm" />
          </Group>
        ) : (
          <Radio.Group value={phoenix ?? ""} onChange={setPhoenix} label={t(mergeMessageFor(view.key))}>
            <Stack gap={4} mt="xs">
              <Radio value={handles[0]} label={labels[0]} />
              <Radio value={handles[1]} label={labels[1]} />
            </Stack>
          </Radio.Group>
        )}
        {loadingConflicts && (
          <Group justify="center">
            <Loader size="xs" />
          </Group>
        )}
        {pickableConflicts.length > 0 && (
          <Stack gap="sm">
            <Text size="sm">
              {t("These two families have different parents. Choose which one to keep for each.")}
            </Text>
            <Text size="xs" c="dimmed">
              {t("The one not kept here is merged into the one that is -- not just unlinked.")}
            </Text>
            {pickableConflicts.map((c) => (
              <Radio.Group
                key={c.role}
                value={effectiveChoice(c)}
                onChange={(v) => setRoleOverride({ ...roleOverride, [c.role]: v as "handle0" | "handle1" })}
                label={c.role === "father" ? t("Father") : t("Mother")}
              >
                <Group gap="md" mt={4}>
                  <Radio value="handle0" label={c.label0} />
                  <Radio value="handle1" label={c.label1} />
                </Group>
              </Radio.Group>
            ))}
          </Stack>
        )}
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose} disabled={merging}>
            {t("Cancel")}
          </Button>
          <Button loading={merging} disabled={phoenix === null || loadingConflicts} onClick={handleMergeClick}>
            {t("Merge")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
