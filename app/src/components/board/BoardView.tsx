// The Evidence Board page (#/board/<case>): one case file's board, a
// corkboard of records from the tree tied together with yarn
// (EVIDENCE_BOARD_PLAN.md, Phase 3). Everything here is staged -- moving a
// card, pinning one up, tying yarn -- until Save, which writes the tree
// changes and the case file as one transaction (store/board/save.ts), with
// an Undo. Unsaved work is kept in this browser between visits
// (store/board/caseDraft.ts).
import { Alert, Anchor, Box, Button, Group, Loader, Modal, Select, Stack, Text, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentUsername, getToken } from "../../auth/auth";
import { formatHash, isNewBoardHandle } from "../../hash";
import { t } from "../../i18n/i18n";
import { canChangeData } from "../../pyodidePoc/grampletCommit";
import { applyChanges, type Change } from "../../store/board/changes";
import { type CaseFile, type CardSize } from "../../store/board/caseFile";
import { clearDraft, writeDraft } from "../../store/board/caseDraft";
import { draftOf, openCase, openUnsavedCase, type OpenedCase } from "../../store/board/caseLoad";
import { loadRecords, type GrampsClass } from "../../store/board/records";
import { saveBoard, undoSave } from "../../store/board/save";
import { deriveYarn, detailsOf, isUndatedPhoto, isUnproven, subtitleOf, titleOf } from "../../store/board/view";
import { mediaThumbnailUrl } from "../../store/mediaCrop";
import { TransactionConflictError } from "../../store/transactionsApi";
import { CASE_FILE_VIEW, VIEWS } from "../../store/views";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { RecordPicker } from "../RecordPicker";
import { pickerResultLabel } from "../RefPickerField";
import { BoardCanvas, type BoardCanvasHandle, type BoardSelection, type Point } from "./BoardCanvas";
import { corkboardSkin } from "./corkboard/corkboardSkin";
import type { CardView } from "./skin";

const NEXT_SIZE: Record<CardSize, CardSize> = { compact: "expanded", expanded: "icon", icon: "compact" };
const VIEW_OF: Record<string, GrampsClass> = {
  person: "Person", family: "Family", event: "Event", place: "Place", source: "Source",
  citation: "Citation", repository: "Repository", media: "Media", note: "Note",
};

