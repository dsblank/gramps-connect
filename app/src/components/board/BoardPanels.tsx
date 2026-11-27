// The Evidence Board's panels and menus: the connection menu where yarn is
// dropped, the card and yarn panels on the right, Case notes, the Save
// dialog and the Add menu. All of them only report what the user chose;
// BoardView stages it as a loose end.
import { ActionIcon, Anchor, Badge, Box, Menu, Tooltip, UnstyledButton, Button, Checkbox, CloseButton, Divider, Group, Loader, Modal, MultiSelect, Paper, ScrollArea, SegmentedControl, Select, Stack, Text, Textarea, TextInput, Title } from "@mantine/core";
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { parseCoords } from "../../store/visualData";
import { formatHash } from "../../hash";
import { getToken } from "../../auth/auth";
import { t } from "../../i18n/i18n";
import type { Change } from "../../store/board/changes";
import type { CardSize, CaseFile } from "../../store/board/caseFile";
import { GENDER, type GrampsClass, type GrampsRecord, type Records } from "../../store/board/records";
import { associationsOf, evidenceOf, leadsOf, shortDate, titleOf, typeName, unprovenEventsOf, whatsMissing, type Yarn } from "../../store/board/view";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { DateInput } from "../DateInput";
import shapes from "../../data/grampsRecordShapes.json";
import { fetchSearch, type SearchHit } from "../../store/searchApi";
import { summaryLine } from "../related/summary";
import { useApiImageSrc } from "../../store/apiImage";
import { snippetFor } from "../visuals/searchSnippet";
import { TreeMark } from "./TreeMark";
import { useListSearch } from "../../store/listSearch";
import { PLACE_VIEW } from "../../store/views";
import { pickerResultLabel } from "../RefPickerField";
import { photosOf, type PhotoSubject } from "../../store/board/faces";
import { useRelationshipPaths } from "../../store/relationshipPathsApi";
import { openRelationshipWindow } from "../../store/relationshipWindow";
import { openExternalSearchWindow } from "../../store/externalSearchWindow";
import { boardSearchTerms } from "../../store/board/searchTerms";
import type { ObjectDetail } from "../../store/objectDetail";
import type { PathStep } from "../../store/relationshipPath";
import { RelationshipBetween } from "../related/RelationshipBetween";

export const CLASS_LABEL: Record<GrampsClass, string> = {
  Person: "Person", Family: "Family", Event: "Event", Place: "Place", Source: "Source",
  Citation: "Citation", Repository: "Repository", Media: "Photo or document", Note: "Note",
};
/** The card panel's link to the record's own list view (same wording as
 * the Gramplet object buttons). A plain link, so Ctrl/⌘-click opens a tab. */
const OPEN_IN: Record<GrampsClass, string> = {
  Person: "Open in People", Family: "Open in Family", Event: "Open in Events", Place: "Open in Places", Source: "Open in Sources",
  Citation: "Open in Citations", Repository: "Open in Repositories", Media: "Open in Media", Note: "Open in Notes",
};
const SEARCH_TYPE: Record<string, GrampsClass> = {
  person: "Person", family: "Family", event: "Event", place: "Place", source: "Source",
  citation: "Citation", repository: "Repository", media: "Media", note: "Note",
};

const PlaceMiniMap = lazy(() => import("./PlaceMiniMap"));
const NEW_PLACE = "\u0000new";

/** An event's place: one already known to the board, or one found in the
 * tree as you type, or a new one by that name. Picking only sets the event's
 * place; the place card can be pinned up from the card's leads. */
export function EventPlacePicker({ value, all, readOnly, onPick, onNew }: {
  value: string | null;
  all: Records;
  readOnly?: boolean;
  onPick: (place: string | null, name: string) => void;
  onNew: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const currentLabel = value ? titleOf(value, all) || t("Place") : "";
  // The Places list's own search, as in every other picker.
  const { items, loading } = useListSearch(PLACE_VIEW, query, { enabled: focused && query.trim() !== currentLabel });
  const found = items.map((item) => ({ value: item.handle, label: pickerResultLabel("place", item) }));
  const q = query.trim();
  const lower = q.toLowerCase();
  const known = Object.values(all)
    .filter((r) => r._class === "Place")
    .map((r) => ({ value: r.handle, label: titleOf(r.handle, all) || t("Place") }));
  const seen = new Set<string>();
  const data: { value: string; label: string }[] = [];
  const add = (o: { value: string; label: string }) => {
    if (seen.has(o.value)) return;
    seen.add(o.value);
    data.push(o);
  };
  if (value) add({ value, label: currentLabel });
  for (const o of known) if (!q || q === currentLabel || o.label.toLowerCase().includes(lower)) add(o);
  for (const o of found) add(o);
  if (q.length >= 2 && q !== currentLabel && !data.some((o) => o.label.toLowerCase() === lower)) {
    data.push({ value: NEW_PLACE, label: `${t("New place")}: ${q}` });
  }
  return (
    <Select
      label={t("Place")}
      placeholder={readOnly ? undefined : t("Type to find or add a place")}
      disabled={readOnly}
      searchable
      clearable
      value={value}
      data={data}
      searchValue={query}
      onSearchChange={setQuery}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      filter={({ options }) => options}
      nothingFoundMessage={q.length < 2 ? t("Type a place name") : loading ? t("Searching…") : t("No places found")}
      rightSection={loading ? <Loader size="xs" /> : undefined}
      onChange={(v) => {
        if (v === NEW_PLACE) onNew(q);
        else if (v !== value) onPick(v, v ? data.find((o) => o.value === v)?.label ?? "" : "");
      }}
    />
  );
}

/** A small floating panel on the board, at a screen point. */
export function FloatingMenu({ at, title, children, onClose }: { at: { x: number; y: number }; title: string; children: ReactNode; onClose: () => void }) {
  // Kept inside the board: moved left or up when it would run off an edge.
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x + 8, top: at.y + 8 });
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    const left = Math.max(8, Math.min(at.x + 8, parent.clientWidth - el.offsetWidth - 8));
    const top = Math.max(8, Math.min(at.y + 8, parent.clientHeight - el.offsetHeight - 8));
    setPos({ left, top });
  }, [at.x, at.y, children]);
  return (
    <Paper
      ref={ref}
      shadow="lg"
      withBorder
      p="xs"
      style={{ position: "absolute", left: pos.left, top: pos.top, width: 300, zIndex: 20, maxHeight: 420, overflow: "auto" }}
      data-nozoom
    >
      <Group justify="space-between" wrap="nowrap" mb={4}>
        <Text fw={600} size="sm">{title}</Text>
        <CloseButton size="sm" onClick={onClose} aria-label={t("Close")} />
      </Group>
      {children}
    </Paper>
  );
}

