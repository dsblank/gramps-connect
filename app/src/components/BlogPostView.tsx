// Fullscreen "reading" presentation of a Blog post (store/views.ts's
// BLOG_VIEW) -- a Source's title/author plus its attached Note's body and
// media, laid out as a magazine article rather than RelatedPanel's usual
// field-by-field detail view. Ported from gramps-web's GrampsjsBlogPost.js.
// Fetches its own data by handle (rather than accepting an already-fetched
// ObjectDetail) so both call sites -- BlogActions.tsx (an existing post,
// already selected in RelatedPanel) and AddButton.tsx's NewBlogPostButton
// (a handle it just created, nothing fetched yet) -- can open the same
// component the same way; same self-contained-on-open shape as
// CompareModal.tsx.
import { useEffect, useState } from "react";
import { Alert, Anchor, Box, Group, Image, Loader, Modal, ScrollArea, SimpleGrid, Stack, Text } from "@mantine/core";
import { getToken } from "../auth/auth";
import { fetchObjectExtended, zipRefs, type ObjectDetail } from "../store/objectDetail";
import { mediaThumbnailUrl } from "../store/mediaCrop";
import { BLOG_VIEW, formatChange, formatChangeTitle } from "../store/views";
import { MediaThumbnail } from "./related/MediaThumbnail";
import { NoteText } from "./related/NoteText";
import type { OnNavigate } from "./related/types";
import { t } from "../i18n/i18n";

interface MediaTarget {
  handle: string;
  mime?: string;
}

/** The post's lead image, full-width rather than MediaThumbnail's fixed
 * square (a landscape/group photo reads better as a wide banner than
 * cropped to a tile) -- calls mediaThumbnailUrl directly instead for that
 * reason, same auth-as-query-param convention MediaThumbnail.tsx's own doc
 * comment explains (plain <img src>, no Authorization header available).
 * `fit="contain"` (not "cover") -- the mediaRef's own `rect` (a deliberate
 * user crop, still honored via mediaThumbnailUrl's own param) is the only
 * cropping this ever does; a forced `fit="cover"` inside a fixed-height box
 * additionally center-crops on top of that, silently cutting off whatever
 * doesn't fit the box (confirmed live: the top of a portrait/group photo),
 * which gramps-web's own uncropped hero (GrampsjsBlogPost.js's
 * grampsjs-img, no forced crop) never did. */
function HeroImage({ handle, mime, rect }: { handle: string; mime?: string; rect?: number[] }) {
  const [token, setToken] = useState<string | null>(null);
  const isImage = mime?.startsWith("image/") ?? false;

  useEffect(() => {
    if (!isImage) return;
    let cancelled = false;
    getToken().then((tok) => {
      if (!cancelled) setToken(tok);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isImage]);

  if (!isImage || !token) return null;
  return (
    <Image
      src={mediaThumbnailUrl(handle, 1200, token, { rect })}
      alt=""
      mah={480}
      w="auto"
      mx="auto"
      fit="contain"
      radius="sm"
    />
  );
}

function noteTextOf(detail: ObjectDetail): { string: string } | null {
  const notes = (detail.extended?.notes as { text?: { string?: string } }[] | undefined) ?? [];
  const text = notes[0]?.text;
  return text?.string ? { string: text.string } : null;
}

export function BlogPostView({ handle, opened, onClose, onNavigate }: {
  handle: string | null;
  opened: boolean;
  onClose: () => void;
  onNavigate: OnNavigate;
}) {
  const [detail, setDetail] = useState<ObjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened || !handle) return;
    let cancelled = false;
    setDetail(null);
    setError(null);
    getToken()
      .then((token) => fetchObjectExtended(token, BLOG_VIEW, handle))
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err.message ?? String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [handle, opened]);

  const mediaRows = detail ? zipRefs<MediaTarget>(detail.media_list, detail.extended?.media) : [];
  const [hero, ...rest] = mediaRows;
  const note = detail ? noteTextOf(detail) : null;

  return (
    <Modal opened={opened} onClose={onClose} fullScreen title={detail ? (detail.title as string) : t("Blog post")}>
      <ScrollArea.Autosize mah="calc(100vh - 120px)">
        <Box maw={720} mx="auto" py="md">
          {error && <Alert color="red" title={t("Failed to load")}>{error}</Alert>}
          {!detail && !error && (
            <Group justify="center" py="xl">
              <Loader size="sm" />
            </Group>
          )}
          {detail && (
            <Stack gap="md">
              <Group gap="xs" c="dimmed">
                {typeof detail.author === "string" && detail.author && <Text>{detail.author}</Text>}
                {typeof detail.change === "number" && (
                  <Text title={formatChangeTitle(detail.change)}>{formatChange(detail.change)}</Text>
                )}
              </Group>
              {hero && (
                <HeroImage handle={hero.ref.ref} mime={hero.target?.mime} rect={hero.ref.rect} />
              )}
              <Box style={{ fontSize: "1.1rem", lineHeight: 1.7 }}>
                {note ? <NoteText text={note} onNavigate={onNavigate} /> : (
                  <Text c="dimmed" fs="italic">{t("This post has no content yet.")}</Text>
                )}
              </Box>
              {rest.length > 0 && (
                <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
                  {rest.map(({ ref, target }) => (
                    <MediaThumbnail key={ref.ref} handle={ref.ref} mime={target?.mime} rect={ref.rect} size={140} zoomable />
                  ))}
                </SimpleGrid>
              )}
              <Anchor component="button" type="button" onClick={() => onNavigate("source", detail.handle)}>
                {t("Show source details")}
              </Anchor>
            </Stack>
          )}
        </Box>
      </ScrollArea.Autosize>
    </Modal>
  );
}
