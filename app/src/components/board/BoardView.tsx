// The Evidence Board page (#/board/<case>): one case file's board, a
// corkboard of records from the tree tied together with yarn
// (EVIDENCE_BOARD_PLAN.md, Phase 3). Everything here is staged as a "loose
// end" -- pinning up, tying or snipping yarn, editing, creating -- until
// Save, which writes the tree changes and the case file as one transaction
// (store/board/save.ts), with an Undo. Unsaved work is kept in this browser
// between visits (store/board/caseDraft.ts).
import { Alert, Anchor, Badge, Box, Button, Checkbox, Divider, Group, Paper, Title, Loader, Modal, Stack, Text, Tooltip, useComputedColorScheme } from "@mantine/core";
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
import { makeMainPhoto, newEvent, newNote, newPerson, newPlace, newRepository, newSource, removeMediaRef, setEventPlace, setEventType, setMediaRegion, setPersonName, type Region } from "../../store/board/links";
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
import { ImageLightbox } from "../related/ImageLightbox";
import { MediaRegionDialog } from "../related/MediaRegionDialog";
import { subjectsFromBacklinks, subjectsOnBoard, type PhotoSubject } from "../../store/board/faces";
import { buildFace, faceWhoLabel, type FaceWho } from "../../store/markFace";
import { hasPermissions } from "../../auth/auth";
import { BoardCanvas, stickyKey, type BoardCanvasHandle, type BoardSelection, type Point } from "./BoardCanvas";
import { createHandle } from "../../store/objectsApi";
import { LeadGuide, NEW_LEAD, type LeadActions, type LeadState } from "./LeadGuide";
import { addLeadEvent, addLeadPerson, addLeadRepository, addLeadSource, citeExistingEvent, setLeadRole } from "../../store/board/lead";
import { uploadMediaFiles } from "../../store/addMedia";
import { deleteObject } from "../../store/objectsApi";
import { getHomePersonHandle, setHomePersonHandle } from "../../store/homePersonPreference";
import { AddMenu, CardPanel, PanelFrame, StickyPanel, CaseNotesPanel, CLASS_LABEL, FloatingMenu, InlineText, MenuChoice, RelationPanel, SaveDialog, YarnPanel, type CardEdit, type OpenQuestion } from "./BoardPanels";
import { pathCards } from "../../store/board/relationPath";
import type { PathStep } from "../../store/relationshipPath";
import { cleanUp } from "./cleanUp";
import { TreeMark } from "./TreeMark";
import caseBoardIcon from "../../assets/icons/case-board.svg";
import { STORAGE_KEYS } from "../../store/storageKeys";
import boardCss from "./board.module.css";
import { downloadCase } from "../../store/board/caseExport";
import { corkboardSkin } from "./corkboard/corkboardSkin";
import type { CardView } from "./skin";

/** A view key (as region and search results name types) to its class. */
/** The board's typewriter face (bundled by the corkboard skin), for its own headings. */
const BOARD_TYPEWRITER = '"Special Elite", "Courier Prime", "Courier New", monospace';

const SIDEBAR_DEFAULT = 340;
const SIDEBAR_MIN = 260;
/** Never wider than this share of the window, so the cork stays usable. */
const SIDEBAR_MAX_SHARE = 0.6;
const clampSidebar = (w: number) => Math.round(Math.max(SIDEBAR_MIN, Math.min(w, window.innerWidth * SIDEBAR_MAX_SHARE)));

function readSidebarWidth(): number {
  try {
    const w = Number(localStorage.getItem(STORAGE_KEYS.boardSidebarWidth));
    return w > 0 ? clampSidebar(w) : SIDEBAR_DEFAULT;
  } catch {
    return SIDEBAR_DEFAULT;
  }
}

/** null forgets it (back to the default). */
function writeSidebarWidth(w: number | null) {
  try {
    if (w === null) localStorage.removeItem(STORAGE_KEYS.boardSidebarWidth);
    else localStorage.setItem(STORAGE_KEYS.boardSidebarWidth, String(w));
  } catch {
    /* storage unavailable: the width just isn't remembered */
  }
}

