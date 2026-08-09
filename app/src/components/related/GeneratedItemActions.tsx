import { useState } from "react";
import { Alert, Button, Group } from "@mantine/core";
import { API_BASE } from "../../config";
import { getToken } from "../../auth/auth";
import { deleteMedia } from "../../store/jobsApi";
import type { ObjectDetail } from "../../store/objectDetail";
import { zipHandles } from "./sections/shared";

/** Download + "Delete the export?" flow for an Output row (plan
 * §5) -- gramps-connect has no generic per-object download affordance
 * elsewhere (a Media object's file is only ever shown as a thumbnail, see
 * MediaThumbnail.tsx), so this is scoped to RelatedPanel's `view.key ===
 * "generated"` branch rather than added to every type. Rows tagged
 * "report" are never prompted for deletion -- only "export". */
export function GeneratedItemActions({ detail }: { detail: ObjectDetail }) {
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  const tags = zipHandles<{ name?: string }>(detail.tag_list, detail.extended?.tags);
  const isExport = tags.some((t) => t.target?.name === "export");

  if (deleted) {
    return <Alert color="gray">Export deleted.</Alert>;
  }

  async function handleDownload() {
    setError(null);
    try {
      const token = await getToken();
      // A plain, programmatically-clicked <a> with the jwt query param --
      // same pattern MediaThumbnail.tsx uses for its <img src>, since
      // neither element can set an Authorization header -- rather than
      // fetch()+blob, so the browser handles the download natively
      // (its own progress UI, save-as prompt, ...).
      const url = `${API_BASE}/api/media/${encodeURIComponent(detail.handle)}/file?download=true&jwt=${encodeURIComponent(token)}`;
      const a = document.createElement("a");
      a.href = url;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();

      if (isExport && window.confirm("Delete the export?")) {
        await deleteMedia(token, detail.handle);
        setDeleted(true);
      }
    } catch (err: any) {
      setError(err.message ?? String(err));
    }
  }

  return (
    <Group gap="xs">
      <Button size="xs" onClick={handleDownload}>Download</Button>
      {error && <Alert color="red">{error}</Alert>}
    </Group>
  );
}
