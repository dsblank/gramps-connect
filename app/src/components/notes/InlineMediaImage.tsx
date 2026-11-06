import { useEffect, useState } from "react";
import { getToken } from "../../auth/auth";
import { mediaThumbnailUrl } from "../../store/mediaCrop";
import { useApiImageSrc } from "../../store/apiImage";

/** A note's inline image (styledText.ts's U+FFFC + gramps://Media link),
 * shown in both the note viewer (NoteText.tsx) and the editor's node view
 * (noteExtensions.tsx). Thumbnail-sized from the server, scaled down to
 * the text column, never cropped. */
export function InlineMediaImage({ handle, maxHeight = 360, selected = false }: {
  handle: string;
  maxHeight?: number;
  selected?: boolean;
}) {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getToken().then((tok) => {
      if (!cancelled) setToken(tok);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const image = useApiImageSrc(token ? mediaThumbnailUrl(handle, 800, token) : null);

  return (
    <span style={{ display: "inline-block", verticalAlign: "bottom", maxWidth: "100%" }}>
      {image.src && !image.failed ? (
        <img
          src={image.src}
          onError={image.onError}
          alt=""
          style={{
            display: "block",
            maxWidth: "100%",
            maxHeight,
            borderRadius: "var(--mantine-radius-sm)",
            outline: selected ? "2px solid var(--mantine-primary-color-filled)" : undefined,
          }}
        />
      ) : (
        <span
          style={{
            display: "inline-block",
            width: 120,
            height: 80,
            background: "var(--mantine-color-default-hover)",
            borderRadius: "var(--mantine-radius-sm)",
            outline: selected ? "2px solid var(--mantine-primary-color-filled)" : undefined,
          }}
        />
      )}
    </span>
  );
}
