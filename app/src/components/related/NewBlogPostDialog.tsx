// The Blog view's "New blog post": a full-screen writing surface for a
// whole story, not a form. Title, author, lead image/gallery and the
// rich-text body (NoteEditor.tsx, stored as a Gramps StyledText), with a
// Preview that shows the post exactly as BlogPostView.tsx will. What's
// written is kept in this browser as a draft until it's published or
// discarded, so closing the dialog (or the tab) never loses a story.
//
// A blog post isn't a DraftType (gramps-web has a dedicated view for this
// too, see GrampsjsViewNewBlogPost.js), so this is its own dialog rather
// than draftStack.ts's stacked flow. After publishing it just requeries
// the Blog ViewStore and closes (blogApi.ts's createBlogPost does the
// requery) -- the new post sorts to the top of the table, one click away.
import { useEffect, useState } from "react";
import {
  Alert, Box, Button, Group, Modal, ScrollArea, SegmentedControl, Stack, Text, TextInput, Title,
} from "@mantine/core";
import { getCurrentUsername, getToken, getTreeId, hasPermissions } from "../../auth/auth";
import { createBlogPost } from "../../store/blogApi";
import { confirmDialog } from "../../store/confirmDialog";
import type { StyledText } from "../../store/styledText";
import { NoteEditor } from "../notes/NoteEditor";
import { BlogArticle } from "../BlogPostView";
import { MediaListField, pickerResultLabel } from "../RefPickerField";
import { t } from "../../i18n/i18n";

const PERM_ADD_OBJ = "AddObject";

interface DraftMedia {
  handle: string;
  label: string;
  mime?: string;
}

interface BlogDraft {
  title: string;
  author: string;
  content: StyledText;
  media: DraftMedia[];
}

const EMPTY: BlogDraft = { title: "", author: "", content: { string: "" }, media: [] };

/** Per tree and user, like visitedHistory.ts's own key. */
function draftKey(): string {
  return `gramps-connect:blog-draft:${getTreeId() ?? "unknown"}:${getCurrentUsername() ?? ""}`;
}

function loadDraft(): BlogDraft {
  try {
    const raw = localStorage.getItem(draftKey());
    if (!raw) return EMPTY;
    const d = JSON.parse(raw) as Partial<BlogDraft>;
    return {
      title: typeof d.title === "string" ? d.title : "",
      author: typeof d.author === "string" ? d.author : "",
      content: d.content && typeof d.content.string === "string" ? d.content : { string: "" },
      media: Array.isArray(d.media) ? d.media.filter((m) => m && typeof m.handle === "string") : [],
    };
  } catch {
    return EMPTY;
  }
}

function saveDraft(draft: BlogDraft): void {
  try {
    if (isEmpty(draft)) localStorage.removeItem(draftKey());
    else localStorage.setItem(draftKey(), JSON.stringify(draft));
  } catch {
    // Storage blocked or full: the draft just isn't kept.
  }
}

function isEmpty(d: BlogDraft): boolean {
  return !d.title.trim() && !d.author.trim() && !d.content.string.trim() && d.media.length === 0;
}

/** An uploaded file's type isn't known here, only its name. */
function mimeFromName(name: string): string | undefined {
  return /\.(jpe?g|png|gif|webp|bmp|tiff?|heic|avif)$/i.test(name) ? "image/*" : undefined;
}

