// The Evidence Board's panels and menus: the connection menu where yarn is
// dropped, the card and yarn panels on the right, Case notes, the Save
// dialog and the Add menu. All of them only report what the user chose;
// BoardView stages it as a loose end.
import { Badge, Box, Button, Checkbox, CloseButton, Divider, Group, Loader, Modal, Paper, ScrollArea, SegmentedControl, Select, Stack, Text, Textarea, TextInput, Title } from "@mantine/core";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { getToken } from "../../auth/auth";
import { t } from "../../i18n/i18n";
import type { Change } from "../../store/board/changes";
import type { CardSize, CaseFile } from "../../store/board/caseFile";
import { GENDER, type GrampsClass, type GrampsRecord, type Records } from "../../store/board/records";
import { leadsOf, titleOf, typeName, type Yarn } from "../../store/board/view";
import shapes from "../../data/grampsRecordShapes.json";
import { fetchSearch, type SearchHit } from "../../store/searchApi";
import { summaryLine } from "../related/summary";
import { snippetFor } from "../visuals/searchSnippet";

export const CLASS_LABEL: Record<GrampsClass, string> = {
  Person: "Person", Family: "Family", Event: "Event", Place: "Place", Source: "Source",
  Citation: "Citation", Repository: "Repository", Media: "Photo or document", Note: "Note",
};
const SEARCH_TYPE: Record<string, GrampsClass> = {
  person: "Person", family: "Family", event: "Event", place: "Place", source: "Source",
  citation: "Citation", repository: "Repository", media: "Media", note: "Note",
};

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

export function MenuChoice({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <Button variant="subtle" justify="flex-start" fullWidth size="xs" onClick={onClick} styles={{ label: { whiteSpace: "normal", textAlign: "left" } }} h="auto" py={6}>
      {children}
    </Button>
  );
}

function PanelFrame({ eyebrow, title, sub, onClose, children }: { eyebrow: string; title: string; sub?: string; onClose: () => void; children: ReactNode }) {
  return (
    <Paper withBorder shadow="md" radius={0} style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 360, zIndex: 15, display: "flex", flexDirection: "column" }} data-nozoom>
      <Group justify="space-between" align="flex-start" wrap="nowrap" p="sm" pb={0}>
        <Box style={{ minWidth: 0 }}>
          <Text size="xs" fw={700} c="red.7" tt="uppercase" style={{ letterSpacing: ".14em" }}>{eyebrow}</Text>
          <Title order={4} style={{ overflowWrap: "anywhere" }}>{title}</Title>
          {sub && <Text size="xs" c="dimmed">{sub}</Text>}
        </Box>
        <CloseButton onClick={onClose} aria-label={t("Close")} />
      </Group>
      <ScrollArea style={{ flex: 1 }} p="sm">
        <Stack gap="sm">{children}</Stack>
      </ScrollArea>
    </Paper>
  );
}

/** A text field that reports its value when it loses focus (one loose end
 * per edit, not one per keystroke). */
