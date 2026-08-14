import { useState } from "react";
import { Alert, Button, Group } from "@mantine/core";
import { API_BASE } from "../../config";
import { getToken } from "../../auth/auth";
import { deleteMedia, FILE_NAME_ATTRIBUTE } from "../../store/jobsApi";
import type { ObjectDetail } from "../../store/objectDetail";
import { zipHandles } from "./sections/shared";

function clickDownloadLink(href: string, fileName?: string) {
  const a = document.createElement("a");
  a.href = href;
  a.rel = "noopener";
  if (fileName) a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

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

  // Absent on anything generated before file names were recorded (and on
  // ordinary media, which this component never renders for) -- those keep
  // the server's own name, which is the media object's checksum-derived
  // path. See jobsApi.ts's FILE_NAME_ATTRIBUTE.
  const attributes = (detail.attribute_list as { type?: string; value?: string }[] | undefined) ?? [];
  const fileName = attributes.find((attr) => attr.type === FILE_NAME_ATTRIBUTE)?.value;

  if (deleted) {
    return <Alert color="gray">Export deleted.</Alert>;
  }

  async function handleDownload() {
    setError(null);
    try {
      const token = await getToken();
      // Two ways to hand the file over, and which one applies comes down
      // to whether we have a better name than the server's.
      //
      // Without one: a plain, programmatically-clicked <a> with the jwt
      // query param -- same pattern MediaThumbnail.tsx uses for its <img
      // src>, since neither element can set an Authorization header --
      // letting the browser download it natively (its own progress UI,
      // save-as prompt, ...) under the name the response asks for.
      //
      // With one: the `download` attribute is the only way to override
      // that name, and browsers honour it on same-origin URLs alone --
      // which the API isn't, in any deployment where it's a separate host
      // (see config.ts). So the file is fetched into a blob first, whose
      // object URL *is* same-origin, at the cost of holding it in memory
      // and losing the native progress UI. Exports of a large tree are the
      // biggest thing through here, and tens of MB is well within what a
      // blob handles.
      if (!fileName) {
        const url = `${API_BASE}/api/media/${encodeURIComponent(detail.handle)}/file?download=true&jwt=${encodeURIComponent(token)}`;
        clickDownloadLink(url);
      } else {
        const res = await fetch(`${API_BASE}/api/media/${encodeURIComponent(detail.handle)}/file`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`could not fetch the file: ${res.status}`);
        const objectUrl = URL.createObjectURL(await res.blob());
        try {
          clickDownloadLink(objectUrl, fileName);
        } finally {
          // Safari needs the URL to outlive the click; a task turn is
          // enough, and the blob is freed either way.
          setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
        }
      }

      if (isExport && window.confirm(`Delete the export "${fileName ?? detail.handle}"? There is no undo.`)) {
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
