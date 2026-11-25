// The Evidence Board page (#/board/<case>): one case file's board, a
// corkboard of records from the tree tied together with yarn
// (EVIDENCE_BOARD_PLAN.md, Phase 3). Everything here is staged as a "loose
// end" -- pinning up, tying or snipping yarn, editing, creating -- until
// Save, which writes the tree changes and the case file as one transaction
// (store/board/save.ts), with an Undo. Unsaved work is kept in this browser
// between visits (store/board/caseDraft.ts).
import { Alert, Anchor, Badge, Box, Button, Group, Loader, Modal, Stack, Text, Tooltip, useComputedColorScheme } from "@mantine/core";
import { parseCoords } from "../../store/visualData";
import { placeMapSnapshot } from "./placeMapSnapshot";
import { notifications } from "@mantine/notifications";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentUsername, getToken } from "../../auth/auth";
import { formatHash, isNewBoardHandle } from "../../hash";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { t } from "../../i18n/i18n";
import { canChangeData } from "../../pyodidePoc/grampletCommit";
import { applyChanges, ChangeBuilder, takeBack, toggleChange, type Change } from "../../store/board/changes";
import { type CardSize, type CaseCard, type CaseFile } from "../../store/board/caseFile";
import { clearDraft, writeDraft } from "../../store/board/caseDraft";
import { AFTER_OWN_SAVE, draftOf, openCase, openUnsavedCase, type OpenedCase } from "../../store/board/caseLoad";
import { connectOptions, newTypesFor, snip, standIn, type ConnectOption } from "../../store/board/connect";
import { newEvent, newNote, newPerson, newPlace, newRepository, newSource, setEventPlace, setEventType, setPersonName } from "../../store/board/links";
import { makeDate } from "@gramps-connect/gramps-date";
import { GRAMPS_CLASSES, loadRecords, type GrampsClass, type Records } from "../../store/board/records";
import { saveBoard, undoSave } from "../../store/board/save";
import { deriveYarn, detailsOf, isUndatedPhoto, isUnproven, leadsOf, subtitleOf, titleOf, type Yarn } from "../../store/board/view";
import { mediaThumbnailUrl } from "../../store/mediaCrop";
import { TransactionConflictError } from "../../store/transactionsApi";
import { CASE_FILE_VIEW, MEDIA_VIEW } from "../../store/views";
import { getViewStore } from "../../store/registry";
import { fetchObjectExtended } from "../../store/objectDetail";
import { openTopicWindow } from "../../store/topicWindows";
import { findCaseTopic, startCaseTopic } from "../../store/board/caseTopic";
import { extractRegions, ImageLightbox, type Region } from "../related/ImageLightbox";
import { hasPermissions } from "../../auth/auth";
import { BoardCanvas, type BoardCanvasHandle, type BoardSelection, type Point } from "./BoardCanvas";
import { AddMenu, CardPanel, CaseNotesPanel, CLASS_LABEL, FloatingMenu, InlineText, MenuChoice, SaveDialog, YarnPanel, type CardEdit, type OpenQuestion } from "./BoardPanels";
import { cleanUp } from "./cleanUp";
import { TreeMark } from "./TreeMark";
import boardCss from "./board.module.css";
import { downloadCase } from "../../store/board/caseExport";
import { corkboardSkin } from "./corkboard/corkboardSkin";
import type { CardView } from "./skin";

/** A view key (as region and search results name types) to its class. */
const VIEW_CLASS: Record<string, GrampsClass> = {
  person: "Person", family: "Family", event: "Event", place: "Place", source: "Source",
  citation: "Citation", repository: "Repository", media: "Media", note: "Note",
};

const NEXT_SIZE: Record<CardSize, CardSize> = { compact: "expanded", expanded: "icon", icon: "compact" };

/** A spot near `p` not taken by another card (cards are about 260 x 240). */
function freeSpot(cards: CaseCard[], p: Point): Point {
  const ok = (x: number, y: number) => cards.every((c) => Math.abs(c.x - x) >= 230 || Math.abs(c.y - y) >= 215);
  if (ok(p.x, p.y)) return p;
  for (let ring = 1; ring < 14; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        if (ok(p.x + dx * 260, p.y + dy * 240)) return { x: p.x + dx * 260, y: p.y + dy * 240 };
      }
    }
  }
  return { x: p.x + 30, y: p.y + 30 };
}

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

type Menu =
  | { kind: "connect"; from: string; to: string; screen: Point }
  | { kind: "new"; from: string; at: Point; screen: Point; cls?: GrampsClass }
  | null;