/** One choice in a floating menu. `changesTree`: choosing it stages a loose
 * end, so it carries the TreeMark. */
export function MenuChoice({ children, onClick, changesTree }: { children: ReactNode; onClick: () => void; changesTree?: boolean }) {
  return (
    <Button variant="subtle" justify="flex-start" fullWidth size="xs" onClick={onClick} rightSection={changesTree ? <TreeMark /> : undefined} styles={{ label: { whiteSpace: "normal", textAlign: "left", flex: 1 } }} h="auto" py={6}>
      {children}
    </Button>
  );
}

/** One panel of the sidebar beside the board. */
export function PanelFrame({ eyebrow, title, sub, onClose, children }: { eyebrow: string; title: string; sub?: string; onClose?: () => void; children: ReactNode }) {
  return (
    <Box style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" p="sm" pb={0}>
        <Box style={{ minWidth: 0 }}>
          <Text size="xs" fw={700} c="red.7" tt="uppercase" style={{ letterSpacing: ".14em" }}>{eyebrow}</Text>
          <Title order={4} style={{ overflowWrap: "anywhere" }}>{title}</Title>
          {sub && <Text size="xs" c="dimmed">{sub}</Text>}
        </Box>
        {onClose && (
          <Tooltip label={t("Back to the case notes")}>
            <CloseButton onClick={onClose} aria-label={t("Back to the case notes")} />
          </Tooltip>
        )}
      </Group>
      <ScrollArea style={{ flex: 1 }} p="sm">
        <Stack gap="sm">{children}</Stack>
      </ScrollArea>
    </Box>
  );
}

/** The card's photo, the width of the sidebar; clicking opens it full size. */
function SidebarPhoto({ url, onClick }: { url: string; onClick: () => void }) {
  const { src, onError } = useApiImageSrc(url);
  if (!src) return null;
  return (
    <UnstyledButton onClick={onClick} aria-label={t("View full size")} style={{ display: "block", lineHeight: 0 }}>
      <img src={src} onError={onError} alt="" style={{ width: "100%", maxHeight: 320, objectFit: "contain", borderRadius: 4, background: "var(--mantine-color-default-hover)" }} />
    </UnstyledButton>
  );
}