export function NewBlogPostButton() {
  const [opened, setOpened] = useState(false);
  const [draft, setDraft] = useState<BlogDraft>(EMPTY);
  // Bumped to remount the editor when its content is replaced wholesale
  // (a draft restored on open, or discarded).
  const [editorKey, setEditorKey] = useState(0);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (opened) saveDraft(draft);
  }, [opened, draft]);

  if (!hasPermissions(PERM_ADD_OBJ)) return null;

  const update = (patch: Partial<BlogDraft>) => setDraft((d) => ({ ...d, ...patch }));

  function open() {
    setDraft(loadDraft());
    setEditorKey((k) => k + 1);
    setMode("write");
    setError(null);
    setOpened(true);
  }

  async function discard() {
    if (!isEmpty(draft) && !(await confirmDialog(t("Discard this blog post draft?"), t("Discard")))) return;
    saveDraft(EMPTY);
    setDraft(EMPTY);
    setEditorKey((k) => k + 1);
    setOpened(false);
  }

  async function publish() {
    if (!draft.title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      await createBlogPost(token, draft.title.trim(), draft.author.trim(), draft.content, draft.media.map((m) => m.handle));
      saveDraft(EMPTY);
      setDraft(EMPTY);
      setOpened(false);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button size="xs" onClick={open}>{t("New blog post")}</Button>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        fullScreen
        // A writing surface: only the buttons close it (the draft is kept
        // either way), not a stray Escape from a toolbar popover.
        closeOnEscape={false}
        withCloseButton={false}
        padding={0}
      >
        <Box
          px="md"
          py="sm"
          style={{
            position: "sticky",
            top: 0,
            zIndex: 3,
            background: "var(--mantine-color-body)",
            borderBottom: "1px solid var(--mantine-color-default-border)",
          }}
        >
          <Group justify="space-between" wrap="wrap" gap="xs">
            <Group gap="md">
              <Text fw={600}>{t("New blog post")}</Text>
              <SegmentedControl
                size="xs"
                value={mode}
                onChange={(v) => setMode(v as "write" | "preview")}
                data={[
                  { value: "write", label: t("Write") },
                  { value: "preview", label: t("Preview") },
                ]}
              />
            </Group>
            <Group gap="xs">
              <Button variant="subtle" color="red" size="xs" onClick={discard} disabled={saving}>{t("Discard")}</Button>
              <Button variant="default" size="xs" onClick={() => setOpened(false)} disabled={saving}>{t("Close")}</Button>
              <Button size="xs" onClick={publish} loading={saving} disabled={!draft.title.trim()}>{t("Publish")}</Button>
            </Group>
          </Group>
        </Box>
        <ScrollArea.Autosize mah="calc(100dvh - 60px)">
          <Box maw={760} mx="auto" px="md" py="lg">
            {error && <Alert color="red" mb="md">{error}</Alert>}
            {mode === "write" ? (
              <Stack gap="md">
                <TextInput
                  placeholder={t("Title")}
                  aria-label={t("Title")}
                  size="xl"
                  variant="unstyled"
                  styles={{ input: { fontSize: "2rem", fontWeight: 700 } }}
                  value={draft.title}
                  onChange={(e) => update({ title: e.currentTarget.value })}
                  autoFocus={!draft.title}
                />
                <TextInput
                  label={t("Author")}
                  value={draft.author}
                  onChange={(e) => update({ author: e.currentTarget.value })}
                />
                <Stack gap={2}>
                  <MediaListField
                    label={t("Media")}
                    refs={draft.media.map((m) => m.handle)}
                    labels={Object.fromEntries(draft.media.map((m) => [m.handle, m.label]))}
                    onAddExisting={(item) =>
                      update({
                        media: [...draft.media, {
                          handle: item.handle,
                          label: pickerResultLabel("media", item),
                          mime: typeof item.mime === "string" ? item.mime : undefined,
                        }],
                      })
                    }
                    onAdded={(handle, label) =>
                      update({ media: [...draft.media, { handle, label, mime: mimeFromName(label) }] })
                    }
                    onRemove={(handle) => update({ media: draft.media.filter((m) => m.handle !== handle) })}
                  />
                  <Text size="xs" c="dimmed">
                    {t("The first image leads the post; the rest are shown under the text. Use the editor's image button to place a picture inside the story.")}
                  </Text>
                </Stack>
                <NoteEditor
                  key={editorKey}
                  value={draft.content}
                  onChange={(content) => update({ content })}
                  minHeight="50vh"
                  prose
                  placeholder={t("Tell the story…")}
                />
              </Stack>
            ) : (
              <Stack gap="md">
                <Title order={1}>{draft.title.trim() || t("(untitled)")}</Title>
                <BlogArticle
                  author={draft.author.trim() || undefined}
                  media={draft.media.map((m) => ({ handle: m.handle, mime: m.mime }))}
                  note={draft.content}
                  onNavigate={() => {}}
                />
              </Stack>
            )}
          </Box>
        </ScrollArea.Autosize>
      </Modal>
    </>
  );
}