function CommitField({ label, value, onCommit, multiline }: { label: string; value: string; onCommit: (v: string) => void; multiline?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => v !== value && onCommit(v);
  return multiline ? (
    <Textarea label={label} value={v} onChange={(e) => setV(e.currentTarget.value)} onBlur={commit} autosize minRows={3} />
  ) : (
    <TextInput label={label} value={v} onChange={(e) => setV(e.currentTarget.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
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
  | { kind: "noteText"; text: string };

export function CardPanel(props: {
  handle: string;
  records: Records;
  peek: Records;
  onBoard: Set<string>;
  size: CardSize;
  isDraft: boolean;
  onSize: (size: CardSize) => void;
  onEdit: (edit: CardEdit) => void;
  onPinUp: (cls: GrampsClass, handle: string) => void;
  onShow: (handle: string) => void;
  onTakeOff: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  const { handle, records, peek, onBoard, size, isDraft, onSize, onEdit, onPinUp, onShow, onTakeOff, onDiscard, onClose } = props;
  const r = records[handle];
  if (!r) return null;
  const all = { ...peek, ...records };
  const leads = leadsOf(r);
  const name = r.primary_name as { first_name?: string; surname_list?: { surname?: string }[] } | undefined;
  let fields: ReactNode = null;
  switch (r._class) {
    case "Person":
      fields = (
        <>
          <Group grow>
            <CommitField label={t("First name")} value={name?.first_name ?? ""} onCommit={(v) => onEdit({ kind: "personName", first: v, surname: name?.surname_list?.[0]?.surname ?? "" })} />
            <CommitField label={t("Surname")} value={name?.surname_list?.[0]?.surname ?? ""} onCommit={(v) => onEdit({ kind: "personName", first: name?.first_name ?? "", surname: v })} />
          </Group>
          <Select
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
            label={t("Type")}
            value={current}
            searchable
            allowDeselect={false}
            data={[...new Set([current, ...EVENT_TYPES])].filter(Boolean).map((n) => ({ value: n, label: t(n) }))}
            onChange={(v) => v && onEdit({ kind: "eventType", typeKey: EVENT_TYPE_CODE[v] ?? null, name: v })}
          />
          <CommitField label={t("Description")} value={String(r.description ?? "")} onCommit={(v) => onEdit({ kind: "field", field: "description", value: v, label: "description" })} />
          <Text size="xs" c="dimmed">{t("Dates are edited in the event's own editor for now.")}</Text>
        </>
      );
      break;
    }
    case "Place":
      fields = <CommitField label={t("Name")} value={titleOf(handle, records)} onCommit={(v) => onEdit({ kind: "placeName", name: v })} />;
      break;
    case "Source":
      fields = (
        <>
          <CommitField label={t("Title")} value={String(r.title ?? "")} onCommit={(v) => onEdit({ kind: "field", field: "title", value: v, label: "title" })} />
          <CommitField label={t("Author")} value={String(r.author ?? "")} onCommit={(v) => onEdit({ kind: "field", field: "author", value: v, label: "author" })} />
        </>
      );
      break;
    case "Citation":
      fields = <CommitField label={t("Where in the source (page, entry)")} value={String(r.page ?? "")} onCommit={(v) => onEdit({ kind: "field", field: "page", value: v, label: "page" })} />;
      break;
    case "Repository":
      fields = <CommitField label={t("Name")} value={String(r.name ?? "")} onCommit={(v) => onEdit({ kind: "field", field: "name", value: v, label: "name" })} />;
      break;
    case "Media":
      fields = <CommitField label={t("Description")} value={String(r.desc ?? "")} onCommit={(v) => onEdit({ kind: "field", field: "desc", value: v, label: "description" })} />;
      break;
    case "Note":
      fields = <CommitField label={t("Text")} multiline value={String((r.text as { string?: string } | undefined)?.string ?? "")} onCommit={(v) => onEdit({ kind: "noteText", text: v })} />;
      break;
  }
  const citations = Array.isArray(r.citation_list) ? (r.citation_list as string[]) : [];
  return (
    <PanelFrame eyebrow={t("Case file")} title={titleOf(handle, records)} sub={`${t(CLASS_LABEL[r._class])} · ${r.gramps_id || t("draft, not saved yet")}`} onClose={onClose}>
      <SegmentedControl
        size="xs"
        value={size}
        onChange={(v) => onSize(v as CardSize)}
        data={[{ value: "icon", label: t("Icon") }, { value: "compact", label: t("Card") }, { value: "expanded", label: t("Dossier") }]}
      />
      {fields}
      {["Person", "Family", "Event"].includes(r._class) && (
        <Box>
          <Text size="xs" fw={600} c="dimmed" tt="uppercase">{t("Evidence")}</Text>
          {citations.length ? (
            <Text size="sm">{citations.length === 1 ? t("1 citation") : t("{n} citations").replace("{n}", String(citations.length))}</Text>
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
              <Text size="xs" c="dimmed">{t(l.how)}</Text>
              {onBoard.has(l.handle) ? (
                <Button size="compact-xs" variant="subtle" onClick={() => onShow(l.handle)}>{t("Show")}</Button>
              ) : (
                <Button size="compact-xs" variant="light" onClick={() => onPinUp(l.cls, l.handle)}>{t("Pin up")}</Button>
              )}
            </Group>
          ))}
        </Stack>
      </Box>
      <Divider />
      <Group gap="xs">
        <Button size="xs" variant="default" onClick={onTakeOff}>{t("Take off the board")}</Button>
        {isDraft && <Button size="xs" color="red" variant="light" onClick={onDiscard}>{t("Discard this draft")}</Button>}
      </Group>
      <Text size="xs" c="dimmed">
        {isDraft ? t("Discarding removes it, and anything that depends on it, from your loose ends.") : t("Taking a card off the board never changes the tree.")}
      </Text>
    </PanelFrame>
  );
}

const YARN_NAME: Record<Yarn["kind"], string> = { kin: "Family", when: "When and where", evidence: "Evidence", other: "Photo or note" };

export function YarnPanel({ yarn, records, state, onSnip, onRetie, onPullOut, onClose }: {
  yarn: Yarn;
  records: Records;
  state: "saved" | "new" | "cut";
  onSnip: () => void;
  onRetie: () => void;
  onPullOut: () => void;
  onClose: () => void;
}) {
  return (
    <PanelFrame eyebrow={t(YARN_NAME[yarn.kind])} title={`${titleOf(yarn.a, records)} — ${t(yarn.label)} — ${titleOf(yarn.b, records)}`} onClose={onClose}>
      {state === "new" && <Text size="sm">{t("New yarn. It's only tacked on until you save.")}</Text>}
      {state === "cut" && <Text size="sm">{t("Snipped. The connection goes when you save. Both records stay in the tree.")}</Text>}
      <Group gap="xs">
        {state === "saved" && <Button size="xs" color="red" variant="light" onClick={onSnip}>{t("Snip this yarn")}</Button>}
        {state === "cut" && <Button size="xs" onClick={onRetie}>{t("Retie it")}</Button>}
        {state === "new" && <Button size="xs" color="red" variant="light" onClick={onPullOut}>{t("Pull out this new yarn")}</Button>}
      </Group>
      {state === "saved" && <Text size="xs" c="dimmed">{t("Snipping only takes away the connection. Both records stay, and you can retie it before saving.")}</Text>}
    </PanelFrame>
  );
}

export interface OpenQuestion {
  group: string;
  handle: string;
}

export function CaseNotesPanel({ file, changes, questions, records, onCaseField, onTakeBack, onShowChange, onShow, onSave, canSave, onClose }: {
  file: CaseFile;
  changes: Change[];
  questions: OpenQuestion[];
  records: Records;
  onCaseField: (field: "name" | "question" | "description", value: string) => void;
  onTakeBack: (id: string) => void;
  onShowChange: (change: Change) => void;
  onShow: (handle: string) => void;
  onSave: () => void;
  canSave: boolean;
  onClose: () => void;
}) {
  const groups = [...new Set(questions.map((q) => q.group))];
  return (
    <PanelFrame eyebrow={t("The case so far")} title={t("Case notes")} onClose={onClose}>
      <CommitField label={t("Name of this case")} value={file.name} onCommit={(v) => onCaseField("name", v)} />
      <CommitField label={t("The question it's trying to answer")} value={file.question} onCommit={(v) => onCaseField("question", v)} />
      <CommitField label={t("Notes on the case")} multiline value={file.description} onCommit={(v) => onCaseField("description", v)} />
      <Divider />
      <Text size="xs" fw={600} c="dimmed" tt="uppercase">{t("Loose ends: not saved yet")} ({changes.length})</Text>
      {changes.length === 0 && <Text size="xs" c="dimmed">{t("Nothing waiting. Anything you add, tie, snip or edit shows up here until you save.")}</Text>}
      <Stack gap={4}>
        {changes.map((c, i) => (
          <Group key={c.id} gap="xs" wrap="nowrap" align="flex-start">
            <Text size="sm" c="dimmed">{i + 1}.</Text>
            <Text size="sm" style={{ flex: 1 }} td={c.off ? "line-through" : undefined}>{c.label}</Text>
            <Button size="compact-xs" variant="subtle" onClick={() => onShowChange(c)}>{t("Show")}</Button>
            <Button size="compact-xs" variant="light" onClick={() => onTakeBack(c.id)}>{t("Take back")}</Button>
          </Group>
        ))}
      </Stack>
      {changes.length > 0 && canSave && <Button size="xs" onClick={onSave}>{t("Save…")}</Button>}
      <Divider />
      <Text size="xs" fw={600} c="dimmed" tt="uppercase">{t("Open questions")} ({questions.length})</Text>
      {questions.length === 0 && <Text size="xs" c="dimmed">{t("Every card is tied to something, every event has evidence, and every photo has a date.")}</Text>}
      {groups.map((g) => (
        <Box key={g}>
          <Text size="sm" fw={600}>{t(g)}</Text>
          {questions.filter((q) => q.group === g).map((q) => (
            <Group key={q.handle} gap="xs">
              <Button size="compact-xs" variant="subtle" onClick={() => onShow(q.handle)}>{titleOf(q.handle, records)}</Button>
            </Group>
          ))}
        </Box>
      ))}
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
          <Text size="sm">{layoutOnly ? t("Only the board's layout changed.") : t("No loose ends.")}</Text>
        )}
        <Text size="xs" c="dimmed">
          {t("Saved as one change in the tree's History, so one Undo takes all of it back. Unticking a change also unticks anything that depends on it.")}
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
export function AddMenu({ opened, onClose, onPick, onCreate }: {
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
        <Text size="xs" fw={600} c="dimmed" tt="uppercase">{t("Pin up from the tree")}</Text>
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
        <Divider />
        <Text size="xs" fw={600} c="dimmed" tt="uppercase">{t("Create something new")}</Text>
        <Group gap="xs">
          {(["Person", "Family", "Event", "Place", "Source", "Citation", "Repository", "Note"] as GrampsClass[]).map((cls) => (
            <Button key={cls} size="xs" variant="light" onClick={() => onCreate(cls)}>{t(`New ${CLASS_LABEL[cls].toLowerCase()}`)}</Button>
          ))}
        </Group>
      </Stack>
    </Modal>
  );
}

