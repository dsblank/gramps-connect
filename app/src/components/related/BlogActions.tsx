import { useState } from "react";
import { Group } from "@mantine/core";
import type { ObjectDetail } from "../../store/objectDetail";
import { BlogPostView } from "../BlogPostView";
import { ViewButton } from "./ViewButton";
import type { OnNavigate } from "./types";
import { t } from "../../i18n/i18n";

/** RelatedPanel's "ways of viewing this record" row (same spot
 * MediaViewButton.tsx's own "View" occupies for media/generated, and the
 * Discussions view's own "View" for topics -- all three are a synthetic
 * view's own "open the real thing" trigger, kept in one place so they read
 * as the same kind of control). A "View" trigger for the fullscreen
 * BlogPostView -- Edit/Delete are already generic across every editable
 * type (a blog post is an ordinary Source, "source" is a DraftType), so
 * this component only needs to own the presentation's open/closed state.
 * Self-wraps in a Group, same reason MediaViewButton.tsx does: this row's
 * parent Stack defaults to align="stretch", which would otherwise stretch
 * a bare ViewButton to the full pane width. */
export function BlogActions({ detail, onNavigate }: { detail: ObjectDetail; onNavigate: OnNavigate }) {
  const [opened, setOpened] = useState(false);

  return (
    <>
      <Group gap="xs">
        <ViewButton label={t("View")} onClick={() => setOpened(true)} />
      </Group>
      <BlogPostView handle={detail.handle} opened={opened} onClose={() => setOpened(false)} onNavigate={onNavigate} />
    </>
  );
}