/** A crop of a photo to someone's face; a dashed "?" when no face is marked. */
function FaceThumb({ url, size = 32 }: { url: string | null; size?: number }) {
  const { src, onError } = useApiImageSrc(url);
  return src ? (
    <img src={src} onError={onError} alt="" width={size} height={size} style={{ objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />
  ) : (
    <Box w={size} h={size} title={t("Not identified in the photo yet")} style={{ flexShrink: 0, border: "1px dashed var(--mantine-color-dimmed)", borderRadius: 4, display: "grid", placeItems: "center" }}>
      <Text size="xs" c="dimmed">?</Text>
    </Box>
  );
}

/** Text in the toolbar that turns into a field when clicked (the case's
 * name and question). Enter or leaving it keeps the edit, Escape doesn't. */
export function InlineText({ value, placeholder, onCommit, readOnly, strong }: { value: string; placeholder: string; onCommit: (v: string) => void; readOnly?: boolean; strong?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  if (readOnly) {
    return value ? <Text fw={strong ? 600 : undefined} c={strong ? undefined : "dimmed"} size={strong ? undefined : "sm"}>{value}</Text> : null;
  }
  if (editing) {
    const done = (keep: boolean) => {
      setEditing(false);
      const next = v.trim();
      if (keep && next !== value && (next || !strong)) onCommit(next);
    };
    return (
      <TextInput
        size="xs"
        autoFocus
        value={v}
        placeholder={t(placeholder)}
        onChange={(e) => setV(e.currentTarget.value)}
        onBlur={() => done(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") done(true);
          if (e.key === "Escape") {
            e.stopPropagation();
            done(false);
          }
        }}
        w={strong ? 240 : 320}
        aria-label={t(placeholder)}
      />
    );
  }
  return (
    <Tooltip label={t("Click to change")} openDelay={500}>
      <UnstyledButton
        onClick={() => {
          setV(value);
          setEditing(true);
        }}
        style={{ borderBottom: "1px dashed var(--mantine-color-default-border)" }}
      >
        <Text fw={strong ? 600 : undefined} c={strong && value ? undefined : "dimmed"} size={strong ? undefined : "sm"} fs={value ? undefined : "italic"}>
          {value || t(placeholder)}
        </Text>
      </UnstyledButton>
    </Tooltip>
  );
}

/** A text field that reports its value when it loses focus (one loose end
 * per edit, not one per keystroke). */
function CommitField({ label, value, onCommit, multiline, readOnly }: { label: string; value: string; onCommit: (v: string) => void; multiline?: boolean; readOnly?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => v !== value && onCommit(v);
  return multiline ? (
    <Textarea label={label} value={v} readOnly={readOnly} onChange={(e) => setV(e.currentTarget.value)} onBlur={commit} autosize minRows={3} />
  ) : (
    <TextInput label={label} value={v} readOnly={readOnly} onChange={(e) => setV(e.currentTarget.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
  );
}

const EVENT_TYPES = Object.entries((shapes.type_names as Record<string, Record<string, string>>).EventType)
  .filter(([code]) => Number(code) > 0)
  .map(([, name]) => name)
  .sort();
const EVENT_TYPE_CODE: Record<string, string> = Object.fromEntries(
  Object.entries((shapes.types as Record<string, Record<string, number>>).EventType).map(([key, code]) => [
    (shapes.type_names as Record<string, Record<string, string>>).EventType[String(code)],
    key,
  ]),
);

/** The edits the card panel can make, staged by BoardView. */
export type CardEdit =
  | { kind: "personName"; first: string; surname: string }
  | { kind: "gender"; gender: number }
  | { kind: "field"; field: string; value: unknown; label: string }
  | { kind: "eventType"; typeKey: string | null; name: string }
  | { kind: "placeName"; name: string }
  | { kind: "eventDate"; date: GrampsDate | null }
  /** `place` null clears it; `name` is for the loose end's label. */
  | { kind: "eventPlace"; place: string | null; name: string }
  | { kind: "eventNewPlace"; name: string }
  | { kind: "noteText"; text: string };

export function CardPanel(props: {
  handle: string;
  records: Records;
  peek: Records;
  onBoard: Set<string>;
  size: CardSize;
  isDraft: boolean;
  /** The board has changes to this record that aren't saved to the tree yet. */
  changedHere?: boolean;
  /** View only: fields can't be changed (no Editor rights). */
  readOnly?: boolean;
  /** Shows the card's photo full screen, when it has one. */
  onViewPhoto?: () => void;
  /** That photo, sized for the sidebar. */
  photoUrl?: string | null;
  /** For a photo: who's in it (null while loading). */
  inPhoto?: PhotoSubject[] | null;
  /** A crop of photo `media` to `rect`, or null without a region. */
  faceUrl: (media: string, rect: number[] | null) => string | null;
  /** Opens the face editor (and adds the person to the photo on save). */
  onFace: (person: string, media: string) => void;
  onNotInPhoto: (person: string, media: string) => void;
  /** Makes `media` the photo on the person's card. */
  onMainPhoto: (person: string, media: string) => void;
  /** For a person: the other people on the board, for "How is … related to…?". */
  relatives?: { value: string; label: string }[];
  onRelate?: (other: string) => void;
  onPinUpMany: (items: { cls: GrampsClass; handle: string }[]) => void;
  onSize: (size: CardSize) => void;
  onEdit: (edit: CardEdit) => void;
  onPinUp: (cls: GrampsClass, handle: string) => void;
  onShow: (handle: string) => void;
  onTakeOff: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  const { handle, records, peek, onBoard, size, isDraft, changedHere, readOnly, onViewPhoto, photoUrl, inPhoto, faceUrl, onFace, onNotInPhoto, onMainPhoto, relatives, onRelate, onPinUpMany, onSize, onEdit, onPinUp, onShow, onTakeOff, onDiscard, onClose } = props;
  const r = records[handle];
  if (!r) return null;
  const all = { ...peek, ...records };
  const leads = leadsOf(r);
  const associations = associationsOf(r);
  const unproven = unprovenEventsOf(r, all);
  const missing = whatsMissing(r, all);
  const name = r.primary_name as { first_name?: string; surname_list?: { surname?: string }[] } | undefined;
  let fields: ReactNode = null;
  switch (r._class) {
    case "Person":
      fields = (
        <>
          <Group grow>
            <CommitField readOnly={readOnly} label={t("First name")} value={name?.first_name ?? ""} onCommit={(v) => onEdit({ kind: "personName", first: v, surname: name?.surname_list?.[0]?.surname ?? "" })} />
            <CommitField readOnly={readOnly} label={t("Surname")} value={name?.surname_list?.[0]?.surname ?? ""} onCommit={(v) => onEdit({ kind: "personName", first: name?.first_name ?? "", surname: v })} />
          </Group>
          <Select
            disabled={readOnly}
            label={t("Sex")}
            value={String(r.gender)}
            allowDeselect={false}
            data={[{ value: String(GENDER.FEMALE), label: t("Female") }, { value: String(GENDER.MALE), label: t("Male") }, { value: String(GENDER.UNKNOWN), label: t("Unknown") }]}
            onChange={(v) => v !== null && onEdit({ kind: "gender", gender: Number(v) })}
          />
        </>
      );
      break;
    case "Event": {
      const current = typeName(r.type, "EventType");
      fields = (
        <>
          <Select
            disabled={readOnly}
            label={t("Type")}
            value={current}
            searchable
            allowDeselect={false}
            data={[...new Set([current, ...EVENT_TYPES])].filter(Boolean).map((n) => ({ value: n, label: t(n) }))}
            onChange={(v) => v && onEdit({ kind: "eventType", typeKey: EVENT_TYPE_CODE[v] ?? null, name: v })}
          />
          <CommitField readOnly={readOnly} label={t("Description")} value={String(r.description ?? "")} onCommit={(v) => onEdit({ kind: "field", field: "description", value: v, label: "description" })} />
          {readOnly ? (
            <TextInput readOnly label={t("Date")} value={shortDate(r.date)} />
          ) : (
            <DateInput id={`board-${handle}-date`} label={t("Date")} value={(r.date as GrampsDate | undefined) ?? null} onChange={(date) => onEdit({ kind: "eventDate", date })} />
          )}
          <EventPlacePicker
            readOnly={readOnly}
            value={typeof r.place === "string" && r.place ? r.place : null}
            all={all}
            onPick={(place, placeName) => onEdit({ kind: "eventPlace", place, name: placeName })}
            onNew={(placeName) => onEdit({ kind: "eventNewPlace", name: placeName })}
          />
        </>
      );
      break;
    }
    case "Place": {
      // Coordinates aren't typed here (a map picker may come later); a
      // place that has them shows its map.
      const at = parseCoords(String(r.lat ?? ""), String(r.long ?? ""));
      fields = (
        <>
          <CommitField readOnly={readOnly} label={t("Name")} value={titleOf(handle, records)} onCommit={(v) => onEdit({ kind: "placeName", name: v })} />
          {at && (
            <>
              <Suspense fallback={<Loader size="xs" />}>
                <PlaceMiniMap lat={at[0]} long={at[1]} />
              </Suspense>
              {!isDraft && (
                <Anchor size="xs" href={formatHash({ viewKey: "map", subject: { type: "place", handle } })}>{t("Open in Maps")}</Anchor>
              )}
            </>
          )}
        </>
      );
      break;
    }
    case "Source":
      fields = (
        <>
          <CommitField readOnly={readOnly} label={t("Title")} value={String(r.title ?? "")} onCommit={(v) => onEdit({ kind: "field", field: "title", value: v, label: "title" })} />
          <CommitField readOnly={readOnly} label={t("Author")} value={String(r.author ?? "")} onCommit={(v) => onEdit({ kind: "field", field: "author", value: v, label: "author" })} />
        </>
      );
      break;
    case "Citation":
      fields = <CommitField readOnly={readOnly} label={t("Where in the source (page, entry)")} value={String(r.page ?? "")} onCommit={(v) => onEdit({ kind: "field", field: "page", value: v, label: "page" })} />;
      break;
    case "Repository":
      fields = <CommitField readOnly={readOnly} label={t("Name")} value={String(r.name ?? "")} onCommit={(v) => onEdit({ kind: "field", field: "name", value: v, label: "name" })} />;
      break;
    case "Media":
      fields = <CommitField readOnly={readOnly} label={t("Description")} value={String(r.desc ?? "")} onCommit={(v) => onEdit({ kind: "field", field: "desc", value: v, label: "description" })} />;
      break;
    case "Note":
      fields = <CommitField readOnly={readOnly} label={t("Text")} multiline value={String((r.text as { string?: string } | undefined)?.string ?? "")} onCommit={(v) => onEdit({ kind: "noteText", text: v })} />;
      break;
  }
  const evidence = evidenceOf(r, all);
  return (
    <PanelFrame eyebrow={t("Case file")} title={titleOf(handle, records)} sub={`${t(CLASS_LABEL[r._class])} · ${r.gramps_id || t("draft, not saved yet")}`} onClose={onClose}>
      <Group gap="xs" wrap="nowrap">
        <SegmentedControl
          size="xs"
          value={size}
          onChange={(v) => onSize(v as CardSize)}
          data={[{ value: "icon", label: t("Icon") }, { value: "compact", label: t("Card") }, { value: "expanded", label: t("Dossier") }]}
        />
        <Tooltip label={t("Unpinning a card never changes the tree.")} openDelay={400} withArrow>
          <Button size="xs" variant="default" onClick={onTakeOff}>{t("Unpin")}</Button>
        </Tooltip>
      </Group>
      {!isDraft && (
        <Box>
          <Anchor size="xs" href={formatHash({ viewKey: r._class.toLowerCase(), handle })}>{t(OPEN_IN[r._class])}</Anchor>
          {changedHere && <Text size="xs" c="dimmed">{t("Your unsaved changes on the board won't show there yet.")}</Text>}
        </Box>
      )}
      {r._class === "Person" && (
        <Tooltip label={t("Search external services for matching records.")} openDelay={400} withArrow>
          <Button
            size="xs"
            variant="light"
            onClick={() => openExternalSearchWindow(r as unknown as ObjectDetail, boardSearchTerms(handle, all))}
          >
            {t("External Search")}
          </Button>
        </Tooltip>
      )}
      {onViewPhoto && photoUrl && <SidebarPhoto url={photoUrl} onClick={onViewPhoto} />}
      {onViewPhoto && <Button size="xs" variant="light" onClick={onViewPhoto}>{readOnly ? t("View full size") : t("View full size and identify people")}</Button>}
      {fields}
      {fields && !readOnly && (
        <Group gap={6} wrap="nowrap">
          <Text size="xs" c="dimmed" lh={1}><TreeMark /></Text>
          <Text size="xs" c="dimmed">{t("Edits here change the tree when you save.")}</Text>
        </Group>
      )}
      {r._class === "Person" && relatives && relatives.length > 0 && onRelate && (
        <Select
          size="xs"
          label={t("How is {name} related to…").replace("{name}", titleOf(handle, records))}
          description={t("Or Ctrl+click two people on the board (⌘+click on a Mac).")}
          placeholder={t("Pick someone on the board")}
          searchable
          value={null}
          data={relatives}
          onChange={(v) => v && onRelate(v)}
        />
      )}
      {r._class === "Person" && <PersonPhoto person={handle} all={all} readOnly={readOnly} faceUrl={faceUrl} onFace={onFace} onNotInPhoto={onNotInPhoto} onMainPhoto={onMainPhoto} />}
      {inPhoto !== undefined && (
        <Box>
          <Text size="xs" fw={600} c="dimmed" tt="uppercase">{t("In this photo")}{inPhoto ? ` (${inPhoto.length})` : ""}</Text>
          {inPhoto === null && <Loader size="xs" />}
          {inPhoto?.length === 0 && <Text size="xs" c="dimmed">{t("No one is identified in this photo yet.")}</Text>}
          <Stack gap={4} mt={4}>
            {inPhoto?.map((p) => (
              <Group key={p.handle} gap="xs" wrap="nowrap">
                <FaceThumb url={faceUrl(handle, p.rect)} />
                <Text size="sm" style={{ flex: 1, minWidth: 0 }} truncate>{p.label}</Text>
                {onBoard.has(p.handle) ? (
                  <Button size="compact-xs" variant="subtle" onClick={() => onShow(p.handle)}>{t("Show")}</Button>
                ) : (
                  <Button size="compact-xs" variant="light" onClick={() => onPinUp(p.cls, p.handle)}>{t("Pin")}</Button>
                )}
                {p.cls === "Person" && !readOnly && (
                  <FaceMenu marked={!!p.rect} who={p.label} onFace={() => onFace(p.handle, handle)} onNotInPhoto={() => onNotInPhoto(p.handle, handle)} />
                )}
              </Group>
            ))}
          </Stack>
          {inPhoto && inPhoto.filter((p) => !onBoard.has(p.handle)).length > 1 && (
            <Button size="xs" variant="light" mt={6} onClick={() => onPinUpMany(inPhoto.filter((p) => !onBoard.has(p.handle)))}>{t("Pin everyone")}</Button>
          )}
        </Box>
      )}
      {["Person", "Family", "Event"].includes(r._class) && (
        <Box>
          <Text size="xs" fw={600} c="dimmed" tt="uppercase">{t("Evidence")}</Text>
          {evidence.own.length + evidence.onEvents.length ? (
            <Text size="sm">
              {evidence.own.length + evidence.onEvents.length === 1 ? t("1 citation") : t("{n} citations").replace("{n}", String(evidence.own.length + evidence.onEvents.length))}
              {evidence.onEvents.length > 0 && (
                <Text span size="xs" c="dimmed">
                  {" "}
                  ({evidence.own.length ? t("{n} on its events").replace("{n}", String(evidence.onEvents.length)) : t("on its events")})
                </Text>
              )}
            </Text>
          ) : !evidence.complete ? (
            <Text size="sm" c="dimmed">{t("No citations on it, or on the events of it you can see.")}</Text>
          ) : (
            <Paper withBorder p="xs" style={{ borderColor: "var(--mantine-color-red-7)" }}>
              <Text size="sm" fw={700} c="red.7" tt="uppercase">{t("Unproven")}</Text>
              <Text size="xs" c="dimmed">{t("Nothing in the tree says how we know this yet. Tie a citation or a source to it.")}</Text>
            </Paper>
          )}
        </Box>
      )}
      <Box>
        <Text size="xs" fw={600} c="dimmed" tt="uppercase">{t("Leads")} ({leads.length})</Text>
        {leads.length === 0 && <Text size="xs" c="dimmed">{t("Nothing tied to it yet. Drag from its pin to another card, or into empty board to add something new.")}</Text>}
        <Stack gap={2}>
          {leads.map((l) => (
            <Group key={l.handle} gap="xs" wrap="nowrap">
              <Text size="sm" style={{ flex: 1, minWidth: 0 }} truncate>
                {all[l.handle] ? titleOf(l.handle, all) : t(CLASS_LABEL[l.cls])}
              </Text>
              {l.rels ? (
                <Text
                  size="xs"
                  c="dimmed"
                  title={[l.rels[0] && `${t("Father")}: ${t(l.rels[0])}`, l.rels[1] && `${t("Mother")}: ${t(l.rels[1])}`].filter(Boolean).join(", ")}
                >
                  {l.rels.filter(Boolean).map((x) => t(x)).join("/")}
                </Text>
              ) : (
                <Text size="xs" c="dimmed">{t(l.how)}</Text>
              )}
              {onBoard.has(l.handle) ? (
                <Button size="compact-xs" variant="subtle" onClick={() => onShow(l.handle)}>{t("Show")}</Button>
              ) : (
                <Button size="compact-xs" variant="light" onClick={() => onPinUp(l.cls, l.handle)}>{t("Pin")}</Button>
              )}
            </Group>
          ))}
        </Stack>
      </Box>
      {associations.length > 0 && (
        <Box>
          <Text size="xs" fw={600} c="dimmed" tt="uppercase">{t("Associations")} ({associations.length})</Text>
          <Stack gap={2}>
            {associations.map((a) => (
              <Group key={`${a.handle}|${a.rel}`} gap="xs" wrap="nowrap">
                <Text size="sm" style={{ flex: 1, minWidth: 0 }} truncate>
                  {all[a.handle] ? titleOf(a.handle, all) : t("Person")}
                </Text>
                {a.rel && <Text size="xs" c="dimmed" truncate maw="40%">{a.rel}</Text>}
                {onBoard.has(a.handle) ? (
                  <Button size="compact-xs" variant="subtle" onClick={() => onShow(a.handle)}>{t("Show")}</Button>
                ) : (
                  <Button size="compact-xs" variant="light" onClick={() => onPinUp("Person", a.handle)}>{t("Pin")}</Button>
                )}
              </Group>
            ))}
          </Stack>
          {associations.filter((a) => !onBoard.has(a.handle)).length > 1 && (
            <Button size="xs" variant="light" mt={6} onClick={() => onPinUpMany([...new Set(associations.filter((a) => !onBoard.has(a.handle)).map((a) => a.handle))].map((h) => ({ cls: "Person" as const, handle: h })))}>{t("Pin them all")}</Button>
          )}
        </Box>
      )}
      {missing.length > 0 && (
        <Box>
          <Text size="xs" fw={600} c="dimmed" tt="uppercase">{t("What's next?")}</Text>
          <Text size="sm">{missing.map((w) => t(w)).join(", ")}</Text>
          <Text size="xs" c="dimmed">{t("What the tree doesn't say yet, counting this board's unsaved changes.")}</Text>
        </Box>
      )}
      {unproven.length > 0 && (
        <Box>
          <Group gap={6} align="center">
            <Text size="xs" fw={600} c="dimmed" tt="uppercase">{t("Events with no evidence")}</Text>
            <UnprovenCountMark n={unproven.length} />
          </Group>
          <Text size="xs" c="dimmed">
            {(r._class === "Person"
              ? t("The red circled number on the card counts {name}'s events that nothing in the tree supports yet. Pin one up and tie a citation or a source to it.")
              : t("The red circled number on the card counts this family's events that nothing in the tree supports yet. Pin one up and tie a citation or a source to it.")
            ).replace("{name}", titleOf(handle, records))}
          </Text>
          <Stack gap={2} mt={4}>
            {unproven.map((e) => (
              <Group key={e} gap="xs" wrap="nowrap">
                <Text size="sm" style={{ flex: 1, minWidth: 0 }} truncate>{titleOf(e, all)}</Text>
                <Text size="xs" c="dimmed">{shortDate(all[e].date) || t("no date")}</Text>
                {onBoard.has(e) ? (
                  <Button size="compact-xs" variant="subtle" onClick={() => onShow(e)}>{t("Show")}</Button>
                ) : (
                  <Button size="compact-xs" variant="light" onClick={() => onPinUp("Event", e)}>{t("Pin")}</Button>
                )}
              </Group>
            ))}
          </Stack>
        </Box>
      )}
      {isDraft && !readOnly && (
        <>
          <Divider />
          <Group gap="xs">
            <Button size="xs" color="red" variant="light" onClick={onDiscard}>{t("Discard this draft")}</Button>
          </Group>
          <Text size="xs" c="dimmed">{t("Discarding removes it, and anything that depends on it, from your loose ends.")}</Text>
        </>
      )}
    </PanelFrame>
  );
}

/** The board's red circled count (corkboard skin), drawn the same way in
 * the sidebar so it's clear what the mark on the card is. */
function UnprovenCountMark({ n }: { n: number }) {
  const rx = n > 9 ? 15 : 12;
  return (
    <svg width={2 * rx + 4} height={27} viewBox={`${-rx - 2} -13.5 ${2 * rx + 4} 27`} aria-label={String(n)} style={{ flex: "none" }}>
      <g transform="rotate(-6)">
        <ellipse rx={rx} ry={11.5} fill="#f5ebd2" stroke="#c3261d" strokeWidth={2} />
        <text textAnchor="middle" y={5.5} fill="#c3261d" style={{ font: '700 16px "Caveat", "Segoe Print", "Bradley Hand", "Comic Neue", cursive' }}>
          {n > 99 ? "99+" : n}
        </text>
      </g>
    </svg>
  );
}

const YARN_NAME: Record<Yarn["kind"], string> = { kin: "Family", when: "When and where", evidence: "Evidence", other: "Photo or note" };

/** "⋯" beside someone in a photo: mark or change their face, or take
 * them out of the photo. */
function FaceMenu({ marked, who, onFace, onNotInPhoto }: { marked: boolean; who: string; onFace: () => void; onNotInPhoto: () => void }) {
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon size="sm" variant="subtle" color="gray" aria-label={`${t("Face and photo")}: ${who}`}>⋯</ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={onFace}>{marked ? t("Change where they are…") : t("Identify in the photo…")}</Menu.Item>
        <Menu.Item onClick={onNotInPhoto} rightSection={<TreeMark />}>{t("Not in this photo")}</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

/** A person's card: the photo on their card and their face in it. */
function PersonPhoto({ person, all, readOnly, faceUrl, onFace, onNotInPhoto, onMainPhoto }: {
  person: string;
  all: Records;
  readOnly?: boolean;
  faceUrl: (media: string, rect: number[] | null) => string | null;
  onFace: (person: string, media: string) => void;
  onNotInPhoto: (person: string, media: string) => void;
  onMainPhoto: (person: string, media: string) => void;
}) {
  const photos = photosOf(person, all);
  const [main, ...others] = photos;
  return (
    <Box>
      <Text size="xs" fw={600} c="dimmed" tt="uppercase">{t("Photo")}</Text>
      {!main ? (
        <Text size="xs" c="dimmed">
          {readOnly ? t("No photo yet.") : t("No photo yet. To add one, open a photo full size and draw a box around their face.")}
        </Text>
      ) : (
        <Group gap="sm" wrap="nowrap" align="flex-start" mt={4}>
          <FaceThumb url={faceUrl(main.media, main.rect)} size={56} />
          <Stack gap={4} style={{ minWidth: 0 }}>
            <Text size="sm" truncate>{titleOf(main.media, all) || t("Photo")}</Text>
            {!readOnly && (
              <Group gap={4}>
                <Button size="compact-xs" variant="light" onClick={() => onFace(person, main.media)}>{main.rect ? t("Change where they are…") : t("Identify in the photo…")}</Button>
                <Button size="compact-xs" variant="subtle" color="gray" onClick={() => onNotInPhoto(person, main.media)} rightSection={<TreeMark />}>{t("Not in this photo")}</Button>
              </Group>
            )}
          </Stack>
        </Group>
      )}
      {!readOnly && others.length > 0 && (
        <Stack gap={2} mt={6}>
          <Text size="xs" c="dimmed">{t("Also in")}:</Text>
          {others.map((o) => (
            <Group key={o.media} gap="xs" wrap="nowrap">
              <FaceThumb url={faceUrl(o.media, o.rect)} size={24} />
              <Text size="xs" style={{ flex: 1, minWidth: 0 }} truncate>{titleOf(o.media, all) || t("Photo")}</Text>
              <Button size="compact-xs" variant="subtle" onClick={() => onMainPhoto(person, o.media)} rightSection={<TreeMark />}>{t("Use on the card")}</Button>
            </Group>
          ))}
        </Stack>
      )}
    </Box>
  );
}

/** Two people selected: how they're related, from the saved tree. */
export function RelationPanel({ from, to, records, revision, unsaved, onPinPath, onPinUp, onClose }: {
  from: string;
  to: string;
  records: Records;
  /** Bumped after a Save, so the search runs again on the new tree. */
  revision: number;
  /** Loose ends not saved yet: the search can't see them. */
  unsaved: boolean;
  onPinPath: (steps: PathStep[]) => void;
  onPinUp: (handle: string) => void;
  onClose: () => void;
}) {
  // The same search RelationshipBetween runs (shared cache), for the path to pin.
  const state = useRelationshipPaths(from, to, { revision });
  const path = state.status === "done" ? state.paths[0] : undefined;
  const between = path ? path.steps.length - 2 : 0;
  return (
    <PanelFrame eyebrow={t("How they're related")} title={`${titleOf(from, records)} & ${titleOf(to, records)}`} onClose={onClose}>
      {unsaved && (
        <Text size="xs" c="dimmed">{t("This uses the saved tree. Save to include connections you've made on the board.")}</Text>
      )}
      <Box mx={-16}>
        <RelationshipBetween
          from={from}
          to={to}
          revision={revision}
          chart="always"
          menu={{ actions: (h) => [{ label: t("Pin"), onClick: () => onPinUp(h) }] }}
        />
      </Box>
      {path && (
        <Group gap="xs">
          {between > 0 && (
            <Button size="xs" variant="light" onClick={() => onPinPath(path.steps)}>
              {between === 1 ? t("Pin the person in between") : t("Pin the {n} people in between").replace("{n}", String(between))}
            </Button>
          )}
          <Button size="xs" variant="default" onClick={() => openRelationshipWindow(from, to)}>{t("Graph")}</Button>
        </Group>
      )}
      {path && between > 0 && (
        <Text size="xs" c="dimmed">{t("Pinning puts their cards, and the families joining them, between these two. It doesn't change the tree.")}</Text>
      )}
    </PanelFrame>
  );
}

/** A sticky note: a hunch, kept with the case and never in the tree, and
 * the cards on the board it's about. */
export function StickyPanel({ text, about, cards, onText, onAbout, onRemove, onClose }: {
  text: string;
  /** Handles of the cards it's about. */
  about: string[];
  /** The cards on the board, to pick from. */
  cards: { value: string; label: string }[];
  onText: (text: string) => void;
  onAbout: (about: string[]) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  return (
    <PanelFrame eyebrow={t("Sticky note")} title={t("A hunch")} sub={t("On this board only. Saved with the case, never in the tree.")} onClose={onClose}>
      <Textarea
        label={t("Note")}
        autosize
        minRows={4}
        maxRows={12}
        autoFocus={!text}
        value={text}
        placeholder={t("e.g. Could the “Mary” in the 1880 census be Ruth's mother?")}
        onChange={(e) => onText(e.currentTarget.value)}
      />
      {cards.length > 0 && (
        <MultiSelect
          size="xs"
          label={t("About")}
          description={t("Or drag from the tape at the top of the note to a card.")}
          placeholder={about.length ? undefined : t("Pick cards on the board")}
          searchable
          clearable
          value={about.filter((h) => cards.some((c) => c.value === h))}
          data={cards}
          // Keeps cards this list can't show (ones you can't see).
          onChange={(v) => onAbout([...about.filter((h) => !cards.some((c) => c.value === h)), ...v])}
        />
      )}
      <Group>
        <Button size="xs" color="red" variant="light" onClick={onRemove}>{t("Throw it away")}</Button>
      </Group>
    </PanelFrame>
  );
}

export function YarnPanel({ yarn, records, state, readOnly, onSnip, onRetie, onPullOut, onClose }: {
  yarn: Yarn;
  readOnly?: boolean;
  records: Records;
  state: "saved" | "new" | "cut";
  onSnip: () => void;
  onRetie: () => void;
  onPullOut: () => void;
  onClose: () => void;
}) {
  return (
    <PanelFrame eyebrow={t(YARN_NAME[yarn.kind])} title={`${titleOf(yarn.a, records)} — ${t(yarn.label)} — ${titleOf(yarn.b, records)}`} onClose={onClose}>
      {state === "new" && <Text size="sm">{t("New connection. It goes into the tree when you save.")}</Text>}
      {state === "cut" && <Text size="sm">{t("Removed. The connection goes from the tree when you save. Both records stay.")}</Text>}
      {readOnly && <Text size="sm" c="dimmed">{t("Removing and adding connections need Editor rights.")}</Text>}
      <Group gap="xs" display={readOnly ? "none" : undefined}>
        {state === "saved" && <Button size="xs" color="red" variant="light" onClick={onSnip} rightSection={<TreeMark />}>{t("Remove connection")}</Button>}
        {state === "cut" && <Button size="xs" onClick={onRetie}>{t("Put it back")}</Button>}
        {state === "new" && <Button size="xs" color="red" variant="light" onClick={onPullOut}>{t("Remove this new connection")}</Button>}
      </Group>
      {state === "saved" && !readOnly && <Text size="xs" c="dimmed">{t("This only takes away the connection. Both records stay, and you can put it back before saving.")}</Text>}
    </PanelFrame>
  );
}

export interface OpenQuestion {
  group: string;
  handle: string;
  /** "What's next?": what's missing (English, translated here). */
  what?: string[];
  /** Not on the board: offer to pin it up (as this kind of card) instead of Show. */
  pin?: GrampsClass;
}

export function CaseNotesPanel({ file, changes, questions, records, onCaseField, onTakeBack, onShowChange, onShow, onPinUp, onSave, onDownload, canSave, discussion, onDiscuss }: {
  file: CaseFile;
  onDownload: () => void;
  /** The case's discussion: "unsaved" (case not saved yet), "loading",
   * "none" yet, "cantStart" (none, and no right to start one), or "open". */
  discussion: "unsaved" | "loading" | "none" | "cantStart" | "open";
  onDiscuss: () => void;
  changes: Change[];
  questions: OpenQuestion[];
  records: Records;
  onCaseField: (field: "name" | "question" | "description", value: string) => void;
  onTakeBack: (id: string) => void;
  onShowChange: (change: Change) => void;
  onShow: (handle: string) => void;
  onPinUp: (cls: GrampsClass, handle: string) => void;
  onSave: () => void;
  canSave: boolean;
}) {
  const groups = [...new Set(questions.map((q) => q.group))];
  return (
    <PanelFrame eyebrow={t("The case so far")} title={t("Case notes")}>
      <CommitField label={t("Name of this case")} readOnly={!canSave} value={file.name} onCommit={(v) => v.trim() && onCaseField("name", v.trim())} />
      <CommitField label={t("The question it's trying to answer")} readOnly={!canSave} value={file.question} onCommit={(v) => onCaseField("question", v)} />
      <CommitField label={t("Notes on the case")} readOnly={!canSave} multiline value={file.description} onCommit={(v) => onCaseField("description", v)} />
      <Divider />
      <Text size="xs" fw={600} c="dimmed" tt="uppercase">{t("Loose ends: not saved yet")} ({changes.length})</Text>
      {changes.length === 0 && <Text size="xs" c="dimmed">{t("Nothing waiting. Anything marked with the little tree (adding, connecting, removing a connection, editing) shows up here until you save.")}</Text>}
      <Stack gap={4}>
        {changes.map((c, i) => (
          <Group key={c.id} gap="xs" wrap="nowrap" align="flex-start">
            <Text size="sm" c="dimmed">{i + 1}.</Text>
            <Text size="sm" style={{ flex: 1 }} td={c.off ? "line-through" : undefined}>{c.label}</Text>
            <Button size="compact-xs" variant="subtle" onClick={() => onShowChange(c)}>{t("Show")}</Button>
            <Tooltip label={t("Take this change out of your loose ends, with anything that depends on it. Nothing in the tree changes.")} multiline w={240} openDelay={400} withArrow>
              <Button size="compact-xs" variant="light" onClick={() => onTakeBack(c.id)}>{t("Remove")}</Button>
            </Tooltip>
          </Group>
        ))}
      </Stack>
      {changes.length > 0 && canSave && <Button size="xs" onClick={onSave}>{t("Save…")}</Button>}
      <Divider />
      <Text size="xs" fw={600} c="dimmed" tt="uppercase">{t("Open questions")} ({questions.length})</Text>
      {questions.length === 0 && <Text size="xs" c="dimmed">{t("Every card is tied to something, every event has evidence, every photo has a date, and nothing is missing.")}</Text>}
      {groups.map((g) => (
        <Box key={g}>
          <Text size="sm" fw={600}>{t(g)}</Text>
          {questions.filter((q) => q.group === g).map((q) => (
            <Group key={q.handle} gap="xs" wrap="nowrap">
              {q.pin ? (
                <>
                  <Text size="sm" px={10} style={{ minWidth: 0 }} truncate>{titleOf(q.handle, records)}</Text>
                  <Button size="compact-xs" variant="light" onClick={() => onPinUp(q.pin!, q.handle)}>{t("Pin")}</Button>
                </>
              ) : (
                <Button size="compact-xs" variant="subtle" onClick={() => onShow(q.handle)}>{titleOf(q.handle, records)}</Button>
              )}
              {q.what && <Text size="xs" c="dimmed">{q.what.map((w) => t(w)).join(", ")}</Text>}
            </Group>
          ))}
        </Box>
      ))}
      <Divider />
      <Text size="xs" fw={600} c="dimmed" tt="uppercase">{t("Discussion")}</Text>
      {discussion === "unsaved" && <Text size="xs" c="dimmed">{t("Save the case first, then others can discuss it with you.")}</Text>}
      {discussion === "loading" && <Loader size="xs" />}
      {discussion === "cantStart" && <Text size="xs" c="dimmed">{t("No one has started a discussion of this case yet.")}</Text>}
      {(discussion === "none" || discussion === "open") && (
        <Box>
          <Button size="xs" variant="light" onClick={onDiscuss}>{discussion === "open" ? t("Discuss Evidence Board") : t("Discuss this case")}</Button>
          <Text size="xs" c="dimmed" mt={4}>
            {discussion === "open"
              ? t("Opens in a window you can keep beside the board.")
              : t("Starts a discussion others can join from Discussions, with a link back to this board.")}
          </Text>
        </Box>
      )}
      <Divider />
      <Box>
        <Button size="xs" variant="default" onClick={onDownload}>{t("Download this case file")}</Button>
        <Text size="xs" c="dimmed" mt={4}>{t("A file with the case, its board and a copy of every pinned record, to keep or share. Loose ends not saved yet are only listed.")}</Text>
      </Box>
    </PanelFrame>
  );
}

export function SaveDialog({ opened, changes, layoutOnly, onToggle, onSave, onClose, saving }: {
  opened: boolean;
  changes: Change[];
  layoutOnly: boolean;
  onToggle: (id: string) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
}) {
  const on = changes.filter((c) => !c.off).length;
  return (
    <Modal opened={opened} onClose={onClose} title={t("Save")} size="lg">
      <Stack>
        {changes.length > 0 ? (
          <Stack gap={4}>
            {changes.map((c) => (
              <Checkbox key={c.id} checked={!c.off} onChange={() => onToggle(c.id)} label={c.label} styles={{ label: { textDecoration: c.off ? "line-through" : undefined } }} />
            ))}
          </Stack>
        ) : (
          <Text size="sm">{layoutOnly ? t("Only the case file changed: its name, notes or the board's layout.") : t("No loose ends.")}</Text>
        )}
        <Text size="xs" c="dimmed">
          {t("The ticked changes go into the tree together, as one change in its History, so one Undo there takes all of it back. If someone else changed one of these records since you pinned it, nothing is saved and the board tells you which. The case file (its notes and the board's layout) is saved with it. Unticking a change also unticks anything that depends on it.")}
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>{t("Keep working")}</Button>
          <Button onClick={onSave} loading={saving}>
            {on ? (on === 1 ? t("Save 1 change") : t("Save {n} changes").replace("{n}", String(on))) : t("Save the board")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Pin up from the tree (one search across every kind of record), or
 * create something new. */
export function AddMenu({ opened, onClose, onPick, onCreate, onSticky, canCreate = true }: {
  canCreate?: boolean;
  /** Adds a sticky note (board only). */
  onSticky?: () => void;
  opened: boolean;
  onClose: () => void;
  onPick: (cls: GrampsClass, handle: string) => void;
  onCreate: (cls: GrampsClass) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!opened) setQuery("");
  }, [opened]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const { hits: found } = await fetchSearch(await getToken(), q, 1, 12, null, ctrl.signal);
        setHits(found.filter((h) => SEARCH_TYPE[h.object_type]));
      } catch {
        /* aborted or failed: keep the last results */
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);
  return (
    <Modal opened={opened} onClose={onClose} title={t("Add to the board")} size="lg">
      <Stack>
        <Text size="xs" fw={600} c="dimmed" tt="uppercase">{t("Pin from the tree")}</Text>
        <TextInput
          data-autofocus
          placeholder={t("Find a person, place, source…")}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          rightSection={loading ? <Loader size="xs" /> : null}
        />
        <Stack gap={2}>
          {hits.map((h) => (
            <MenuChoice key={h.handle} onClick={() => onPick(SEARCH_TYPE[h.object_type], h.handle)}>
              <Group gap="xs" wrap="nowrap" align="flex-start">
                <Badge size="xs" variant="light" mt={2}>{t(CLASS_LABEL[SEARCH_TYPE[h.object_type]])}</Badge>
                <Box>
                  <Text size="sm">{summaryLine(h.object_type, h.object)}</Text>
                  {snippetFor(h.object_type, h.object).slice(0, 1).map((line) => (
                    <Text key={line} size="xs" c="dimmed">{line}</Text>
                  ))}
                </Box>
              </Group>
            </MenuChoice>
          ))}
          {query.trim().length >= 2 && !loading && hits.length === 0 && <Text size="xs" c="dimmed">{t("Nothing matches.")}</Text>}
        </Stack>
        <Divider display={canCreate ? undefined : "none"} />
        <Text size="xs" fw={600} c="dimmed" tt="uppercase" display={canCreate ? undefined : "none"}>{t("Create something new")}</Text>
        <Group gap="xs" display={canCreate ? undefined : "none"}>
          {(["Person", "Family", "Event", "Place", "Source", "Citation", "Repository", "Note"] as GrampsClass[]).map((cls) => (
            <Button key={cls} size="xs" variant="light" onClick={() => onCreate(cls)} rightSection={<TreeMark />}>{t(`New ${CLASS_LABEL[cls].toLowerCase()}`)}</Button>
          ))}
        </Group>
        {onSticky && (
          <>
            <Divider />
            <Text size="xs" fw={600} c="dimmed" tt="uppercase">{t("On this board only")}</Text>
            <Group gap="xs" wrap="nowrap" align="center">
              <Button size="xs" variant="light" color="yellow" onClick={onSticky}>{t("Sticky note")}</Button>
              <Text size="xs" c="dimmed">{t("A hunch to keep in mind. Saved with the case, never in the tree.")}</Text>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}