const VIEW_CLASS: Record<string, GrampsClass> = {
  person: "Person", family: "Family", event: "Event", place: "Place", source: "Source",
  citation: "Citation", repository: "Repository", media: "Media", note: "Note",
};

/** One way to start, on the empty board's card. */
function EmptyChoice({ title, text, onClick }: { title: string; text: string; onClick: () => void }) {
  return (
    <Button variant="default" onClick={onClick} h="auto" py={8} justify="flex-start" styles={{ label: { whiteSpace: "normal", textAlign: "left", display: "block" } }}>
      <Text fw={600} size="sm">{title}</Text>
      <Text size="xs" c="dimmed" fw={400}>{text}</Text>
    </Button>
  );
}

/** Deletes files the guide uploaded for a case that's being discarded. */
async function deleteUploaded(handles: string[]) {
  const token = await getToken();
  let failed = 0;
  for (const h of handles) {
    try {
      await deleteObject(token, MEDIA_VIEW, h);
    } catch {
      failed++;
    }
  }
  getViewStore(MEDIA_VIEW.key).requeryDebounced();
  if (failed) notifications.show({ color: "red", message: t("{n} uploaded files couldn't be deleted. They're still in Media.").replace("{n}", String(failed)) });
}

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
  const [lightbox, setLightbox] = useState<{ media: string } | null>(null);
  /** The sidebar's width (dragged at its left edge; remembered in this browser). */
  const [sidebarW, setSidebarW] = useState(readSidebarWidth);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const sidebarDrag = useRef<{ x: number; w: number } | null>(null);
  /** "Got a lead?" in progress, if any. */
  const [lead, setLead] = useState<LeadState | null>(null);
  const [home, setHome] = useState<string | null>(() => getHomePersonHandle());
  /** Files uploaded for this case in this session (the guide's scans):
   * already in the tree, so Discard offers to delete them. */
  const uploaded = useRef<string[]>([]);
  const [deleteUploads, setDeleteUploads] = useState(true);
  /** Bumped by Save and Undo, so relationship searches run on the new tree. */
  const [treeRevision, setTreeRevision] = useState(0);
  /** Who the tree has in the selected photo (null while loading); the
   * sidebar shows it with the board's unsaved changes laid over. */
  const [inPhoto, setInPhoto] = useState<{ media: string; subjects: PhotoSubject[] | null } | null>(null);
  /** The face being marked: whose, in which photo, and where it was. */
  const [faceEdit, setFaceEdit] = useState<{ person: string; media: string; rect: number[] | null } | null>(null);
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
        ? await openUnsavedCase(`new:${key}`, t("New case file"), getCurrentUsername() ?? "")
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
  const dirty = changes.length > 0 || layoutChanged || (!!opened && !opened.note && !!(file?.cards.length || file?.stickies.length));
  useEffect(() => {
    if (!opened || !file) return;
    const timer = setTimeout(() => {
      if (dirty && !discarded.current) writeDraft(opened.caseKey, draftOf(opened, file, changes));
    }, 300);
    return () => clearTimeout(timer);
  }, [opened, file, changes, dirty]);

  // --- staging loose ends -------------------------------------------------------------
  /** Stages one user action. `merge`: an edit that may replace the last loose
   * end if that was the same edit (typing a name twice is one loose end).
   * `justLoaded`: records loadIntoBase() fetched in this same click, which
   * `opened.base` won't show until the next render. */
  const stage = useCallback(
    (label: string, build: (b: ChangeBuilder) => void, merge = false, justLoaded: Records = {}) => {
      if (!opened) return null;
      const base = merge && changes.length && changes[changes.length - 1].label === label ? changes.slice(0, -1) : changes;
      const b = new ChangeBuilder(applyChanges({ ...justLoaded, ...opened.base }, base));
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

  /** Makes sure the board has `items` loaded (so it can change them or pin
   * them up): the ones it doesn't have yet are fetched and added to the
   * records it loaded. Resolves to all of them that exist. */
  async function loadIntoBase(items: { cls: GrampsClass; handle: string }[], fetched: Records = {}): Promise<Records> {
    const loaded: Records = {};
    const missing: typeof items = [];
    for (const i of items) {
      const known = working[i.handle] ?? peek[i.handle] ?? fetched[i.handle];
      if (known) loaded[i.handle] = known;
      else missing.push(i);
    }
    for (const cls of GRAMPS_CLASSES) {
      const hs = missing.filter((i) => i.cls === cls).map((i) => i.handle);
      if (hs.length) Object.assign(loaded, await loadRecords(cls, hs));
    }
    if (items.some((i) => !loaded[i.handle])) notifications.show({ color: "red", message: t("That record isn't in the tree any more, or you can't see it.") });
    const newToBase = Object.fromEntries(items.filter((i) => loaded[i.handle] && !working[i.handle]).map((i) => [i.handle, loaded[i.handle]]));
    if (Object.keys(newToBase).length) setOpened((o) => o && { ...o, base: { ...o.base, ...newToBase } });
    return loaded;
  }

  // --- faces in photos ------------------------------------------------------------
  const photoTitle = (media: string) => `“${titleOf(media, { ...peek, ...working }) || t("the photo")}”`;

  /** Opens the face editor for `person` in photo `media` (which also adds
   * them to the photo, once the face is marked). */
  async function openFace(person: string, media: string) {
    const loaded = await loadIntoBase([{ cls: "Person", handle: person }]);
    const r = loaded[person];
    if (!r) return;
    const ref = (Array.isArray(r.media_list) ? (r.media_list as { ref?: string; rect?: number[] | null }[]) : []).find((m) => m.ref === media);
    setFaceEdit({ person, media, rect: ref?.rect ?? null });
  }

  function saveFace(person: string, media: string, rect: number[] | null) {
    const who = titleOf(person, working);
    stage(
      rect ? `${t("Identified")}: ${who}, ${photoTitle(media)}` : `${t("Box removed")}: ${who}, ${photoTitle(media)}`,
      (b) => setMediaRegion(b, person, media, rect as Region | null),
    );
  }

  async function notInPhoto(person: string, media: string) {
    const loaded = await loadIntoBase([{ cls: "Person", handle: person }]);
    if (!loaded[person]) return;
    stage(`${t("Not in the photo")}: ${titleOf(person, loaded)}, ${photoTitle(media)}`, (b) => removeMediaRef(b, person, media), false, loaded);
  }

  /** A box drawn in the full-size view and named: an existing person
   * (loaded first, if need be) or a new one, who gets a card by the photo. */
  async function addFace(media: string, rect: number[], who: FaceWho) {
    const loaded = "handle" in who ? await loadIntoBase([{ cls: "Person", handle: who.handle }]) : {};
    if ("handle" in who && !loaded[who.handle]) return;
    let person = "";
    const label = "handle" in who ? titleOf(who.handle, loaded) : faceWhoLabel(who);
    const change = stage(`${t("Identified")}: ${label}, ${photoTitle(media)}`, (b) => {
      person = buildFace(b, media, rect, who);
    }, false, loaded);
    if (change && opened && change.creates.includes(person)) {
      const near = positions[media] ?? positions[selectedHandle ?? ""];
      pinMadeAlongTheWay([person], [near ? { x: near.x + 220, y: near.y } : canvas.current?.center() ?? { x: 0, y: 0 }], applyChanges(opened.base, [...changes, change]));
    }
  }

  // --- two people: how they're related --------------------------------------------
  /** Ctrl/Cmd+click on a person while a person is selected selects both;
   * anything else selects as usual. */
  function withSecondPerson(s: BoardSelection, additive?: boolean): BoardSelection {
    if (!additive || s?.kind !== "card" || working[s.id]?._class !== "Person") return s;
    const first = selection?.kind === "card" ? selection.id : selection?.kind === "pair" ? selection.ids[0] : null;
    if (!first || first === s.id || working[first]?._class !== "Person") return s;
    return { kind: "pair", ids: [first, s.id] };
  }

  /** Pins everyone on a relationship path, with the families joining them,
   * in a line between its two ends (already on the board). Cards only: the
   * tree doesn't change. */
  async function pinPath(steps: PathStep[]) {
    if (!file) return;
    const people = await loadIntoBase(steps.map((st) => ({ cls: "Person" as GrampsClass, handle: st.handle })));
    const cards = pathCards(steps, { ...working, ...people });
    const families = await loadIntoBase(cards.filter((c) => c.cls === "Family"));
    const records = { ...working, ...people, ...families };
    const a = positions[steps[0].handle];
    const b = positions[steps[steps.length - 1].handle];
    if (!a || !b) return;
    const n = Math.max(1, cards.length - 1);
    const fresh = cards
      .map((c, i) => ({ c, at: { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n } }))
      .filter(({ c }) => records[c.handle] && !file.cards.some((x) => x.handle === c.handle));
    if (!fresh.length) {
      canvas.current?.reveal(cards.map((c) => c.handle));
      return;
    }
    addCards(fresh.map(({ c, at }) => cardFor(c.handle, c.cls, at, records)));
  }

  // --- "Got a lead?" ---------------------------------------------------------------
  /** Pins records a guide step made or used, around card `anchor` (or the
   * middle of the screen), at the given offsets. */
  function pinAround(change: Change | null, spots: [string | null | undefined, number, number][], anchor: string | null, justLoaded: Records = {}) {
    if (!opened) return;
    const records = applyChanges({ ...justLoaded, ...opened.base }, change ? [...changes, change] : changes);
    const a = (anchor && positions[anchor]) || canvas.current?.center() || { x: 0, y: 0 };
    addCards(spots.filter(([h]) => h && records[h]).map(([h, dx, dy]) => cardFor(h!, records[h!]._class, { x: a.x + dx, y: a.y + dy }, records)));
  }
  const leadDoc = () => ({ media: lead?.media ?? null, citation: lead?.citation ?? null });
  const leadAnchor = () => lead?.citation ?? lead?.media ?? lead?.source ?? null;

  const leadActions: LeadActions = {
    async onFile(f) {
      const [media] = await uploadMediaFiles([f]);
      if (!media) return;
      uploaded.current.push(media);
      getViewStore(MEDIA_VIEW.key).requeryDebounced();
      notifications.show({ color: "green", message: t("Added to the tree's Media: {name}").replace("{name}", f.name) });
      const loaded = await loadIntoBase([{ cls: "Media", handle: media }]);
      pinAround(null, [[media, -240, -120]], null, loaded);
      setLead((l) => l && { ...l, media, step: "what" });
    },
    onWhat(title) {
      let made = { source: "", citation: "" };
      const change = stage(`${t("New source")}: ${title}`, (b) => {
        made = addLeadSource(b, title, lead?.media ?? null);
      });
      if (!change) return;
      pinAround(change, [[made.source, 260, 0], [made.citation, 260, 240]], lead?.media ?? null);
      setLead((l) => l && { ...l, title, source: made.source, citation: made.citation, step: "where" });
    },
    async onWhere(repo) {
      const source = lead?.source;
      if (!source) return setLead((l) => l && { ...l, step: "who" });
      const loaded = "handle" in repo ? await loadIntoBase([{ cls: "Repository", handle: repo.handle }]) : {};
      let made = "";
      const change = stage(`${t("Kept at")}: ${"handle" in repo ? titleOf(repo.handle, loaded) : repo.name}`, (b) => {
        made = addLeadRepository(b, source, repo);
      }, false, loaded);
      pinAround(change, [[made, 520, 0]], source, loaded);
      setLead((l) => l && { ...l, step: "who" });
    },
    async onPerson(who) {
      const loaded = "handle" in who ? await loadIntoBase([{ cls: "Person", handle: who.handle }]) : {};
      if ("handle" in who && !loaded[who.handle]) return;
      let person = "";
      const name = "handle" in who ? titleOf(who.handle, loaded) : [who.first, who.surname].filter(Boolean).join(" ");
      const change = stage(`${t("In")} “${lead?.title || t("the document")}”: ${name}`, (b) => {
        person = addLeadPerson(b, leadDoc(), who);
      }, false, loaded);
      if (!person && "handle" in who) person = who.handle;
      if (!person) return;
      const n = lead?.people.length ?? 0;
      pinAround(change, [[person, -260 + 220 * (n % 3), 260 + 220 * Math.floor(n / 3)]], leadAnchor(), loaded);
      const isNew = !("handle" in who);
      setLead((l) => l && { ...l, people: [...l.people, person], newPeople: isNew ? [...l.newPeople, person] : l.newPeople });
    },
    async onRelate(person, choice, label, recs) {
      if (choice) {
        // Tying someone in needs their relatives' records (and families) on the board.
        const items = Object.values(recs).filter((r) => (r._class === "Person" || r._class === "Family") && !working[r.handle]).map((r) => ({ cls: r._class, handle: r.handle }));
        const loaded = items.length ? await loadIntoBase(items, recs) : {};
        const change = stage(`${titleOf(person, working)}: ${label}`, choice.build, false, loaded);
        if (change && opened) pinMadeAlongTheWay(change.creates, [positions[person] ?? canvas.current?.center() ?? { x: 0, y: 0 }], applyChanges({ ...loaded, ...opened.base }, [...changes, change]));
      }
      setLead((l) => l && { ...l, rels: { ...l.rels, [person]: label } });
    },
    async onEvent({ occasion, who1, who2, existing, date, place, otherName, records: recs }) {
      const wedding = occasion.type === "MARRIAGE";
      const need: { cls: GrampsClass; handle: string }[] = [];
      for (const h of [who1, wedding ? who2 : null]) {
        if (!h) continue;
        need.push({ cls: "Person", handle: h });
        for (const f of Array.isArray(recs[h]?.family_list) ? (recs[h].family_list as string[]) : []) need.push({ cls: "Family", handle: f });
      }
      if (existing) {
        need.push({ cls: "Event", handle: existing.event });
        if (existing.family) need.push({ cls: "Family", handle: existing.family });
      }
      if (place && "handle" in place) need.push({ cls: "Place", handle: place.handle });
      const loaded = await loadIntoBase(need, recs);
      const eventPeople = wedding ? [who1, who2].filter((h): h is string => !!h) : who1 ? [who1] : [];
      const whoNames = eventPeople.map((h) => titleOf(h, { ...loaded, ...working })).join(" & ");
      let event = "";
      let spots: [string | undefined, number, number][] = [];
      let change;
      if (existing) {
        event = existing.event;
        change = stage(`${t("Evidence for")}: ${titleOf(event, loaded)}`, (b) => citeExistingEvent(b, event, leadDoc()), false, loaded);
        spots = [[event, 260, 30], [existing.family, 260, -220]];
      } else {
        let made: { event: string; family?: string; place?: string } = { event: "" };
        change = stage(`${t("New")} ${t(occasion.label).toLowerCase()}${whoNames ? `: ${whoNames}` : ""}`, (b) => {
          made = addLeadEvent(b, leadDoc(), occasion, { who1, who2: wedding ? who2 : null, date, place, otherName });
        }, false, loaded);
        event = made.event;
        spots = [[made.event, 260, 30], [made.place, 520, 30], [made.family, 260, -220]];
      }
      if (!event) return;
      pinAround(change ?? null, spots, leadAnchor(), loaded);
      const others = (lead?.people ?? []).filter((h) => !eventPeople.includes(h));
      setLead((l) => l && { ...l, event, eventPeople, step: others.length ? "roles" : "done" });
    },
    onRole(person, role) {
      const event = lead?.event;
      if (!event) return;
      stage(`${titleOf(person, working)} ${t("was")} ${t(role.phrase)}: ${titleOf(event, { ...peek, ...working })}`, (b) => setLeadRole(b, person, event, role, !!lead?.roles[person]));
      setLead((l) => l && { ...l, roles: { ...l.roles, [person]: role.label } });
    },
    onHome(h) {
      setHomePersonHandle(h);
      setHome(h);
    },
    onSave: () => setSaveOpen(true),
    onStep: (step) => setLead((l) => l && { ...l, step }),
    onAnother: () => setLead({ ...NEW_LEAD }),
    onClose: () => setLead(null),
  };

  /** A new, empty sticky note near the middle of the screen, selected so
   * it can be written straight away. */
  function addSticky() {
    setAdding(false);
    const c = canvas.current?.center() ?? { x: 0, y: 0 };
    const id = createHandle();
    setFile((f) => f && { ...f, stickies: [...f.stickies, { id, text: "", x: c.x + (f.stickies.length % 4) * 24, y: c.y - 80 + (f.stickies.length % 4) * 24 }] });
    setLead(null);
    setSelection({ kind: "sticky", id });
  }

  function mainPhoto(person: string, media: string) {
    stage(`${t("Photo on the card")}: ${titleOf(person, working)} → ${photoTitle(media)}`, (b) => makeMainPhoto(b, person, media));
  }

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
    const loaded = await loadIntoBase(fresh);
    const found = fresh.filter((i) => loaded[i.handle]);
    if (!found.length) return;
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
    notifications.show({ message: t("Unpinned. Nothing in the tree changed.") });
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
  // The photo shown full size, else the selected photo card.
  const photoInView = lightbox?.media ?? (selectedIsPhoto ? selectedHandle : null);
  useEffect(() => {
    if (!photoInView) {
      setInPhoto(null);
      return;
    }
    const media = photoInView;
    setInPhoto({ media, subjects: null });
    const controller = new AbortController();
    (async () => {
      try {
        const detail = await fetchObjectExtended(await getToken(), MEDIA_VIEW, media, controller.signal);
        setInPhoto({ media, subjects: subjectsFromBacklinks(detail, media) });
      } catch {
        if (!controller.signal.aborted) setInPhoto({ media, subjects: [] });
      }
    })();
    return () => controller.abort();
  }, [photoInView]);

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
      if (deleteUploads && uploaded.current.length) void deleteUploaded(uploaded.current.splice(0));
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
      setTreeRevision((n) => n + 1);
      // Saved records may use the files uploaded so far: Discard no longer offers to delete them.
      uploaded.current = [];
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
                    setTreeRevision((n) => n + 1);
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
  const selectedSticky = selection?.kind === "sticky" ? file.stickies.find((n) => n.id === selection.id) : undefined;
  const selectedPair = selection?.kind === "pair" && selection.ids.every((h) => working[h]) ? selection.ids : undefined;
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
        <Group gap={6} wrap="nowrap">
          <img src={caseBoardIcon} width={20} height={20} alt="" />
          <Text fz="lg" style={{ whiteSpace: "nowrap", fontFamily: BOARD_TYPEWRITER }}>{t("Evidence Board")}</Text>
        </Group>
        <Divider orientation="vertical" />
        <Text size="sm" c="dimmed" style={{ whiteSpace: "nowrap" }}>{t("Case file")}:</Text>
        <InlineText strong value={file.name} placeholder="Name this case" readOnly={!canSave} onCommit={(v) => setFile((f) => f && { ...f, name: v })} />
        <InlineText value={file.question} placeholder="What are you trying to find out?" readOnly={!canSave} onCommit={(v) => setFile((f) => f && { ...f, question: v })} />
        <Box style={{ flex: 1 }} />
        {canSave && <Button size="xs" variant="default" onClick={() => setLead({ ...NEW_LEAD })}>{t("Got a lead?")}</Button>}
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
              {goneNow.length === 1 ? t("Unpin it") : t("Unpin them")}
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
          onSelect={(s, additive) => {
            setSelection(withSecondPerson(s, additive));
            setMenu(null);
          }}
          stickies={file.stickies}
          onMove={(h, to) =>
            setFile((f) => f && (h.startsWith("sticky:")
              ? { ...f, stickies: f.stickies.map((n) => (stickyKey(n.id) === h ? { ...n, x: to.x, y: to.y } : n)) }
              : { ...f, cards: f.cards.map((c) => (c.handle === h ? { ...c, x: to.x, y: to.y } : c)) }))}
          onCycleSize={(h) => setFile((f) => f && { ...f, cards: f.cards.map((c) => (c.handle === h ? { ...c, size: NEXT_SIZE[c.size] } : c)) })}
          onPull={(from, to, at, screen) => {
            if (canSave) setMenu(to ? { kind: "connect", from, to, screen } : { kind: "new", from, at, screen });
            else notifications.show({ id: "board-view-only", message: t("Tying yarn needs Editor rights. You can still look around and arrange the board.") });
          }}
          canvasRef={(c) => (canvas.current = c)}
        />
        {!cards.length && !file.stickies.length && !lead && (
          <Stack align="center" justify="center" p="md" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <Paper shadow="lg" p="lg" maw={470} style={{ pointerEvents: "auto", transform: "rotate(-0.8deg)" }}>
              <Title order={3} mb={6} fw={400} style={{ fontFamily: BOARD_TYPEWRITER }}>{t("New case file")}</Title>
              <Text size="sm" c="dimmed" mb="md">
                {canSave
                  ? t("Pin the people and records you're investigating, tie them together with yarn, and save when the case holds up. Nothing goes into the tree until then.")
                  : t("Pin the people and records you're investigating and arrange them. Your board is kept in this browser.")}
              </Text>
              <Stack gap="xs">
                <EmptyChoice title={t("Find someone in the tree")} text={t("Pin the people, events and sources you're working on.")} onClick={() => setAdding(true)} />
                {canSave && <EmptyChoice title={t("Got a lead?")} text={t("A photo or a certificate. A few questions turn it into records that cite it.")} onClick={() => setLead({ ...NEW_LEAD })} />}
              </Stack>
            </Paper>
          </Stack>
        )}
        {menuEl}
      </Box>
      <Box w={sidebarW} style={{ position: "relative", flexShrink: 0, borderLeft: "1px solid var(--mantine-color-default-border)", background: "var(--mantine-color-body)", minHeight: 0 }}>
        {/* The divider: an 8px strip over the border (like the main
            window's list/details divider), dragged with pointer capture;
            double-click puts it back. */}
        <Box
          aria-label={t("Drag to resize the sidebar")}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            sidebarDrag.current = { x: e.clientX, w: sidebarW };
            setSidebarResizing(true);
          }}
          onPointerMove={(e) => {
            const d = sidebarDrag.current;
            if (d) setSidebarW(clampSidebar(d.w + d.x - e.clientX));
          }}
          onPointerUp={() => {
            sidebarDrag.current = null;
            setSidebarResizing(false);
            writeSidebarWidth(sidebarW);
          }}
          onPointerCancel={() => {
            sidebarDrag.current = null;
            setSidebarResizing(false);
          }}
          onDoubleClick={() => {
            setSidebarW(SIDEBAR_DEFAULT);
            writeSidebarWidth(null);
          }}
          style={{
            position: "absolute", insetBlock: 0, left: -4, width: 8, zIndex: 5,
            cursor: "col-resize", touchAction: "none",
            background: sidebarResizing ? "var(--mantine-color-blue-4)" : "transparent",
          }}
        />
        {lead ? (
          <PanelFrame eyebrow={t("Got a lead?")} title={lead.title || t("A new lead")} onClose={() => setLead(null)}>
            <LeadGuide lead={lead} records={{ ...peek, ...working }} home={home} actions={leadActions} />
          </PanelFrame>
        ) : selectedCard ? (
          <CardPanel key={selectedCard.handle}
            handle={selectedCard.handle}
            records={working}
            peek={peek}
            onBoard={onBoard}
            size={selectedCard.size}
            isDraft={!opened.base[selectedCard.handle]}
            readOnly={!canSave}
            onViewPhoto={selectedPhoto ? () => setLightbox({ media: selectedPhoto.media }) : undefined}
            // A person's card shows just the area identified as them, when there is one.
            photoUrl={selectedPhoto && token ? mediaThumbnailUrl(selectedPhoto.media, 640, token, { rect: selectedPhoto.rect }) : null}
            inPhoto={inPhoto && inPhoto.media === selectedCard.handle
              ? inPhoto.subjects && subjectsOnBoard(inPhoto.subjects, working, inPhoto.media)
              : undefined}
            faceUrl={(media, rect) => (token && rect ? mediaThumbnailUrl(media, 96, token, { rect }) : null)}
            onFace={(person, media) => void openFace(person, media)}
            onNotInPhoto={(person, media) => void notInPhoto(person, media)}
            onMainPhoto={mainPhoto}
            relatives={working[selectedCard.handle]?._class === "Person"
              ? cards.filter((c) => c.cls === "Person" && c.handle !== selectedCard.handle).map((c) => ({ value: c.handle, label: c.title }))
              : undefined}
            onRelate={(other) => setSelection({ kind: "pair", ids: [selectedCard.handle, other] })}
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
        ) : selectedSticky ? (
          <StickyPanel
            key={selectedSticky.id}
            text={selectedSticky.text}
            onText={(text) => setFile((f) => f && { ...f, stickies: f.stickies.map((n) => (n.id === selectedSticky.id ? { ...n, text } : n)) })}
            onRemove={() => {
              setFile((f) => f && { ...f, stickies: f.stickies.filter((n) => n.id !== selectedSticky.id) });
              setSelection(null);
            }}
            onClose={() => setSelection(null)}
          />
        ) : selectedPair ? (
          <RelationPanel
            key={selectedPair.join("|")}
            from={selectedPair[0]}
            to={selectedPair[1]}
            records={working}
            revision={treeRevision}
            unsaved={changes.some((c) => !c.off)}
            onPinPath={(steps) => void pinPath(steps)}
            onPinUp={(h) => void pinUp("Person", h, selectedPair[0], true)}
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
          handle={lightbox.media}
          onClose={() => setLightbox(null)}
          regionAction="Pin"
          onRegion={(r) => void pinUpMany([{ cls: VIEW_CLASS[r.type] ?? "Person", handle: r.handle }], lightbox.media, true)}
          faces={canSave ? {
            // The board's own list, so faces marked here but not saved show too.
            regions: inPhoto?.media === lightbox.media && inPhoto.subjects
              ? subjectsOnBoard(inPhoto.subjects, working, lightbox.media)
                  .filter((p) => p.rect)
                  .map((p) => ({ type: p.cls.toLowerCase(), handle: p.handle, label: p.label, rect: p.rect! }))
              : undefined,
            known: Object.values(working).filter((x) => x._class === "Person" && onBoard.has(x.handle)).map((x) => ({ value: x.handle, label: titleOf(x.handle, working) })),
            saveIcon: <TreeMark />,
            onAdd: (rect, who) => addFace(lightbox.media, rect, who),
          } : undefined}
        />
      )}
      {faceEdit && (
        <MediaRegionDialog
          opened
          handle={faceEdit.media}
          initialRect={faceEdit.rect}
          onClose={() => setFaceEdit(null)}
          title={t("Identify {name} in this photo").replace("{name}", titleOf(faceEdit.person, working))}
          hint={t("Drag a box around their face. Drag the box to move it, or its corners to resize it.")}
          saveLabel={t("Use this box")}
          saveIcon={<TreeMark />}
          clearLabel={t("Remove the box")}
          onSave={(rect) => saveFace(faceEdit.person, faceEdit.media, rect)}
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
        onSticky={addSticky}
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
          {uploaded.current.length > 0 && (
            <Checkbox
              size="xs"
              checked={deleteUploads}
              onChange={(e) => setDeleteUploads(e.currentTarget.checked)}
              label={uploaded.current.length === 1 ? t("When discarding, also delete the file uploaded for this case") : t("When discarding, also delete the {n} files uploaded for this case").replace("{n}", String(uploaded.current.length))}
            />
          )}
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