function useToken(): string | null {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getToken().then((tk) => !cancelled && setToken(tk), () => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return token;
}

export function BoardView({ caseKey, onCaseSaved }: { caseKey: string; onCaseSaved: (noteHandle: string) => void }) {
  const [opened, setOpened] = useState<OpenedCase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<CaseFile | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [selection, setSelection] = useState<BoardSelection>(null);
  const [saving, setSaving] = useState(false);
  const [pinType, setPinType] = useState<string | null>(null);
  const canvas = useRef<BoardCanvasHandle | null>(null);
  const token = useToken();
  const canSave = canChangeData();
  useDocumentTitle(`${file?.name ?? t("Evidence Board")} — Gramps Connect`);

  // --- open the case ------------------------------------------------------------
  const load = useCallback(async (key: string) => {
    setError(null);
    try {
      const result = isNewBoardHandle(key)
        ? await openUnsavedCase(`new:${key}`, t("New case"), getCurrentUsername() ?? "")
        : await openCase(key);
      setOpened(result);
      setFile(result.file);
      setChanges(result.changes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useEffect(() => {
    setOpened(null);
    void load(caseKey);
  }, [caseKey, load]);

  // --- what the board shows -------------------------------------------------------
  const working = useMemo(() => (opened ? applyChanges(opened.base, changes) : {}), [opened, changes]);
  const onBoard = useMemo(() => new Set((file?.cards ?? []).map((c) => c.handle).filter((h) => working[h])), [file, working]);
  const updated = useMemo(() => new Set((opened?.updated ?? []).map((c) => c.handle)), [opened]);
  const cards: CardView[] = useMemo(
    () =>
      (file?.cards ?? [])
        .filter((c) => working[c.handle])
        .map((c) => ({
          handle: c.handle,
          cls: working[c.handle]._class,
          title: titleOf(c.handle, working),
          subtitle: subtitleOf(c.handle, working),
          details: c.size === "expanded" ? detailsOf(c.handle, working) : [],
          size: c.size,
          unproven: isUnproven(working[c.handle]),
          undated: isUndatedPhoto(working[c.handle]),
          draft: !opened?.base[c.handle],
          updated: updated.has(c.handle),
          photo: photoOf(c.handle),
        })),
    [file, working, opened, updated],
  );
  function photoOf(handle: string): CardView["photo"] {
    const r = working[handle];
    if (!r) return null;
    if (r._class === "Media") return String(r.mime ?? "").startsWith("image/") ? { media: handle, rect: null } : null;
    if (r._class !== "Person") return null;
    const first = (Array.isArray(r.media_list) ? r.media_list : [])[0] as { ref?: string; rect?: number[] | null } | undefined;
    return first?.ref ? { media: first.ref, rect: first.rect ?? null } : null;
  }
  const photoUrls = useMemo(() => {
    const out: Record<string, string | null> = {};
    if (!token) return out;
    for (const c of cards) if (c.photo) out[c.handle] = mediaThumbnailUrl(c.photo.media, 300, token, { rect: c.photo.rect });
    return out;
  }, [cards, token]);
  const yarn = useMemo(() => deriveYarn(working, onBoard), [working, onBoard]);
  const newYarn = useMemo(() => {
    if (!opened) return new Set<string>();
    const saved = new Set(deriveYarn(opened.base, onBoard).map((y) => y.id));
    return new Set(yarn.filter((y) => !saved.has(y.id)).map((y) => y.id));
  }, [opened, yarn, onBoard]);
  const positions = useMemo(() => Object.fromEntries((file?.cards ?? []).map((c) => [c.handle, { x: c.x, y: c.y }])), [file]);

  // --- unsaved work, kept in this browser -------------------------------------------
  const layoutChanged = !!opened && !!file && JSON.stringify(file) !== JSON.stringify(opened.file) ? true : false;
  const dirty = changes.length > 0 || layoutChanged || (!!opened && !opened.note && !!file?.cards.length);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!opened || !file) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      if (dirty) writeDraft(opened.caseKey, draftOf(opened, file, changes));
    }, 300);
  }, [opened, file, changes, dirty]);

  // --- board actions ------------------------------------------------------------------
  const moveCard = (handle: string, to: Point) =>
    setFile((f) => f && { ...f, cards: f.cards.map((c) => (c.handle === handle ? { ...c, x: to.x, y: to.y } : c)) });
  const cycleSize = (handle: string) =>
    setFile((f) => f && { ...f, cards: f.cards.map((c) => (c.handle === handle ? { ...c, size: NEXT_SIZE[c.size] } : c)) });

  async function pinUp(cls: GrampsClass, handle: string) {
    if (!opened || !file) return;
    if (file.cards.some((c) => c.handle === handle)) {
      setSelection({ kind: "card", id: handle });
      return;
    }
    const loaded = opened.base[handle] ? { [handle]: opened.base[handle] } : await loadRecords(cls, [handle]);
    const record = loaded[handle];
    if (!record) return;
    setOpened({ ...opened, base: { ...opened.base, ...loaded } });
    const right = file.cards.reduce((m, c) => Math.max(m, c.x), -260);
    const top = file.cards.length ? Math.min(...file.cards.map((c) => c.y)) : 0;
    setFile({
      ...file,
      cards: [
        ...file.cards,
        { handle, class: cls, gramps_id: record.gramps_id, label: titleOf(handle, { ...working, ...loaded }), seenChange: record.change as number, x: right + 260, y: top, size: "compact" },
      ],
    });
    setSelection({ kind: "card", id: handle });
    setTimeout(() => canvas.current?.fit(), 100);
  }

  async function save() {
    if (!opened || !file) return;
    setSaving(true);
    try {
      // Saving marks every card as looked at now.
      const content: CaseFile = {
        ...file,
        cards: file.cards.map((c) => {
          const r = opened.base[c.handle];
          return { ...c, seenChange: r ? (r.change as number) : c.seenChange, gramps_id: r?.gramps_id ?? c.gramps_id, label: titleOf(c.handle, working) || c.label };
        }),
      };
      const saved = await saveBoard(opened.base, changes, `Evidence Board: ${file.name}`, { caseFile: { note: opened.note, content } });
      clearDraft(opened.caseKey);
      const noteHandle = saved?.caseNote?.handle ?? opened.note?.handle;
      if (saved) {
        notifications.show({
          color: "green",
          title: t("Saved"),
          message: (
            <Group gap="xs">
              <Text size="sm">{t("Saved as one change.")}</Text>
              <Anchor
                component="button"
                size="sm"
                onClick={async () => {
                  try {
                    await undoSave(saved);
                    notifications.show({ color: "blue", message: t("Undone. The tree is back to how it was.") });
                    if (opened.note && noteHandle) await load(noteHandle);
                    else window.location.hash = formatHash({ viewKey: CASE_FILE_VIEW.key });
                  } catch (err) {
                    notifications.show({ color: "red", message: err instanceof Error ? err.message : String(err) });
                  }
                }}
              >
                {t("Undo")}
              </Anchor>
            </Group>
          ),
        });
      }
      if (noteHandle && !opened.note) onCaseSaved(noteHandle);
      else if (noteHandle) await load(noteHandle);
    } catch (err) {
      const message = err instanceof TransactionConflictError
        ? t("Someone changed one of these records since you opened the board. Nothing was saved; reopen the board to see their change.")
        : err instanceof Error ? err.message : String(err);
      notifications.show({ color: "red", title: t("Not saved"), message });
    } finally {
      setSaving(false);
    }
  }

  // --- page ---------------------------------------------------------------------------
  if (error) {
    return (
      <Stack p="md">
        <Alert color="red" title={t("This board can't be opened")}>{error}</Alert>
        <Anchor href={formatHash({ viewKey: CASE_FILE_VIEW.key })}>{t("Back to Case Files")}</Anchor>
      </Stack>
    );
  }
  if (!opened || !file) {
    return (
      <Group p="md" gap="xs">
        <Loader size="sm" />
        <Text c="dimmed">{t("Opening the board…")}</Text>
      </Group>
    );
  }
  const looseEnds = changes.filter((c) => !c.off).length;
  const notices = [
    opened.updated.length ? t("{n} card(s) changed in the tree since this case was last saved.").replace("{n}", String(opened.updated.length)) : "",
    opened.gone.length ? t("No longer in the tree: {names}.").replace("{names}", opened.gone.map((c) => c.label || c.gramps_id).join(", ")) : "",
    opened.hidden ? t("{n} card(s) you can't see.").replace("{n}", String(opened.hidden)) : "",
    opened.needsReview.length ? t("{n} unsaved change(s) need a look: their records changed since.").replace("{n}", String(opened.needsReview.length)) : "",
    opened.layoutReplaced ? t("This case was saved elsewhere since your last visit, so its saved layout is shown.") : "",
  ].filter(Boolean);

  return (
    <Box style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column" }}>
      <Group gap="xs" px="sm" py={6} wrap="wrap" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
        <Text fw={600}>{file.name}</Text>
        {file.question && <Text c="dimmed" size="sm">{file.question}</Text>}
        <Box style={{ flex: 1 }} />
        <Button size="xs" variant="default" onClick={() => setPinType("person")}>{t("Pin up…")}</Button>
        <Button size="xs" variant="default" onClick={() => canvas.current?.fit()}>{t("Fit")}</Button>
        <Text size="sm" c="dimmed">
          {looseEnds ? (looseEnds === 1 ? t("1 loose end") : t("{n} loose ends").replace("{n}", String(looseEnds))) : layoutChanged ? t("Layout not saved") : t("Everything saved")}
        </Text>
        <Tooltip label={t("Saving needs Editor rights or above.")} disabled={canSave}>
          <Button size="xs" onClick={save} loading={saving} disabled={!canSave || !dirty}>{t("Save")}</Button>
        </Tooltip>
      </Group>
      {notices.length > 0 && (
        <Alert color="yellow" py={6} radius={0}>
          {notices.map((n) => <Text size="sm" key={n}>{n}</Text>)}
        </Alert>
      )}
      <Box style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <BoardCanvas
          skin={corkboardSkin}
          cards={cards}
          positions={positions}
          yarn={yarn}
          newYarn={newYarn}
          photoUrls={photoUrls}
          selection={selection}
          onSelect={setSelection}
          onMove={(h, to) => moveCard(h, to)}
          onCycleSize={cycleSize}
          canvasRef={(c) => (canvas.current = c)}
        />
        {!cards.length && (
          <Stack align="center" justify="center" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <Text
              style={{ pointerEvents: "auto", background: "var(--mantine-color-body)", padding: "8px 14px", borderRadius: 6, boxShadow: "0 2px 8px rgba(0,0,0,.3)" }}
            >
              {t("An empty board. Pin up the people and records you're investigating with “Pin up…”.")}
            </Text>
          </Stack>
        )}
      </Box>
      <Modal opened={!!pinType} onClose={() => setPinType(null)} title={t("Pin up from the tree")} size="lg">
        <Stack>
          <Select
            label={t("Kind of record")}
            value={pinType}
            onChange={setPinType}
            allowDeselect={false}
            data={Object.keys(VIEW_OF).map((key) => ({ value: key, label: t(VIEWS.find((v) => v.key === key)!.label) }))}
          />
          {pinType && (() => {
            const view = VIEWS.find((v) => v.key === pinType)!;
            return (
              <RecordPicker
                key={pinType}
                view={view}
                searchField="gramps_id"
                placeholder={t(view.simpleSearch?.placeholder ?? "Search…")}
                buildExpr={view.simpleSearch?.buildExpr}
                renderLabel={(item) => pickerResultLabel(view.key, item)}
                onPick={(item) => {
                  const handle = String(item.handle);
                  setPinType(null);
                  void pinUp(VIEW_OF[view.key], handle);
                }}
              />
            );
          })()}
        </Stack>
      </Modal>
    </Box>
  );
}
