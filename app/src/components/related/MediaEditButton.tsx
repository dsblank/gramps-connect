import { useState } from "react";
import { Alert, Button, Group, Loader, Modal, Stack, Switch, TextInput } from "@mantine/core";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { getToken, hasPermissions } from "../../auth/auth";
import { fetchPlainObject, updateObject } from "../../store/objectsApi";
import { getViewStore } from "../../store/registry";
import type { ObjectDetail } from "../../store/objectDetail";
import { MEDIA_VIEW } from "../../store/views";
import { DateInput } from "../DateInput";
import { t } from "../../i18n/i18n";

/** Top-right button on a RelatedPanel's Media view (same header slot as
 * MediaKmlEditButton/MediaGrampletEditButton) editing the handful of plain
 * scalar fields every Media object has -- description, date, private --
 * regardless of mime. EditButton.tsx excludes "media" from the generic Edit
 * button entirely (a Media object wraps an uploaded file rather than a
 * blank form -- draftStack.ts's EDITABLE_TYPES comment), and
 * ObjectEditDialog.tsx has no FIELD_SPECS entry for it either, so this was
 * the one type with literally no edit affordance for an ordinary photo
 * (only KML/Gramplet media had anything to edit, via those two buttons'
 * own narrower mime-specific dialogs). Fetches/PUTs the plain object dict
 * itself rather than going through draftStack -- a Media object here is
 * always an edit of something that already exists, never a "new" draft, so
 * none of draftStack's stacked-dialog machinery (nested references,
 * Modal.Stack layering, saveAll batching) actually applies. path/mime/
 * checksum/attribute_list/citation_list/note_list/tag_list stay untouched
 * -- those are either server-derived from the upload or already editable
 * via RelatedPanel's own sections (AttributesSection/NotesSection/etc). */
export function MediaEditButton({ detail, onSaved }: { detail: ObjectDetail; onSaved: () => void }) {
  const [opened, setOpened] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Record<string, unknown>>({});

  if (!hasPermissions("EditObject")) return null;

  function open() {
    setOpened(true);
    setStatus("loading");
    setError(null);
    (async () => {
      try {
        const token = await getToken();
        const obj = await fetchPlainObject(token, MEDIA_VIEW, detail.handle);
        setData(obj);
        setStatus("ready");
      } catch (err: any) {
        setError(err.message ?? String(err));
        setStatus("error");
      }
    })();
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      await updateObject(token, MEDIA_VIEW, detail.handle, data);
      getViewStore("media").requeryDebounced();
      setOpened(false);
      onSaved();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="default" size="xs" onClick={open} aria-label={t("Edit this media")}>
        {t("Edit")}
      </Button>
      <Modal opened={opened} onClose={() => setOpened(false)} title={t("Edit media")} size="md">
        {status === "loading" && (
          <Group justify="center" py="md">
            <Loader size="sm" />
          </Group>
        )}
        {status === "error" && (
          <Stack gap="md">
            <Alert color="red" title={t("Could not load")}>{error}</Alert>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setOpened(false)}>{t("Close")}</Button>
            </Group>
          </Stack>
        )}
        {status === "ready" && (
          <Stack gap="md">
            <TextInput
              label={t("Description")}
              value={(data.desc as string | undefined) ?? ""}
              onChange={(e) => setData((prev) => ({ ...prev, desc: e.currentTarget.value }))}
            />
            <DateInput
              id={`${detail.handle}-media-date`}
              label={t("Date")}
              value={(data.date as GrampsDate | undefined) ?? null}
              onChange={(date) => setData((prev) => ({ ...prev, date }))}
            />
            <Switch
              label={t("Private")}
              checked={Boolean(data.private)}
              onChange={(e) => setData((prev) => ({ ...prev, private: e.currentTarget.checked }))}
            />
            {error && (
              <Alert color="red" title={t("Could not save")}>
                {error}
              </Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setOpened(false)} disabled={saving}>
                {t("Cancel")}
              </Button>
              <Button onClick={save} loading={saving}>
                {t("Save")}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}
