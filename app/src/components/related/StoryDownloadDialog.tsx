import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Group, Loader, Modal, Progress, Stack, Switch, Text } from "@mantine/core";
import { getToken, hasPermissions } from "../../auth/auth";
import { clickDownloadLink } from "../../store/downloadFile";
import type { ObjectDetail } from "../../store/objectDetail";
import type { StorySpec } from "../../store/storyBuilder";
import {
  apiImageLoader,
  buildStoryZip,
  gatherStoryExport,
  planStoryExport,
  type ExportSummary,
  type StoryExportSource,
} from "../../store/storyExport";
import { getI18nSnapshot, t } from "../../i18n/i18n";

// Matches gramps-web-api's PERMISSIONS map (auth/const.py) -- the same
// check ExportDialog.tsx makes.
const PERM_VIEW_PRIVATE = "ViewPrivate";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function describeLeftOut(s: ExportSummary): string | null {
  const parts = [
    s.slidesLeftOut > 0 && plural(s.slidesLeftOut, "slide", "slides"),
    s.photosLeftOut > 0 && plural(s.photosLeftOut, "photo", "photos"),
    s.placesLeftOut > 0 && plural(s.placesLeftOut, "place", "places"),
    s.overlaysLeftOut > 0 && plural(s.overlaysLeftOut, "map overlay", "map overlays"),
  ].filter(Boolean);
  return parts.length > 0 ? `Left out: ${parts.join(", ")}.` : null;
}

/** "Download" for a story (StoryActions.tsx): privacy switches, a live
 * summary of what they leave out, then a .story.zip built in the browser
 * (store/storyExport.ts). The facts the switches act on are fetched once
 * when the dialog opens; flipping a switch only re-plans. */
export function StoryDownloadDialog({ opened, onClose, detail, spec }: {
  opened: boolean;
  onClose: () => void;
  detail: ObjectDetail;
  spec: StorySpec;
}) {
  const canViewPrivate = hasPermissions(PERM_VIEW_PRIVATE);
  const [source, setSource] = useState<StoryExportSource | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [includePrivate, setIncludePrivate] = useState(false);
  const [includeLiving, setIncludeLiving] = useState(false);
  const [includeIds, setIncludeIds] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    setSource(null);
    setLoadError(null);
    setBuildError(null);
    setNotice(null);
    gatherStoryExport(detail, spec)
      .then((s) => { if (!cancelled) setSource(s); })
      .catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err)); });
    return () => {
      cancelled = true;
    };
  }, [opened, detail, spec, attempt]);

  const plan = useMemo(() => source && planStoryExport(
    source,
    // A user who can't see private records never received any: there's
    // nothing for the switch to decide, so it isn't shown.
    { includePrivate: canViewPrivate && includePrivate, includeLiving, includeIds },
    { language: getI18nSnapshot().lang, appVersion: __APP_VERSION__ },
  ), [source, canViewPrivate, includePrivate, includeLiving, includeIds]);

  const busy = progress !== null;

  async function handleDownload() {
    if (!plan) return;
    setBuildError(null);
    setNotice(null);
    setProgress({ done: 0, total: plan.media.length });
    try {
      const token = await getToken();
      const built = await buildStoryZip(plan, apiImageLoader(token), (done, total) => setProgress({ done, total }));
      const url = URL.createObjectURL(built.zip);
      clickDownloadLink(url, built.fileName);
      // Long enough for the browser to start the save; the blob isn't
      // needed after that.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (built.failedImages > 0) {
        setNotice(`Downloaded, but ${plural(built.failedImages, "image", "images")} couldn't be fetched and ${built.failedImages === 1 ? "was" : "were"} left out.`);
      } else {
        onClose();
      }
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
    }
  }

  const filtering = (canViewPrivate && !includePrivate) || !includeLiving;
  const leftOut = plan && describeLeftOut(plan.summary);

  return (
    <Modal opened={opened} onClose={busy ? () => {} : onClose} title={t("Download story")} size="md">
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {t("Saves this story as a .story.zip file, with its photos and maps, that opens without Gramps Connect or an account.")}
        </Text>

        {loadError && (
          <Alert color="red">
            <Stack gap="xs">
              <Text size="sm">{loadError}</Text>
              <Group>
                <Button size="xs" variant="light" onClick={() => setAttempt((n) => n + 1)}>{t("Try again")}</Button>
              </Group>
            </Stack>
          </Alert>
        )}

        {!source && !loadError && (
          <Group gap="sm">
            <Loader size="sm" />
            <Text size="sm">{t("Checking the story's records…")}</Text>
          </Group>
        )}

        {plan && (
          <>
            {canViewPrivate && (
              <Switch
                label={t("Include data marked private")}
                checked={includePrivate}
                disabled={busy}
                onChange={(event) => setIncludePrivate(event.currentTarget.checked)}
              />
            )}
            <Switch
              label={t("Include living people")}
              description={t("Off leaves out slides about people who may still be living, and photos of them.")}
              checked={includeLiving}
              disabled={busy}
              onChange={(event) => setIncludeLiving(event.currentTarget.checked)}
            />
            <Switch
              label={t("Include record IDs")}
              description={t("Adds the Gramps IDs of the story's events and photos, so someone with access to this tree can find them.")}
              checked={includeIds}
              disabled={busy}
              onChange={(event) => setIncludeIds(event.currentTarget.checked)}
            />

            {plan.blocked ? (
              <Alert color="yellow">{plan.blocked}</Alert>
            ) : (
              <Stack gap={2}>
                <Text size="sm">
                  {plural(plan.summary.slides, "slide", "slides")}, {plural(plan.summary.photos, "photo", "photos")}.
                </Text>
                {leftOut && <Text size="sm" c="dimmed">{leftOut}</Text>}
              </Stack>
            )}

            {filtering && !plan.blocked && (
              <Text size="xs" c="dimmed">
                {t("Text written into the slides isn't changed. Check it doesn't mention anyone you're leaving out.")}
              </Text>
            )}
          </>
        )}

        {progress && (
          <Stack gap={4}>
            <Text size="sm">
              {progress.total > 0
                ? `Preparing photos: ${Math.min(progress.done + 1, progress.total)} of ${progress.total}`
                : t("Preparing the file…")}
            </Text>
            <Progress value={progress.total > 0 ? (100 * progress.done) / progress.total : 100} animated />
          </Stack>
        )}

        {buildError && <Alert color="red">{buildError}</Alert>}
        {notice && <Alert color="yellow">{notice}</Alert>}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={busy}>
            {notice ? t("Close") : t("Cancel")}
          </Button>
          <Button onClick={handleDownload} loading={busy} disabled={!plan || Boolean(plan.blocked)}>
            {t("Download")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
