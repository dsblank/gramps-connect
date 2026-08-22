import { useEffect, useState } from "react";
import { Button, Modal } from "@mantine/core";
import { getToken, hasPermissions } from "../../../auth/auth";
import { fetchPlainObject } from "../../../store/objectsApi";
import { buildSimpleSearchExpr } from "../../../store/simpleSearch";
import { MEDIA_VIEW } from "../../../store/views";
import type { QueryItem } from "../../../store/api";
import { attachComparison, comparisonTargets, detachComparison } from "../../../store/comparisonApi";
import { CircleGlyphButton } from "../../CircleGlyphButton";
import { RecordPicker } from "../../RecordPicker";
import { pickerResultLabel } from "../../RefPickerField";
import { CompareModal } from "../CompareModal";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";
import { t } from "../../../i18n/i18n";

interface MediaSummary {
  handle: string;
  desc?: string;
  path?: string;
  mime?: string;
  gramps_id?: string;
}

// Media/generated's own default simpleSearch fields (views.ts's MEDIA_VIEW),
// with an always-on "images only" filter ANDed in -- the compare slider only
// makes sense between two images, unlike MediaThumbnail's broader
// video/pdf-thumbnailable set. Excludes the currently-viewed media itself
// (comparing a photo against itself is meaningless) and, since RecordPicker
// now asks a caller-supplied buildExpr even for an empty term (see
// RecordPicker.tsx), this filters the picker's default browse-all list too,
// not just once something's typed.
function imageOnlyExpr(selfHandle: string): (term: string) => string | null {
  const base = buildSimpleSearchExpr(["gramps_id", "desc", "path"]);
  return (term: string) => {
    const termExpr = base(term);
    const fixed = `like(mime, "image/%") and handle != "${selfHandle}"`;
    return termExpr ? `(${termExpr}) and ${fixed}` : fixed;
  };
}

/** Media.attribute_list entries typed "Comparison" (store/comparisonApi.ts)
 * -- Media has no native Media-to-Media reference of its own
 * (gramps/gen/lib/media.py), so this section piggybacks on the generic
 * Attribute mechanism instead of a real ref-list field, unlike every other
 * AttachControl-based section here (Notes/Citations/Tags/Media). Each row
 * resolves its own target with its own fetch: an Attribute's value is an
 * opaque string to gramps-web-api's `extend=all`, nothing like
 * media_list/citation_list it knows to follow into `detail.extended`. Only
 * ever rendered for media/generated (RELATED_CONFIG.media/.generated),
 * enforced here too in case a future config change adds it elsewhere by
 * mistake. */
export function ComparisonsSection({ type, detail, onNavigate, onRefetch }: SectionProps) {
  const targets = type === "media" || type === "generated" ? comparisonTargets(detail.attribute_list) : [];
  const [targetObjs, setTargetObjs] = useState<Record<string, MediaSummary>>({});
  const [pickerOpened, setPickerOpened] = useState(false);
  const [compareTarget, setCompareTarget] = useState<MediaSummary | null>(null);
  const canEdit = hasPermissions("EditObject");
  const targetsKey = targets.join(",");

  useEffect(() => {
    if (targets.length === 0) return;
    let cancelled = false;
    (async () => {
      const token = await getToken();
      const entries = await Promise.all(
        targets.map(async (handle) => {
          try {
            const obj = await fetchPlainObject(token, MEDIA_VIEW, handle);
            return [handle, obj as unknown as MediaSummary] as const;
          } catch {
            return [handle, { handle }] as const;
          }
        })
      );
      if (!cancelled) setTargetObjs(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsKey]);

  if (type !== "media" && type !== "generated") return null;
  if (targets.length === 0 && !canEdit) return null;

  async function handlePick(item: QueryItem) {
    setPickerOpened(false);
    const token = await getToken();
    await attachComparison(token, detail.handle, item.handle);
    onRefetch?.();
  }

  async function handleRemove(targetHandle: string) {
    if (!window.confirm("Remove this comparison? This does not delete either media item.")) return;
    const token = await getToken();
    await detachComparison(token, detail.handle, targetHandle);
    onRefetch?.();
  }

  return (
    <SectionShell label={t("Comparisons")}>
      {targets.map((handle) => {
        const target = targetObjs[handle];
        return (
          <RefRow
            key={handle}
            type="media"
            handle={handle}
            obj={target}
            onNavigate={onNavigate}
            extra={
              target && (
                <Button size="xs" onClick={() => setCompareTarget(target)}>
                  {t("⇔ Compare")}
                </Button>
              )
            }
            onRemove={canEdit ? () => handleRemove(handle) : undefined}
          />
        );
      })}
      {canEdit && (
        <>
          <CircleGlyphButton
            glyph="+"
            label={t("Attach a comparison")}
            textLabel="Add a comparison"
            onClick={() => setPickerOpened(true)}
          />
          <Modal opened={pickerOpened} onClose={() => setPickerOpened(false)} title={t("Adding a comparison")} size="sm">
            <RecordPicker
              view={MEDIA_VIEW}
              searchField="desc"
              placeholder={MEDIA_VIEW.simpleSearch?.placeholder ?? "Search…"}
              buildExpr={imageOnlyExpr(detail.handle)}
              renderLabel={(item) => pickerResultLabel(MEDIA_VIEW.key, item)}
              onPick={handlePick}
              confirmWithButton
            />
          </Modal>
        </>
      )}
      {compareTarget && (
        <CompareModal
          opened
          onClose={() => setCompareTarget(null)}
          a={{ handle: detail.handle, desc: (detail.desc as string | undefined) ?? (detail.path as string | undefined) }}
          b={{ handle: compareTarget.handle, desc: compareTarget.desc ?? compareTarget.path }}
        />
      )}
    </SectionShell>
  );
}
