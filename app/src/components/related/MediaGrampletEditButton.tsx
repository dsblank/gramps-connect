import { lazy, Suspense, useState } from "react";
import { Box, Button, Loader } from "@mantine/core";
import type { ObjectDetail } from "../../store/objectDetail";
import { canAuthorGramplets, GRAMPLET_TAG_NAME } from "../../pyodidePoc/grampletMedia";
import { t } from "../../i18n/i18n";

// pyodidePoc/ pulls in prismjs/react-simple-code-editor -- lazy so a
// session that never opens a Gramplet's editor never fetches either, same
// reasoning as MediaKmlEditButton.tsx's own lazy maplibre-gl/terra-draw
// import just above it in this same header slot.
const GrampletEditDialog = lazy(() =>
  import("../../pyodidePoc/GrampletEditDialog").then((m) => ({ default: m.GrampletEditDialog }))
);

/** A "Gramplet"-tagged Media object's own "edit its label/code" action --
 * same header slot as EditButton.tsx (which excludes Media entirely: a
 * generic Media wraps an uploaded file, not a form) and
 * MediaKmlEditButton.tsx (the other Media type this app can meaningfully
 * edit in place). Renders nothing for any Media that isn't both
 * application/json and tagged "Gramplet" -- see pyodidePoc/grampletMedia.ts
 * for what a Gramplet actually is. */
export function MediaGrampletEditButton({ detail, onSaved }: { detail: ObjectDetail; onSaved: () => void }) {
  const [opened, setOpened] = useState(false);
  const tags = (detail.extended?.tags as { name?: string }[] | undefined) ?? [];
  const isGramplet = detail.mime === "application/json" && tags.some((tag) => tag.name === GRAMPLET_TAG_NAME);
  if (!isGramplet || !canAuthorGramplets()) return null;

  const label = t("Edit this Gramplet");

  return (
    <>
      <Button variant="default" size="xs" onClick={() => setOpened(true)} aria-label={label}>
        {t("Edit Gramplet")}
      </Button>
      {opened && (
        <Suspense
          fallback={
            <Box style={{ position: "fixed", inset: 0, zIndex: 300 }}>
              <Loader size="sm" style={{ position: "absolute", top: "50%", left: "50%" }} />
            </Box>
          }
        >
          <GrampletEditDialog
            target={{ kind: "edit", handle: detail.handle }}
            onClose={() => setOpened(false)}
            onSaved={onSaved}
          />
        </Suspense>
      )}
    </>
  );
}
