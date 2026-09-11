import { useState } from "react";
import { Alert } from "@mantine/core";
import { getToken, hasPermissions } from "../../auth/auth";
import { getBacklinks, type ObjectDetail } from "../../store/objectDetail";
import { detachRefListEntry } from "../../store/refListApi";
import { bumpTopicActivity } from "../../store/topicWindows";
import { VIEWS } from "../../store/views";
import { SectionShell, RefRow } from "./sections/shared";
import type { OnNavigate } from "./types";
import { t } from "../../i18n/i18n";

const TYPE_LABELS: Record<string, string> = {
  person: "People", family: "Families", event: "Events", place: "Places",
  repository: "Repositories", source: "Sources", citation: "Citations",
  media: "Media", note: "Notes", tag: "Tags",
};

const VIEW_BY_KEY = new Map(VIEWS.map((v) => [v.key, v]));

/** A Topic's "Linked objects" panel -- the same grouped-by-type backlink
 * rows BacklinksSection.tsx renders everywhere else (this topic note's
 * handle sits in each linked record's own note_list, so getBacklinks() on
 * the topic note finds them all, same mechanism, no new endpoint), but with
 * a "−" remove per row. Kept as its own component rather than a mode added
 * to BacklinksSection: a plain backlink is deliberately read-only
 * everywhere else (it isn't owned by the object displaying it), but a
 * Topic's links genuinely are something this page manages. Removing
 * unlinks the record from this topic (detaches the topic note's own handle
 * from *that record's* note_list) -- it never deletes the linked record
 * itself. Mounted from both RelatedPanel's own management page and
 * FloatingTopicWindow.tsx's collapsible section for the same discussion --
 * see LinkObjectControl.tsx's own doc comment for why `onRefetch` alone
 * (each mounting's own local refetch) isn't enough to keep the other one
 * in sync, and bumpTopicActivity() is. */
export function TopicLinksSection({ detail, onNavigate, onRefetch }: { detail: ObjectDetail; onNavigate: OnNavigate; onRefetch: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const backlinks = getBacklinks(detail);
  const types = Object.keys(backlinks).filter((type) => backlinks[type].length > 0);
  const canRemove = hasPermissions("EditObject");

  async function handleRemove(type: string, handle: string) {
    const view = VIEW_BY_KEY.get(type);
    if (!view) return;
    setError(null);
    try {
      const token = await getToken();
      await detachRefListEntry(token, view, handle, "note_list", detail.handle);
      bumpTopicActivity();
      onRefetch();
    } catch (err: any) {
      setError(err.message ?? String(err));
    }
  }

  return (
    <SectionShell label={t("Linked objects")}>
      {types.length === 0 && <Alert color="gray">{t("Nothing linked to this discussion yet.")}</Alert>}
      {types.map((type) => (
        <div key={type}>
          <div style={{ fontWeight: 500, fontSize: "var(--mantine-font-size-sm)", opacity: 0.7 }}>
            {TYPE_LABELS[type] ?? type}
          </div>
          {(backlinks[type] as { handle: string }[]).map((obj) => (
            <RefRow
              key={obj.handle}
              type={type}
              handle={obj.handle}
              obj={obj}
              onNavigate={onNavigate}
              onRemove={canRemove ? () => handleRemove(type, obj.handle) : undefined}
            />
          ))}
        </div>
      ))}
      {error && <Alert color="red">{error}</Alert>}
    </SectionShell>
  );
}
