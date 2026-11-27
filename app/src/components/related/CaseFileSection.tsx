import { useEffect, useState } from "react";
import { Alert, Badge, Group, Loader, Paper, Text } from "@mantine/core";
import type { ObjectDetail } from "../../store/objectDetail";
import { readSavedCase, type SavedCase } from "../../store/board/caseLoad";
import { CaseFileFormatError, type CaseCard } from "../../store/board/caseFile";
import { GRAMPS_CLASSES, type GrampsClass } from "../../store/board/records";
import { titleOf } from "../../store/board/view";
import { VIEWS } from "../../store/views";
import { RefRow, SectionShell } from "./sections/shared";
import { withGrampsId } from "./summary";
import type { OnNavigate } from "./types";
import { t } from "../../i18n/i18n";

const VIEW_BY_KEY = new Map(VIEWS.map((v) => [v.key, v]));

/** A record type's list view key ("Person" -> "person"). */
const viewKeyOf = (cls: GrampsClass) => cls.toLowerCase();

/** `handle`: the case the result is for, so a same-case refresh (a
 * live-sync tick refetches `detail`) keeps what's on screen and only a
 * different case shows the spinner. */
type State =
  | { status: "loading" }
  | { status: "error"; handle: string; message: string }
  | { status: "ready"; handle: string; saved: SavedCase };

/** A case file's contents in the details pane: the records pinned on its
 * board, grouped by type, each one a link that previews the record below
 * (onNavigate), and its sticky notes.
 *
 * Read the same way opening the board reads it (caseLoad.ts): the JSON
 * goes through the tolerant parser, the pinned records are loaded as they
 * are *now* and labeled from that, not from the names stored at the last
 * save. A record changed since the save says so; one that's gone is
 * listed by its stored name and isn't a link; one the viewer can't see
 * (maybe private) is only counted. Shows the saved case, never this
 * browser's unsaved loose ends. */
export function CaseFileSection({ detail, onNavigate }: { detail: ObjectDetail; onNavigate: OnNavigate }) {
  const text = (detail.text as { string?: unknown } | undefined)?.string;
  const noteChange = typeof detail.change === "number" ? detail.change : 0;
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const handle = detail.handle;
    readSavedCase(typeof text === "string" ? text : "", noteChange)
      .then((saved) => { if (!cancelled) setState({ status: "ready", handle, saved }); })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: "error", handle, message: err instanceof CaseFileFormatError ? t(err.message) : (err?.message ?? String(err)) });
      });
    return () => { cancelled = true; };
  }, [detail.handle, text, noteChange]);

  if (state.status === "loading" || state.handle !== detail.handle) return <Group><Loader size="xs" /></Group>;
  if (state.status === "error") return <Alert color="red">{state.message}</Alert>;

  const { file, base, updated, gone, hidden } = state.saved;
  const updatedSet = new Set(updated.map((c) => c.handle));
  const goneSet = new Set(gone.map((c) => c.handle));
  const shown = file.cards.filter((c) => base[c.handle]);
  const byClass = GRAMPS_CLASSES.map((cls) => [cls, shown.filter((c) => c.class === cls)] as const).filter(([, cards]) => cards.length > 0);
  const goneCards = file.cards.filter((c) => goneSet.has(c.handle));
  const count = shown.length + goneCards.length + hidden;

  return (
    <>
      <SectionShell label={t("On the board")} count={count}>
        {count === 0 && <Text size="sm" c="dimmed">{t("Nothing is pinned on this board yet.")}</Text>}
        {byClass.map(([cls, cards]) => (
          <div key={cls}>
            <div style={{ fontWeight: 500, fontSize: "var(--mantine-font-size-sm)", opacity: 0.7 }}>
              {t(VIEW_BY_KEY.get(viewKeyOf(cls))?.label ?? cls)}
            </div>
            {cards.map((card) => {
              const record = base[card.handle];
              return (
                <RefRow
                  key={card.handle}
                  type={viewKeyOf(cls)}
                  handle={card.handle}
                  obj={record}
                  label={withGrampsId(record.gramps_id || undefined, titleOf(card.handle, base))}
                  onNavigate={onNavigate}
                  extra={updatedSet.has(card.handle) ? (
                    <Badge size="xs" variant="light" color="yellow">{t("Changed since the case was saved")}</Badge>
                  ) : undefined}
                />
              );
            })}
          </div>
        ))}
        {goneCards.length > 0 && (
          <div>
            <div style={{ fontWeight: 500, fontSize: "var(--mantine-font-size-sm)", opacity: 0.7 }}>
              {t("No longer in the tree")}
            </div>
            {goneCards.map((card: CaseCard) => (
              <Text key={card.handle} size="md" c="dimmed" td="line-through">
                {withGrampsId(card.gramps_id || undefined, card.label || t("an unsaved record"))}
              </Text>
            ))}
          </div>
        )}
        {hidden > 0 && (
          <Text size="sm" c="dimmed">
            {hidden === 1 ? t("1 more card you can't see.") : t("{n} more cards you can't see.").replace("{n}", String(hidden))}
          </Text>
        )}
      </SectionShell>
      {file.stickies.length > 0 && (
        <SectionShell label={t("Sticky notes")} count={file.stickies.length}>
          {file.stickies.map((s) => (
            <Paper key={s.id} p="xs" withBorder style={{ background: "var(--mantine-color-yellow-light)", whiteSpace: "pre-wrap" }}>
              <Text size="sm">{s.text || t("(empty)")}</Text>
              {(() => {
                const about = (s.about ?? []).map((h) => file.cards.find((c) => c.handle === h)).filter((c): c is CaseCard => !!c);
                return about.length > 0 && (
                  <Text size="xs" c="dimmed" mt={4}>
                    {t("About")}: {about.map((c) => c.label || c.gramps_id || t("an unsaved record")).join(", ")}
                  </Text>
                );
              })()}
            </Paper>
          ))}
        </SectionShell>
      )}
    </>
  );
}
