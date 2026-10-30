import { useRef, useState } from "react";
import { Alert, Button, Group, Modal, Progress, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { getToken, hasPermissions } from "../../auth/auth";
import { getViewStore } from "../../store/registry";
import { attachRefListEntry } from "../../store/refListApi";
import { getOrCreateTagHandle } from "../../store/jobsApi";
import { TAG_VIEW } from "../../store/views";
import type { ViewConfig } from "../../store/views";
import type { QueryItem } from "../../store/api";
import { RecordPicker } from "../RecordPicker";
import { pickerResultLabel } from "../RefPickerField";
import { t } from "../../i18n/i18n";

/** SelectionBulkView.tsx's header action for 3+ selected rows (and
 * SelectionDetailView.tsx's for exactly 2) -- opens the same TAG_VIEW-scoped
 * RecordPicker AttachControl.tsx already uses for its single-object tag
 * picker (RecordPicker itself is reused as-is, not rebuilt), then loops
 * attachRefListEntry over every selected handle instead of just one.
 * `onCreateNew` opts into RecordPicker's "not finding it? create new"
 * bridge -- unlike RefPickerField.tsx's own use of that bridge (which opens
 * a full blank edit dialog for heavier types), a Tag is simple enough
 * (jobsApi.ts's getOrCreateTagHandle: get-or-create by exact name, no
 * dialog) that typing a name that doesn't already exist and applying it in
 * one step reads as "select or create", not two separate flows. */
/** Records tagged at once. Tagging is one read-and-update per record (no
 * bulk endpoint), so a Ctrl/Cmd+A selection of thousands goes through a few
 * at a time -- which is also what lets Cancel stop it partway. apiFetch
 * still caps and paces the actual requests. */
const TAG_CONCURRENCY = 4;
/** Past this many records, show "Tagged 300 of 4,900" and a Cancel button. */
const TAG_PROGRESS_FROM = 50;

export function BulkTagButton({ view, handles }: { view: ViewConfig; handles: string[] }) {
  const [opened, setOpened] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tagged, setTagged] = useState(0);
  const cancelled = useRef(false);

  if (!hasPermissions("EditObject")) return null;

  async function applyTag(tagHandle: string) {
    setApplying(true);
    setError(null);
    setTagged(0);
    cancelled.current = false;
    let done = 0;
    let next = 0;
    async function worker() {
      while (next < handles.length && !cancelled.current) {
        const handle = handles[next++];
        await attachRefListEntry(await getToken(), view, handle, "tag_list", tagHandle);
        done += 1;
        setTagged(done);
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(TAG_CONCURRENCY, handles.length) }, worker));
      if (cancelled.current) {
        notifications.show({
          message: t("Tagged %s of %s, then stopped.").replace("%s", done.toLocaleString()).replace("%s", handles.length.toLocaleString()),
        });
      }
      setOpened(false);
    } catch (err: any) {
      // Tagging is additive and per record: whatever got tagged stays
      // tagged, so just say how far it got.
      const message = err.message ?? String(err);
      setError(done > 0 ? t("Tagged %s before an error: %s").replace("%s", done.toLocaleString()).replace("%s", message) : message);
    } finally {
      getViewStore(view.key).requeryDebounced();
      setApplying(false);
    }
  }

  async function handlePick(item: QueryItem) {
    await applyTag(item.handle);
  }

  async function handleCreateNew(name: string) {
    if (!name) return;
    setApplying(true);
    setError(null);
    try {
      const token = await getToken();
      const tagHandle = await getOrCreateTagHandle(token, name);
      await applyTag(tagHandle);
    } catch (err: any) {
      setError(err.message ?? String(err));
      setApplying(false);
    }
  }

  return (
    <>
      <Button variant="default" size="xs" onClick={() => { setError(null); setOpened(true); }}>
        {t("Tag")}
      </Button>
      <Modal
        opened={opened}
        onClose={() => { if (!applying) setOpened(false); }}
        closeOnClickOutside={!applying}
        closeOnEscape={!applying}
        withCloseButton={!applying}
        title={`${t("Adding a tag")} — ${handles.length.toLocaleString()} ${t("objects")}`}
        size="sm"
      >
        <Stack gap="md">
          {error && (
            <Alert color="red" title={t("Could not tag")}>
              {error}
            </Alert>
          )}
          {applying && handles.length > TAG_PROGRESS_FROM ? (
            <Stack gap={4}>
              <Progress value={(100 * tagged) / handles.length} />
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  {t("Tagged %s of %s").replace("%s", tagged.toLocaleString()).replace("%s", handles.length.toLocaleString())}
                </Text>
                <Button size="xs" variant="default" onClick={() => { cancelled.current = true; }}>
                  {t("Cancel")}
                </Button>
              </Group>
            </Stack>
          ) : (
            <Text size="sm" c={applying ? "dimmed" : undefined}>
              {applying ? t("Applying…") : null}
            </Text>
          )}
          <RecordPicker
            view={TAG_VIEW}
            searchField="gramps_id"
            placeholder={TAG_VIEW.simpleSearch?.placeholder ?? "Search…"}
            buildExpr={TAG_VIEW.simpleSearch?.buildExpr}
            renderLabel={(item) => pickerResultLabel(TAG_VIEW.key, item)}
            onPick={handlePick}
            confirmWithButton
            createLabel="tag"
            onCreateNew={handleCreateNew}
          />
        </Stack>
      </Modal>
    </>
  );
}