export function BoardView({ caseKey, onCaseSaved }: { caseKey: string; onCaseSaved: (noteHandle: string) => void }) {
  const [opened, setOpened] = useState<OpenedCase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<CaseFile | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [selection, setSelection] = useState<BoardSelection>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [adding, setAdding] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Records looked at but not pinned up (a card's leads), for their names. */
  const [peek, setPeek] = useState<Records>({});
  /** The photo shown full screen, if any. */
  const [lightbox, setLightbox] = useState<string | null>(null);
  /** Who's marked in the selected photo (null while loading). */
  const [inPhoto, setInPhoto] = useState<{ media: string; regions: Region[] | null } | null>(null);
  /** The case's discussion: its topic handle, "none" yet, or not known yet. */
  const [topic, setTopic] = useState<string | "none" | null>(null);
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
  const photoOf = useCallback(
    (handle: string): CardView["photo"] => {
      const r = working[handle];
      if (!r) return null;
      if (r._class === "Media") return String(r.mime ?? "").startsWith("image/") ? { media: handle, rect: null } : null;
      if (r._class !== "Person") return null;
      const first = (Array.isArray(r.media_list) ? r.media_list : [])[0] as { ref?: string; rect?: number[] | null } | undefined;
      return first?.ref ? { media: first.ref, rect: first.rect ?? null } : null;
    },
    [working],
  );
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
          coords: working[c.handle]._class === "Place" ? parseCoords(String(working[c.handle].lat ?? ""), String(working[c.handle].long ?? "")) : null,
        })),
    [file, working, opened, updated, photoOf],
  );
  const photoUrls = useMemo(() => {
    const out: Record<string, string | null> = {};
    if (!token) return out;
    for (const c of cards) if (c.photo) out[c.handle] = mediaThumbnailUrl(c.photo.media, 300, token, { rect: c.photo.rect });
    return out;
  }, [cards, token]);
  // Map pictures for place cards at the Dossier size.
  const dark = useComputedColorScheme("light") === "dark";
  const [mapUrls, setMapUrls] = useState<Record<string, string | null>>({});
  const wantMaps = cards.filter((c) => c.size === "expanded" && c.coords).map((c) => `${c.handle}@${c.coords!.join(",")}`).join("|");
  useEffect(() => {
    let cancelled = false;
    for (const c of cards) {
      if (c.size !== "expanded" || !c.coords) continue;
      const [lat, long] = c.coords;
      placeMapSnapshot(lat, long, dark).then((url) => {
        if (!cancelled) setMapUrls((m) => (m[c.handle] === url ? m : { ...m, [c.handle]: url }));
      });
    }
    return () => {
      cancelled = true;
    };
    // Only when which places need a map, or the colour scheme, changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantMaps, dark]);
  const yarn = useMemo(() => deriveYarn(working, onBoard), [working, onBoard]);
  const savedYarn = useMemo(() => (opened ? deriveYarn(opened.base, onBoard) : []), [opened, onBoard]);
  const newYarn = useMemo(() => {
    const saved = new Set(savedYarn.map((y) => y.id));
    return new Set(yarn.filter((y) => !saved.has(y.id)).map((y) => y.id));
  }, [savedYarn, yarn]);
  const cutYarn = useMemo(() => {
    const now = new Set(yarn.map((y) => y.id));
    return savedYarn.filter((y) => !now.has(y.id));
  }, [savedYarn, yarn]);
  const positions = useMemo(() => Object.fromEntries((file?.cards ?? []).map((c) => [c.handle, { x: c.x, y: c.y }])), [file]);

  const questions: OpenQuestion[] = useMemo(() => {
    const tied = new Set(yarn.flatMap((y) => [y.a, y.b]));
    const out: OpenQuestion[] = [];
    if (onBoard.size > 1) for (const h of onBoard) if (!tied.has(h)) out.push({ group: "Not tied to anything on the board", handle: h });
    for (const h of onBoard) if (isUnproven(working[h])) out.push({ group: "Unproven: where does it come from?", handle: h });
    for (const h of onBoard) if (isUndatedPhoto(working[h])) out.push({ group: "When was it taken?", handle: h });
    return out;
  }, [yarn, onBoard, working]);

  // --- unsaved work, kept in this browser -------------------------------------------
  const layoutChanged = !!opened && !!file && JSON.stringify(file) !== JSON.stringify(opened.file);
  /** Set when Close discards, so a pending autosave can't bring it back. */
  const discarded = useRef(false);
  const dirty = changes.length > 0 || layoutChanged || (!!opened && !opened.note && !!file?.cards.length);
  useEffect(() => {
    if (!opened || !file) return;
    const timer = setTimeout(() => {
      if (dirty && !discarded.current) writeDraft(opened.caseKey, draftOf(opened, file, changes));
    }, 300);
    return () => clearTimeout(timer);
  }, [opened, file, changes, dirty]);

  // --- staging loose ends -------------------------------------------------------------
  /** Stages one user action. `merge`: an edit that may replace the last loose
   * end if that was the same edit (typing a name twice is one loose end). */
  const stage = useCallback(
    (label: string, build: (b: ChangeBuilder) => void, merge = false) => {
      if (!opened) return null;
      const base = merge && changes.length && changes[changes.length - 1].label === label ? changes.slice(0, -1) : changes;
      const b = new ChangeBuilder(applyChanges(opened.base, base));
      build(b);
      const change = b.change(label);
      if (!change.steps.length) return null;
      setChanges([...base, change]);
      // One notice, updated in place, so a run of edits doesn't stack them.
      const notice = { id: "board-staged", icon: <TreeMark size={14} />, title: t("Added to loose ends"), message: `${label}. ${t("It goes into the tree when you save.")}` };
      notifications.show(notice);
      notifications.update(notice);
      return change;
    },
    [opened, changes],
  );

  const addCards = useCallback((newCards: CaseCard[], select?: string) => {
    setFile((f) => {
      if (!f) return f;
      const cardsNow = [...f.cards];
      for (const c of newCards) {
        if (cardsNow.some((x) => x.handle === c.handle)) continue;
        const spot = freeSpot(cardsNow, { x: c.x, y: c.y });
        cardsNow.push({ ...c, x: spot.x, y: spot.y });
      }
      return { ...f, cards: cardsNow };
    });
    if (select) {
      setSelection({ kind: "card", id: select });
    }
    setTimeout(() => canvas.current?.reveal(newCards.map((c) => c.handle)), 120);
  }, []);

  const cardFor = (handle: string, cls: GrampsClass, at: Point, records: Records): CaseCard => ({
    handle, class: cls, gramps_id: records[handle]?.gramps_id ?? "", label: titleOf(handle, records),
    seenChange: (records[handle]?.change as number) ?? 0, x: at.x, y: at.y, size: "compact",
  });

  /** Pins up records (loading the ones not loaded yet), near card `near`
   * or the middle of the screen. One record is selected after (unless
   * `keepSelection`, for pins from the sidebar's lists, which stay on the
   * card being read); several are shown together. */
  async function pinUpMany(items: { cls: GrampsClass; handle: string }[], near?: string, keepSelection = false) {
    if (!opened || !file) return;
    const fresh = items.filter((i) => !file.cards.some((c) => c.handle === i.handle));
    if (!fresh.length) {
      if (items.length === 1 && !keepSelection) setSelection({ kind: "card", id: items[0].handle });
      canvas.current?.reveal(items.map((i) => i.handle));
      return;
    }
    const loaded: Records = {};
    const missing: typeof fresh = [];
    for (const i of fresh) {
      const known = working[i.handle] ?? peek[i.handle];
      if (known) loaded[i.handle] = known;
      else missing.push(i);
    }
    for (const cls of GRAMPS_CLASSES) {
      const hs = missing.filter((i) => i.cls === cls).map((i) => i.handle);
      if (hs.length) Object.assign(loaded, await loadRecords(cls, hs));
    }
    const found = fresh.filter((i) => loaded[i.handle]);
    if (found.length < fresh.length) notifications.show({ color: "red", message: t("That record isn't in the tree any more, or you can't see it.") });
    if (!found.length) return;
    const newToBase = Object.fromEntries(found.filter((i) => !working[i.handle]).map((i) => [i.handle, loaded[i.handle]]));
    if (Object.keys(newToBase).length) setOpened((o) => o && { ...o, base: { ...o.base, ...newToBase } });
    const p = near && positions[near] ? { x: positions[near].x + 260, y: positions[near].y } : canvas.current?.center() ?? { x: 0, y: 0 };
    const records = { ...working, ...loaded };
    addCards(found.map((i) => cardFor(i.handle, i.cls, p, records)), found.length === 1 && !keepSelection ? found[0].handle : undefined);
  }
  const pinUp = (cls: GrampsClass, handle: string, near?: string, keepSelection = false) => pinUpMany([{ cls, handle }], near, keepSelection);

  function createNew(b: ChangeBuilder, cls: GrampsClass): string {
    switch (cls) {
      case "Person": return newPerson(b, {});
      case "Family": return b.create("Family");
      case "Event": return newEvent(b, "UNKNOWN");
      case "Place": return newPlace(b, "");
      case "Source": return newSource(b, "");
      case "Citation": return b.create("Citation");
      case "Repository": return newRepository(b, "");
      case "Note": return newNote(b, "");
      default: return b.create(cls);
    }
  }

  function createLoose(cls: GrampsClass) {
    let made = "";
    const change = stage(t(`New ${CLASS_LABEL[cls].toLowerCase()}`), (b) => {
      made = createNew(b, cls);
    });
    if (!change) return;
    setAdding(false);
    addCards([cardFor(made, cls, canvas.current?.center() ?? { x: 0, y: 0 }, {})], made);
  }

  /** Cards for records a tie made along the way (the citation between a
   * source and what it's evidence for), placed between the two ends, so the
   * yarn they carry shows. */
  function pinMadeAlongTheWay(created: string[], ends: Point[], records: Records) {
    if (!created.length) return;
    const mid = { x: ends.reduce((a, p) => a + p.x, 0) / ends.length, y: ends.reduce((a, p) => a + p.y, 0) / ends.length };
    addCards(created.filter((h) => records[h]).map((h) => cardFor(h, records[h]._class, mid, records)));
  }

  function tie(option: ConnectOption, from: string, to: string) {
    const change = stage(`${t("Tie")}: ${option.label}`, option.build);
    setMenu(null);
    if (change && opened) pinMadeAlongTheWay(change.creates, [positions[from], positions[to]], applyChanges(opened.base, [...changes, change]));
  }

  function createTied(from: string, cls: GrampsClass, index: number, at: Point) {
    let made = "";
    const fromTitle = titleOf(from, working);
    const change = stage(`${t(`New ${CLASS_LABEL[cls].toLowerCase()}`)}, ${t("tied to")} ${fromTitle}`, (b) => {
      made = createNew(b, cls);
      const options = connectOptions(working, b.get(from)!, b.get(made)!);
      options[index]?.build(b);
    });
    setMenu(null);
    if (!change || !opened) return;
    addCards([cardFor(made, cls, at, {})], made);
    pinMadeAlongTheWay(change.creates.filter((h) => h !== made), [positions[from], at], applyChanges(opened.base, [...changes, change]));
  }

  function editCard(handle: string, edit: CardEdit) {
    const who = titleOf(handle, working) || t(CLASS_LABEL[working[handle]._class]);
    switch (edit.kind) {
      case "personName":
        stage(`${t("Name")}: ${who} → ${[edit.first, edit.surname].filter(Boolean).join(" ")}`, (b) => setPersonName(b, handle, edit.first, edit.surname));
        break;
      case "gender":
        stage(`${t("Sex of")} ${who}`, (b) => b.set(handle, "gender", edit.gender), true);
        break;
      case "field":
        // Named by the field, so typing in it again replaces this loose end.
        stage(`${who}: ${t(edit.label)}`, (b) => b.set(handle, edit.field, edit.value), true);
        break;
      case "eventType":
        stage(`${t("Type of")} ${who} → ${t(edit.name)}`, (b) => setEventType(b, handle, edit.typeKey ?? "CUSTOM", edit.typeKey ? "" : edit.name));
        break;
      case "placeName":
        stage(`${t("Place name")} → ${edit.name}`, (b) => {
          const name = { ...(working[handle].name as Record<string, unknown>), value: edit.name };
          b.set(handle, "name", name);
          b.set(handle, "title", edit.name);
        });
        break;
      case "eventDate":
        // Named by the field, so changing it again replaces this loose end.
        stage(`${who}: ${t("date")}`, (b) => b.set(handle, "date", edit.date ?? makeDate({})), true);
        break;
      case "eventPlace":
        stage(`${who}: ${t("place")}`, (b) => setEventPlace(b, handle, edit.place), true);
        break;
      case "eventNewPlace": {
        let made = "";
        const change = stage(`${who}: ${t("new place")} ${edit.name}`, (b) => {
          made = newPlace(b, edit.name);
          setEventPlace(b, handle, made);
        });
        // A new record gets a card, like any made along the way.
        if (change && opened) pinMadeAlongTheWay([made], [{ x: positions[handle].x + 200, y: positions[handle].y }], applyChanges(opened.base, [...changes, change]));
        break;
      }
      case "placeCoords":
        stage(`${who}: ${t("coordinates")}`, (b) => {
          b.set(handle, "lat", edit.lat);
          b.set(handle, "long", edit.long);
        }, true);
        break;
      case "noteText":
        stage(`${who}: ${t("text")}`, (b) => b.set(handle, "text", { ...(working[handle].text as Record<string, unknown>), string: edit.text }), true);
        break;
    }
  }

  /** Moves cards to `targets` over a moment, so the eye can follow them. */
  const glide = useRef<number | null>(null);
  function glideTo(targets: Record<string, Point>, then?: () => void) {
    if (!file) return;
    if (glide.current) cancelAnimationFrame(glide.current);
    const from = Object.fromEntries(file.cards.map((c) => [c.handle, { x: c.x, y: c.y }]));
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    const ms = reduce ? 0 : 450;
    const step = (now: number) => {
      const k = ms ? Math.min(1, (now - start) / ms) : 1;
      const e = 1 - Math.pow(1 - k, 3);
      setFile((f) => f && {
        ...f,
        cards: f.cards.map((c) => {
          const a = from[c.handle];
          const b = targets[c.handle];
          return a && b ? { ...c, x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e } : c;
        }),
      });
      if (k < 1) glide.current = requestAnimationFrame(step);
      else {
        glide.current = null;
        then?.();
      }
    };
    glide.current = requestAnimationFrame(step);
  }

  function tidy() {
    const items = cards.map((c) => ({ handle: c.handle, x: positions[c.handle].x, y: positions[c.handle].y, box: corkboardSkin.cardBox(c) }));
    glideTo(cleanUp(items), () => canvas.current?.fit());
  }

  /** Takes back loose end `id` (and what depends on it), and takes the
   * cards of any records it had made off the board. */
  function takeBackChange(id: string): Change[] {
    const result = takeBack(changes, id);
    const unmade = new Set(result.removed.flatMap((c) => c.creates));
    setChanges(result.changes);
    if (unmade.size) setFile((f) => f && { ...f, cards: f.cards.filter((c) => !unmade.has(c.handle)) });
    return result.removed;
  }

  function takeOff(handle: string) {
    setFile((f) => f && { ...f, cards: f.cards.filter((c) => c.handle !== handle) });
    setSelection(null);
    notifications.show({ message: t("Taken off the board. Nothing in the tree changed.") });
  }

  function discardDraft(handle: string) {
    const creator = changes.find((c) => c.creates.includes(handle));
    if (creator) {
      const removed = takeBackChange(creator.id);
      notifications.show({ message: removed.length > 1 ? t("Discarded {n} loose ends").replace("{n}", String(removed.length)) : t("Discarded the draft") });
    }
    setFile((f) => f && { ...f, cards: f.cards.filter((c) => c.handle !== handle) });
    setSelection(null);
  }

  function snipYarn(y: Yarn) {
    stage(`${t("Remove connection")}: ${titleOf(y.a, working)} — ${t(y.label)} — ${titleOf(y.b, working)}`, (b) => snip(b, y));
  }
  /** Retie: take back the loose end that snipped it. */
  function retie(y: Yarn) {
    if (!opened) return;
    for (let i = changes.length - 1; i >= 0; i--) {
      const without = changes.filter((_, j) => j !== i);
      if (deriveYarn(applyChanges(opened.base, without), onBoard).some((x) => x.id === y.id)) {
        takeBackChange(changes[i].id);
        return;
      }
    }
  }
  function pullOut(y: Yarn) {
    if (!opened) return;
    for (let i = changes.length - 1; i >= 0; i--) {
      const without = changes.filter((_, j) => j !== i);
      if (!deriveYarn(applyChanges(opened.base, without), onBoard).some((x) => x.id === y.id)) {
        takeBackChange(changes[i].id);
        setSelection(null);
        return;
      }
    }
  }

  // Leads' names: load the records a selected card points at (not pinned up).
  useEffect(() => {
    if (selection?.kind !== "card" || !working[selection.id]) return;
    const leads = leadsOf(working[selection.id]).filter((l) => !working[l.handle] && !peek[l.handle]);
    if (!leads.length) return;
    let cancelled = false;
    (async () => {
      const found: Records = {};
      for (const cls of GRAMPS_CLASSES) {
        const hs = leads.filter((l) => l.cls === cls).map((l) => l.handle);
        if (hs.length) Object.assign(found, await loadRecords(cls, hs).catch(() => ({})));
      }
      if (!cancelled) setPeek((p) => ({ ...p, ...found }));
    })();
    return () => {
      cancelled = true;
    };
  }, [selection, working, peek]);

  // Who's marked in the selected photo, from every record whose reference
  // to it has a region (usually people's faces).
  const selectedHandle = selection?.kind === "card" ? selection.id : null;
  const selectedIsPhoto = !!selectedHandle && working[selectedHandle]?._class === "Media" && !!opened?.base[selectedHandle];
  useEffect(() => {
    if (!selectedHandle || !selectedIsPhoto) {
      setInPhoto(null);
      return;
    }
    const media = selectedHandle;
    setInPhoto({ media, regions: null });
    const controller = new AbortController();
    (async () => {
      try {
        const detail = await fetchObjectExtended(await getToken(), MEDIA_VIEW, media, controller.signal);
        setInPhoto({ media, regions: extractRegions(detail, media) });
      } catch {
        if (!controller.signal.aborted) setInPhoto({ media, regions: [] });
      }
    })();
    return () => controller.abort();
  }, [selectedHandle, selectedIsPhoto]);

  // The case's discussion, once it's saved.
  const noteHandle = opened?.note?.handle ?? null;
  useEffect(() => {
    setTopic(null);
    if (!noteHandle) return;
    let cancelled = false;
    (async () => {
      try {
        const found = await findCaseTopic(await getToken(), noteHandle);
        if (!cancelled) setTopic(found ?? "none");
      } catch {
        if (!cancelled) setTopic("none");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [noteHandle]);

  async function discuss() {
    if (!noteHandle || !file) return;
    try {
      let handle = topic && topic !== "none" ? topic : null;
      if (!handle) {
        handle = await startCaseTopic(await getToken(), noteHandle, file.name, file.question);
        setTopic(handle);
      }
      openTopicWindow(handle);
    } catch (err) {
      notifications.show({ color: "red", message: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Back to the Case Files list, on this case. Unsaved work stays in this
   * browser for next time. */
  /** Back to Case Files. With unsaved work, asks first: save it, keep it in
   * this browser for later, or throw it away. */
  const [closeAsk, setCloseAsk] = useState(false);
  function close(how: "ask" | "keep" | "discard" = "ask") {
    if (how === "ask" && dirty && canSave) {
      setCloseAsk(true);
      return;
    }
    if (opened && file && dirty && how !== "discard") writeDraft(opened.caseKey, draftOf(opened, file, changes));
    if (opened && how === "discard") {
      discarded.current = true;
      clearDraft(opened.caseKey);
    }
    setCloseAsk(false);
    window.location.hash = formatHash({ viewKey: CASE_FILE_VIEW.key, handle: opened?.note?.handle });
  }

  // Ctrl/Cmd+Z takes back the last loose end; Escape closes menus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement | null)?.tagName ?? "")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && changes.length) {
        e.preventDefault();
        const last = changes[changes.length - 1];
        takeBackChange(last.id);
        notifications.show({ message: `${t("Took back")}: ${last.label}` });
      }
      if (e.key === "Escape") {
        setMenu(null);
        setSelection(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [changes]);

  async function save() {
    if (!opened || !file) return;
    setSaving(true);
    try {
      // Saving marks every card as looked at now. Cards for new records whose
      // loose ends are unticked stay in this browser's draft, not the case file.
      const unticked = new Set(changes.filter((c) => c.off).flatMap((c) => c.creates));
      const content: CaseFile = {
        ...file,
        cards: file.cards.filter((c) => !unticked.has(c.handle)).map((c) => {
          const r = opened.base[c.handle];
          return { ...c, seenChange: r ? (r.change as number) : c.seenChange, gramps_id: r?.gramps_id ?? c.gramps_id, label: titleOf(c.handle, working) || c.label };
        }),
      };
      const saved = await saveBoard(opened.base, changes, `Evidence Board: ${file.name}`, { caseFile: { note: opened.note, content } });
      clearDraft(opened.caseKey);
      setSaveOpen(false);
      // The Case Files list shows the case's name and card count from the
      // case file: bring it up to date now rather than on the next poll.
      getViewStore(CASE_FILE_VIEW.key).requeryDebounced();
      const noteHandle = saved?.caseNote?.handle ?? opened.note?.handle;
      // Unticked loose ends stay for later: kept as the new case's draft.
      const rest = changes.filter((c) => c.off).map((c) => ({ ...c, off: false }));
      if (noteHandle && rest.length) writeDraft(noteHandle, { ...draftOf(opened, { ...content, cards: [...content.cards, ...file.cards.filter((c) => unticked.has(c.handle))] }, rest), noteChange: AFTER_OWN_SAVE });
      if (saved) {
        notifications.show({
          color: "green",
          title: t("Saved"),
          // Long enough to reach its Undo (the default 4 s isn't).
          autoClose: 12000,
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
  const goneNow = opened.gone.filter((g) => file.cards.some((c) => c.handle === g.handle));
  const notices = [
    opened.updated.length ? t("{n} card(s) changed in the tree since this case was last saved.").replace("{n}", String(opened.updated.length)) : "",
    goneNow.length ? t("No longer in the tree: {names}.").replace("{names}", goneNow.map((c) => c.label || c.gramps_id || t("an unsaved record")).join(", ")) : "",
    opened.hidden ? t("{n} card(s) you can't see.").replace("{n}", String(opened.hidden)) : "",
    opened.needsReview.length ? t("{n} unsaved change(s) need a look: their records changed since.").replace("{n}", String(opened.needsReview.length)) : "",
    opened.layoutReplaced ? t("This case was saved elsewhere since your last visit, so its saved layout is shown.") : "",
  ].filter(Boolean);
  const selectedYarn = selection?.kind === "yarn" ? [...yarn, ...cutYarn].find((y) => y.id === selection.id) : undefined;
  const selectedCard = selection?.kind === "card" ? file.cards.find((c) => c.handle === selection.id) : undefined;
  const selectedPhoto = selectedCard ? photoOf(selectedCard.handle) : null;

  let menuEl = null;
  if (menu?.kind === "connect" && working[menu.from] && working[menu.to]) {
    const options = connectOptions(working, working[menu.from], working[menu.to]);
    menuEl = (
      <FloatingMenu at={menu.screen} title={`${titleOf(menu.from, working)} ${t("and")} ${titleOf(menu.to, working)}`} onClose={() => setMenu(null)}>
        {options.length ? (
          <>
            <Text size="xs" c="dimmed" mb={4}>{t("What's the connection?")}</Text>
            {options.map((o) => <MenuChoice key={o.label} changesTree onClick={() => tie(o, menu.from, menu.to)}>{o.label}</MenuChoice>)}
          </>
        ) : (
          <Text size="sm">{t("These two can't be tied directly. Try tying each of them to an event or a citation.")}</Text>
        )}
      </FloatingMenu>
    );
  } else if (menu?.kind === "new" && working[menu.from]) {
    const from = working[menu.from];
    if (!menu.cls) {
      menuEl = (
        <FloatingMenu at={menu.screen} title={`${t("New, tied to")} ${titleOf(menu.from, working)}`} onClose={() => setMenu(null)}>
          <Text size="xs" c="dimmed" mb={4}>{t("What are you adding here?")}</Text>
          {newTypesFor(working, from).map((cls) => (
            <MenuChoice
              key={cls}
              changesTree
              onClick={() => {
                const options = connectOptions(working, from, standIn(cls));
                if (options.length === 1) createTied(menu.from, cls, 0, menu.at);
                else setMenu({ ...menu, cls });
              }}
            >
              {t(CLASS_LABEL[cls])}
            </MenuChoice>
          ))}
        </FloatingMenu>
      );
    } else {
      const cls = menu.cls;
      menuEl = (
        <FloatingMenu at={menu.screen} title={`${t(`New ${CLASS_LABEL[cls].toLowerCase()}`)}, ${t("tied to")} ${titleOf(menu.from, working)}`} onClose={() => setMenu(null)}>
          <Text size="xs" c="dimmed" mb={4}>{t("How are they connected?")}</Text>
          {connectOptions(working, from, standIn(cls)).map((o, i) => (
            <MenuChoice key={o.label} changesTree onClick={() => createTied(menu.from, cls, i, menu.at)}>{o.label}</MenuChoice>
          ))}
          <MenuChoice onClick={() => setMenu({ ...menu, cls: undefined })}>{t("Back")}</MenuChoice>
        </FloatingMenu>
      );
    }
  }

  return (
    <Box style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column" }}>
      <Group gap="xs" px="sm" py={6} wrap="wrap" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
        <InlineText strong value={file.name} placeholder="Name this case" readOnly={!canSave} onCommit={(v) => setFile((f) => f && { ...f, name: v })} />
        <InlineText value={file.question} placeholder="What are you trying to find out?" readOnly={!canSave} onCommit={(v) => setFile((f) => f && { ...f, question: v })} />
        <Box style={{ flex: 1 }} />
        <Button size="xs" variant="default" onClick={() => setAdding(true)}>{canSave ? t("Add…") : t("Pin…")}</Button>
        <Tooltip label={t("Straighten the cards and move them closer together")} openDelay={400}>
          <Button size="xs" variant="default" onClick={tidy} disabled={cards.length < 2}>{t("Clean up")}</Button>
        </Tooltip>
        <Button size="xs" variant="default" onClick={() => canvas.current?.fit()}>{t("Fit")}</Button>
        {canSave && (
          <Text key={looseEnds} size="xs" c="dimmed" px={4} className={looseEnds ? boardCss.pulse : undefined}>
            {looseEnds ? (looseEnds === 1 ? t("1 loose end not saved") : t("{n} loose ends not saved").replace("{n}", String(looseEnds))) : dirty ? t("Not saved yet") : t("Everything saved")}
          </Text>
        )}
        {canSave ? (
          <Button size="xs" onClick={() => setSaveOpen(true)} disabled={!dirty}>{t("Save")}</Button>
        ) : (
          <Tooltip multiline w={260} label={t("You can look around, pin records and arrange the board; your arrangement is kept in this browser. Changing the tree or the case file needs Editor rights.")}>
            <Badge variant="light" color="gray">{t("View only")}</Badge>
          </Tooltip>
        )}
        <Tooltip label={t("Back to Case Files")} openDelay={400}>
          <Button size="xs" variant="default" onClick={() => close()}>{t("Close")}</Button>
        </Tooltip>
      </Group>
      {notices.length > 0 && (
        <Alert color="yellow" py={6} radius={0}>
          {notices.map((n) => <Text size="sm" key={n}>{n}</Text>)}
          {goneNow.length > 0 && (
            <Anchor component="button" size="sm" onClick={() => setFile((f) => f && { ...f, cards: f.cards.filter((c) => !goneNow.some((g) => g.handle === c.handle)) })}>
              {goneNow.length === 1 ? t("Take it off the board") : t("Take them off the board")}
            </Anchor>
          )}
        </Alert>
      )}
      <Box style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <Box style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden" }}>
        <BoardCanvas
          skin={corkboardSkin}
          cards={cards}
          positions={positions}
          yarn={yarn}
          newYarn={newYarn}
          cutYarn={cutYarn}
          photoUrls={photoUrls}
          mapUrls={mapUrls}
          selection={selection}
          onSelect={(s) => {
            setSelection(s);
            setMenu(null);
          }}
          onMove={(h, to) => setFile((f) => f && { ...f, cards: f.cards.map((c) => (c.handle === h ? { ...c, x: to.x, y: to.y } : c)) })}
          onCycleSize={(h) => setFile((f) => f && { ...f, cards: f.cards.map((c) => (c.handle === h ? { ...c, size: NEXT_SIZE[c.size] } : c)) })}
          onPull={(from, to, at, screen) => {
            if (canSave) setMenu(to ? { kind: "connect", from, to, screen } : { kind: "new", from, at, screen });
            else notifications.show({ id: "board-view-only", message: t("Tying yarn needs Editor rights. You can still look around and arrange the board.") });
          }}
          canvasRef={(c) => (canvas.current = c)}
        />
        {!cards.length && (
          <Stack align="center" justify="center" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <Text style={{ pointerEvents: "auto", background: "var(--mantine-color-body)", padding: "8px 14px", borderRadius: 6, boxShadow: "0 2px 8px rgba(0,0,0,.3)" }}>
              {t("An empty board. Pin the people and records you're investigating with “Add…”.")}
            </Text>
          </Stack>
        )}
        {menuEl}
      </Box>
      <Box w={340} style={{ flexShrink: 0, borderLeft: "1px solid var(--mantine-color-default-border)", background: "var(--mantine-color-body)", minHeight: 0 }}>
        {selectedCard ? (
          <CardPanel key={selectedCard.handle}
            handle={selectedCard.handle}
            records={working}
            peek={peek}
            onBoard={onBoard}
            size={selectedCard.size}
            isDraft={!opened.base[selectedCard.handle]}
            readOnly={!canSave}
            onViewPhoto={selectedPhoto ? () => setLightbox(selectedPhoto.media) : undefined}
            inPhoto={inPhoto && inPhoto.media === selectedCard.handle
              ? inPhoto.regions && inPhoto.regions.map((r) => ({
                  cls: VIEW_CLASS[r.type] ?? "Person",
                  handle: r.handle,
                  label: r.label,
                  faceUrl: token ? mediaThumbnailUrl(selectedCard.handle, 96, token, { rect: r.rect }) : null,
                }))
              : undefined}
            onPinUpMany={(items) => void pinUpMany(items, selectedCard.handle, true)}
            onSize={(size) => setFile((f) => f && { ...f, cards: f.cards.map((c) => (c.handle === selectedCard.handle ? { ...c, size } : c)) })}
            onEdit={(edit) => editCard(selectedCard.handle, edit)}
            onPinUp={(cls, h) => void pinUp(cls, h, selectedCard.handle, true)}
            onShow={(h) => {
              setSelection({ kind: "card", id: h });
              canvas.current?.reveal([h]);
            }}
            onTakeOff={() => takeOff(selectedCard.handle)}
            onDiscard={() => discardDraft(selectedCard.handle)}
            onClose={() => setSelection(null)}
          />
        ) : selectedYarn ? (
          <YarnPanel
            yarn={selectedYarn}
            records={working}
            state={cutYarn.some((y) => y.id === selectedYarn.id) ? "cut" : newYarn.has(selectedYarn.id) ? "new" : "saved"}
            readOnly={!canSave}
            onSnip={() => snipYarn(selectedYarn)}
            onRetie={() => retie(selectedYarn)}
            onPullOut={() => pullOut(selectedYarn)}
            onClose={() => setSelection(null)}
          />
        ) : (
          <CaseNotesPanel
            file={file}
            changes={changes}
            questions={questions}
            records={working}
            canSave={canSave}
            onCaseField={(field, value) => setFile((f) => f && { ...f, [field]: value })}
            onTakeBack={(id) => void takeBackChange(id)}
            onShowChange={(c) => {
              const h = c.touches.find((x) => onBoard.has(x));
              if (h) {
                setSelection({ kind: "card", id: h });
                canvas.current?.reveal([h]);
              }
            }}
            onShow={(h) => {
              setSelection({ kind: "card", id: h });
              canvas.current?.reveal([h]);
            }}
            onSave={() => setSaveOpen(true)}
            onDownload={() => downloadCase(file, opened.base, changes.map((c) => c.label))}
            discussion={!opened.note ? "unsaved" : topic === null ? "loading" : topic !== "none" ? "open" : hasPermissions("AddObject") ? "none" : "cantStart"}
            onDiscuss={() => void discuss()}
          />
        )}
      </Box>
      </Box>
      {lightbox && (
        <ImageLightbox
          opened
          handle={lightbox}
          onClose={() => setLightbox(null)}
          regionAction="Pin"
          onRegion={(r) => void pinUpMany([{ cls: VIEW_CLASS[r.type] ?? "Person", handle: r.handle }], lightbox, true)}
        />
      )}
      <AddMenu
        opened={adding}
        onClose={() => setAdding(false)}
        onPick={(cls, h) => {
          setAdding(false);
          void pinUp(cls, h);
        }}
        onCreate={createLoose}
        canCreate={canSave}
      />
      <Modal opened={closeAsk} onClose={() => setCloseAsk(false)} title={t("Close the board?")} size="sm">
        <Stack>
          <Text size="sm">
            {changes.length
              ? t("{n} changes aren't saved yet.").replace("{n}", String(changes.length))
              : opened?.note
                ? t("Changes to the case file (its name, notes or layout) aren't saved yet.")
                : t("This case hasn't been saved yet.")}
          </Text>
          <Text size="xs" c="dimmed">{t("Discarding them can't be undone. Keeping them leaves them in this browser for next time.")}</Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="subtle" color="red" onClick={() => close("discard")}>{t("Discard changes")}</Button>
            <Button variant="default" onClick={() => close("keep")}>{t("Keep for later")}</Button>
            <Button
              onClick={() => {
                setCloseAsk(false);
                setSaveOpen(true);
              }}
            >
              {t("Save…")}
            </Button>
          </Group>
        </Stack>
      </Modal>
      <SaveDialog
        opened={saveOpen}
        changes={changes}
        layoutOnly={layoutChanged}
        saving={saving}
        onToggle={(id) => setChanges(toggleChange(changes, id))}
        onSave={save}
        onClose={() => {
          setChanges(changes.map((c) => ({ ...c, off: false })));
          setSaveOpen(false);
        }}
      />
    </Box>
  );
}

