// "Got a lead?": the Evidence Board's guide from one document or photo to
// records that cite it (store/board/lead.ts has the logic and what each
// step stages). It lives in the sidebar, a step at a time; every answer
// becomes loose ends and cards on the board at once, so stopping halfway
// loses nothing and the rest can be done by hand.
import { Badge, Box, Button, Chip, FileButton, Group, Loader, Paper, Select, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useEffect, useState } from "react";
import { getToken } from "../../auth/auth";
import { t } from "../../i18n/i18n";
import { DOC_KINDS, eventsToLoad, existingEvent, familyToLoad, OCCASIONS, PART_ROLES, relationChoices, relativesOf, type RelationChoice } from "../../store/board/lead";
import { loadRecords, type GrampsClass, type Records } from "../../store/board/records";
import { titleOf } from "../../store/board/view";
import { parseDisplayDate, formatDisplayDate } from "../../store/placeIndex";
import { fetchSearch } from "../../store/searchApi";
import { summaryLine } from "../related/summary";
import { EventPlacePicker } from "./BoardPanels";
import { TreeMark } from "./TreeMark";

export type LeadStep = "file" | "what" | "where" | "who" | "occasion" | "roles" | "done";
const STEPS: LeadStep[] = ["file", "what", "where", "who", "occasion", "roles"];

/** Where the guide is, and what it has made so far. */
export interface LeadState {
  step: LeadStep;
  media: string | null;
  title: string;
  source: string | null;
  citation: string | null;
  /** Everyone in the document, in the order added. */
  people: string[];
  /** Those created by the guide (they get "How are they related?"). */
  newPeople: string[];
  /** person -> how they were tied in ("Not sure yet" too). */
  rels: Record<string, string>;
  event: string | null;
  eventPeople: string[];
  /** person -> PART_ROLES label. */
  roles: Record<string, string>;
}

export const NEW_LEAD: LeadState = { step: "file", media: null, title: "", source: null, citation: null, people: [], newPeople: [], rels: {}, event: null, eventPeople: [], roles: {} };

export interface LeadActions {
  /** Uploads the file (into the tree at once) and pins it. */
  onFile: (file: File) => Promise<void>;
  onWhat: (title: string) => void;
  onWhere: (repo: { handle: string } | { name: string }) => void;
  onPerson: (who: { handle: string } | { first: string; surname: string; gender: "F" | "M" | "U" }) => void;
  /** `choice` null: "Not sure yet". `records`: the family it was worked out from. */
  onRelate: (person: string, choice: RelationChoice | null, label: string, records: Records) => void;
  onEvent: (args: {
    occasion: (typeof OCCASIONS)[number];
    who1: string | null;
    who2: string | null;
    existing: { event: string; family?: string } | null;
    date: Record<string, unknown> | null;
    place: { handle: string } | { name: string } | null;
    otherName: string;
    records: Records;
  }) => void;
  onRole: (person: string, role: (typeof PART_ROLES)[number]) => void;
  onHome: (person: string) => void;
  onSave: () => void;
  onStep: (step: LeadStep) => void;
  onAnother: () => void;
  onClose: () => void;
}

/** Loads `first`, then whatever `next` asks for, round by round (at most 4). */
async function loadRounds(start: Records, next: (r: Records) => string[]): Promise<Records> {
  let records = { ...start };
  for (let round = 0; round < 4; round++) {
    const want = next(records);
    if (!want.length) break;
    const found: Records = {};
    // A handle's class isn't known up front: ask each class (people and
    // families are all this needs, events for "is it the same one?").
    for (const cls of ["Person", "Family", "Event"] as GrampsClass[]) {
      const missing = want.filter((h) => !found[h]);
      if (missing.length) Object.assign(found, await loadRecords(cls, missing).catch(() => ({})));
    }
    if (!Object.keys(found).length) break;
    records = { ...records, ...found };
  }
  return records;
}

/** Search the tree for one kind of record, offering "New: <typed>" too. */
function RecordSearch({ type, placeholder, exclude, onPick, newLabel }: {
  type: "person" | "repository";
  placeholder: string;
  exclude?: Set<string>;
  onPick: (pick: { handle: string; label: string } | { name: string }) => void;
  newLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ value: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setFound([]);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const { hits } = await fetchSearch(await getToken(), q, 1, 10, type, ctrl.signal);
        setFound(hits.map((h) => ({ value: h.handle, label: summaryLine(h.object_type, h.object) })));
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
  }, [query, type]);
  const q = query.trim();
  const data = found.filter((o) => !exclude?.has(o.value));
  if (newLabel && q.length >= 2) data.push({ value: "\u0000new", label: `${newLabel}: ${q}` });
  return (
    <Select
      size="xs"
      placeholder={placeholder}
      searchable
      value={null}
      data={data}
      searchValue={query}
      onSearchChange={setQuery}
      filter={({ options }) => options}
      nothingFoundMessage={q.length < 2 ? t("Type at least two letters") : loading ? t("Searching…") : t("Nothing found")}
      rightSection={loading ? <Loader size="xs" /> : undefined}
      onChange={(v) => {
        if (!v) return;
        setQuery("");
        if (v === "\u0000new") onPick({ name: q });
        else onPick({ handle: v, label: data.find((o) => o.value === v)?.label ?? "" });
      }}
    />
  );
}

function NewPersonForm({ onAdd }: { onAdd: (f: { first: string; surname: string; gender: "F" | "M" | "U" }) => void }) {
  const [f, setF] = useState({ first: "", surname: "", gender: "U" as "F" | "M" | "U" });
  const ok = !!(f.first.trim() || f.surname.trim());
  return (
    <Stack gap={4}>
      <Text size="xs" fw={600} c="dimmed" tt="uppercase">{t("Someone not in your tree yet")}</Text>
      <Group grow gap="xs">
        <TextInput size="xs" label={t("First name")} value={f.first} onChange={(e) => setF({ ...f, first: e.currentTarget.value })} />
        <TextInput size="xs" label={t("Surname")} placeholder={t("if known")} value={f.surname} onChange={(e) => setF({ ...f, surname: e.currentTarget.value })} />
      </Group>
      <Group gap="xs" align="flex-end">
        <Select size="xs" label={t("Sex")} w={110} allowDeselect={false} value={f.gender} onChange={(v) => v && setF({ ...f, gender: v as "F" | "M" | "U" })}
          data={[{ value: "F", label: t("Female") }, { value: "M", label: t("Male") }, { value: "U", label: t("Unknown") }]} />
        <Button size="xs" variant="light" disabled={!ok} rightSection={<TreeMark />} onClick={() => {
          onAdd({ first: f.first.trim(), surname: f.surname.trim(), gender: f.gender });
          setF({ first: "", surname: "", gender: "U" });
        }}>{t("Add")}</Button>
      </Group>
    </Stack>
  );
}

const ACCEPTS = (f: File) => f.type.startsWith("image/") || f.type === "application/pdf";

/** "Choose a scan or photo…" that also takes a dropped file. Its drag
 * events stop here, so the app-wide drop handler (hooks/useMediaDrop.ts)
 * neither shows its overlay over this box nor adds the file to the Media
 * list a second time: the window's dragenter/dragleave count stays
 * balanced because both are stopped for this box and everything inside. */
function FileDropZone({ busy, onFile }: { busy: boolean; onFile: (file: File) => void }) {
  const [over, setOver] = useState(false);
  const isFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  return (
    <Paper
      withBorder
      p="md"
      style={{
        borderStyle: "dashed",
        textAlign: "center",
        borderColor: over ? "var(--mantine-primary-color-filled)" : undefined,
        background: over ? "var(--mantine-primary-color-light)" : undefined,
      }}
      onDragEnter={(e) => {
        if (!isFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!isFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = busy ? "none" : "copy";
      }}
      onDragLeave={(e) => {
        if (!isFiles(e)) return;
        e.stopPropagation();
        // Leaving for one of this box's own children isn't leaving the box.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        if (!isFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        if (busy) return;
        const files = Array.from(e.dataTransfer.files);
        const file = files.find(ACCEPTS);
        if (file) onFile(file);
        else if (files.length > 0) notifications.show({ color: "yellow", message: t("Drop a picture or a PDF here.") });
      }}
    >
      <Stack gap={6} align="center">
        <FileButton accept="image/*,application/pdf" onChange={(file) => file && onFile(file)}>
          {(props) => <Button {...props} size="xs" loading={busy}>{t("Choose a scan or photo…")}</Button>}
        </FileButton>
        <Text size="xs" c="dimmed">{t("or drop it here")}</Text>
      </Stack>
    </Paper>
  );
}

const Question = ({ children }: { children: string }) => <Text fz="lg" fw={500}>{children}</Text>;
const Footer = ({ children }: { children: React.ReactNode }) => <Group gap="xs" mt="xs">{children}</Group>;
const Note = ({ children }: { children: React.ReactNode }) => <Text size="xs" c="dimmed">{children}</Text>;

export function LeadGuide({ lead, records, home, actions }: {
  lead: LeadState;
  /** The board's working records (with peeked ones), for names. */
  records: Records;
  home: string | null;
  actions: LeadActions;
}) {
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(lead.title);
  const [kind, setKind] = useState<string | null>(null);
  const idx = STEPS.indexOf(lead.step);
  const docTitle = lead.title || t("the document");

  // The Home person's close family, for "Who is in it?" and "How are they related?".
  const [family, setFamily] = useState<Records>({});
  useEffect(() => {
    if (lead.step !== "who" || !home) return;
    let cancelled = false;
    void loadRounds(records, (r) => familyToLoad(home, r)).then((r) => !cancelled && setFamily(r));
    return () => {
      cancelled = true;
    };
    // Loaded once per Home person; later board edits don't change the family.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.step, home]);

  let body: React.ReactNode;
  switch (lead.step) {
    case "file":
      body = (
        <>
          <Question>{t("Start with the evidence itself.")}</Question>
          <FileDropZone busy={busy} onFile={async (file) => {
            setBusy(true);
            try {
              await actions.onFile(file);
            } finally {
              setBusy(false);
            }
          }} />
          <Note>{t("The file goes into the tree's Media as soon as you choose it. Everything else waits for Save.")}</Note>
          <Note>{t("No digital copy yet? That's fine: you can still record what it says and add the scan later.")}</Note>
          <Footer><Button size="xs" variant="default" onClick={() => actions.onStep("what")}>{t("I don't have a copy")}</Button></Footer>
        </>
      );
      break;
    case "what":
      body = (
        <>
          <Question>{t("What is it?")}</Question>
          <Chip.Group value={kind ?? ""} onChange={(v) => {
            const k = String(v);
            setKind(k);
            setTitle(k === "Other" ? "" : t(k));
          }}>
            <Group gap={6}>{DOC_KINDS.map((k) => <Chip key={k} value={k} size="xs">{t(k)}</Chip>)}</Group>
          </Chip.Group>
          <TextInput size="xs" label={t("A short title")} placeholder={t("e.g. Photo of Mom and Dad's wedding")} value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
          <Note>{t("This becomes the source that every fact from this document will cite.")}</Note>
          <Footer>
            <Button size="xs" disabled={!title.trim()} rightSection={<TreeMark />} onClick={() => actions.onWhat(title.trim())}>{t("Next")}</Button>
            <Button size="xs" variant="subtle" color="gray" onClick={() => actions.onStep("who")}>{t("Skip")}</Button>
          </Footer>
        </>
      );
      break;
    case "where":
      body = (
        <>
          <Question>{t("Where did you get it?")}</Question>
          <RecordSearch
            type="repository"
            placeholder={t("An archive, a library, someone's collection…")}
            newLabel={t("Somewhere new")}
            onPick={(p) => actions.onWhere("handle" in p ? { handle: p.handle } : { name: p.name })}
          />
          <Note>{t("For example “Aunt Martha's collection” or “County courthouse”.")}</Note>
          <Footer><Button size="xs" variant="subtle" color="gray" onClick={() => actions.onStep("who")}>{t("Skip")}</Button></Footer>
        </>
      );
      break;
    case "who": {
      const all = { ...family, ...records };
      const rel = home ? relativesOf(home, all) : { list: [], parents: [] };
      const suggestions = rel.list.filter((x) => !lead.people.includes(x.handle)).slice(0, 12);
      body = (
        <>
          <Question>{t("Who is in it, or named in it?")}</Question>
          {!home ? (
            <Stack gap={4}>
              <Note>{t("Who are you? Your family is suggested from there.")}</Note>
              <RecordSearch type="person" placeholder={t("Find yourself in the tree")} onPick={(p) => "handle" in p && actions.onHome(p.handle)} />
            </Stack>
          ) : suggestions.length > 0 && (
            <Stack gap={4}>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase">{t("Your family")}</Text>
              <Group gap={6}>
                {suggestions.map((x) => (
                  <Button key={x.handle} size="compact-xs" variant="light" rightSection={<TreeMark />} onClick={() => actions.onPerson({ handle: x.handle })}>
                    <Text span size="xs" c="dimmed" mr={4}>{t(x.rel)} ·</Text>{titleOf(x.handle, all)}
                  </Button>
                ))}
              </Group>
            </Stack>
          )}
          <Stack gap={4}>
            <Text size="xs" fw={600} c="dimmed" tt="uppercase">{t("Anyone else in your tree")}</Text>
            <RecordSearch type="person" placeholder={t("Search people…")} exclude={new Set(lead.people)} onPick={(p) => "handle" in p && actions.onPerson({ handle: p.handle })} />
          </Stack>
          <NewPersonForm onAdd={(f) => actions.onPerson(f)} />
          {lead.people.length > 0 && (
            <Stack gap={6}>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase">{t("In this document")}</Text>
              {lead.people.map((h) => {
                const isNew = lead.newPeople.includes(h);
                const chosen = lead.rels[h];
                const choices = isNew && home ? relationChoices(home, h, lead.people, all) : [];
                return (
                  <Paper key={h} withBorder p={6}>
                    <Group gap="xs" justify="space-between" wrap="nowrap">
                      <Text size="sm" fw={600} truncate>{titleOf(h, all)}</Text>
                      <Badge size="xs" variant="light" color={isNew ? "red" : "gray"}>{isNew ? t("new") : t("in your tree")}</Badge>
                    </Group>
                    {isNew && (chosen ? <Note>✓ {chosen}</Note> : (
                      <Stack gap={4} mt={4}>
                        <Note>{t("How are they related?")}</Note>
                        <Group gap={4}>
                          {choices.map((c, i) => {
                            const label = t(`{name}'s ${c.how}`).replace("{name}", titleOf(c.to, all));
                            return <Button key={i} size="compact-xs" variant="light" rightSection={<TreeMark />} onClick={() => actions.onRelate(h, c, label, all)}>{label}</Button>;
                          })}
                          <Button size="compact-xs" variant="subtle" color="gray" onClick={() => actions.onRelate(h, null, t("Not sure yet"), all)}>{t("Not sure yet")}</Button>
                        </Group>
                      </Stack>
                    ))}
                  </Paper>
                );
              })}
            </Stack>
          )}
          <Footer><Button size="xs" onClick={() => actions.onStep("occasion")}>{t("Next")}</Button></Footer>
        </>
      );
      break;
    }
    case "occasion":
      body = <OccasionStep lead={lead} records={records} actions={actions} />;
      break;
    case "roles": {
      const others = lead.people.filter((h) => !lead.eventPeople.includes(h));
      body = (
        <>
          <Question>{t("What part did the others play?")}</Question>
          {lead.event && <Note>{titleOf(lead.event, records)}</Note>}
          {others.map((h) => (
            <Paper key={h} withBorder p={6}>
              <Text size="sm" fw={600}>{titleOf(h, records)}</Text>
              <Group gap={4} mt={4}>
                {PART_ROLES.filter((r) => !r.weddingOnly || lead.eventPeople.length === 2).map((r) => (
                  <Button key={r.label} size="compact-xs" variant={lead.roles[h] === r.label ? "filled" : "light"} rightSection={<TreeMark />} onClick={() => actions.onRole(h, r)}>{t(r.label)}</Button>
                ))}
              </Group>
            </Paper>
          ))}
          <Footer><Button size="xs" onClick={() => actions.onStep("done")}>{t("Done")}</Button></Footer>
        </>
      );
      break;
    }
    case "done":
      body = (
        <>
          <Question>{t("That's this document done.")}</Question>
          <Note>{t("Everything you added cites “{title}”. It's all on the board, and nothing is in the tree until you save.").replace("{title}", docTitle)}</Note>
          <Paper withBorder p="xs">
            <Text size="sm" fw={600}>{t("Do you have another document about the same people?")}</Text>
            <Note>{t("A marriage certificate or a newspaper notice would back up the same facts.")}</Note>
          </Paper>
          <Footer>
            <Button size="xs" onClick={actions.onSave}>{t("Save…")}</Button>
            <Button size="xs" variant="default" onClick={actions.onAnother}>{t("Another document")}</Button>
            <Button size="xs" variant="subtle" color="gray" onClick={actions.onClose}>{t("Close")}</Button>
          </Footer>
        </>
      );
      break;
  }

  return (
    <Stack gap="sm">
      {lead.step !== "done" && (
        <Group gap={4} wrap="nowrap">
          {STEPS.map((s, i) => <Box key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= idx ? "var(--mantine-color-red-7)" : "var(--mantine-color-default-border)" }} />)}
        </Group>
      )}
      {body}
      {lead.step !== "done" && <Note>{t("Everything you add here goes on the board as you go. You can stop at any point and finish on the board by hand.")}</Note>}
    </Stack>
  );
}

/** "What's the occasion?": the kind, whose it is, and either "Is this the
 * same one?" (when the tree has it already) or when and where. */
function OccasionStep({ lead, records, actions }: { lead: LeadState; records: Records; actions: LeadActions }) {
  const pool = lead.people.length ? lead.people : [];
  const [occ, setOcc] = useState<string | null>(null);
  const [who1, setWho1] = useState<string | null>(pool[0] ?? null);
  const [who2, setWho2] = useState<string | null>(pool[1] ?? null);
  const [same, setSame] = useState<boolean | null>(null);
  const [dateText, setDateText] = useState("");
  const [place, setPlace] = useState<{ handle: string; name: string } | { name: string } | null>(null);
  const [otherName, setOtherName] = useState("");
  const [loaded, setLoaded] = useState<Records>({});
  const occasion = OCCASIONS.find((o) => o.label === occ) ?? null;
  const wedding = occasion?.type === "MARRIAGE";

  // Load what "Is this the same one?" needs: the people, their families, their events.
  useEffect(() => {
    if (!occasion || !who1) return;
    let cancelled = false;
    void loadRounds({ ...records, ...loaded }, (r) => {
      const want = [who1, ...(wedding && who2 ? [who2] : [])].filter((h) => !r[h]);
      const fams = [...(Array.isArray(r[who1]?.family_list) ? (r[who1].family_list as string[]) : [])].filter((h) => !r[h]);
      return [...want, ...fams, ...eventsToLoad(who1, r)];
    }).then((r) => !cancelled && setLoaded(r));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occ, who1, who2]);
  const all = { ...loaded, ...records };
  const match = occasion ? existingEvent(occasion, who1, wedding ? who2 : null, all) : null;
  const undecided = !!match && same === null;
  const usingExisting = !!match && same === true;
  const date = dateText.trim() ? parseDisplayDate(dateText.trim()) : null;

  const personSelect = (label: string, value: string | null, set: (v: string | null) => void) => (
    <Select size="xs" label={label} value={value} onChange={(v) => { set(v); setSame(null); }} clearable placeholder={t("No one in particular")}
      data={pool.map((h) => ({ value: h, label: titleOf(h, all) }))} />
  );

  return (
    <>
      <Question>{t("What's the occasion?")}</Question>
      <Chip.Group value={occ ?? ""} onChange={(v) => { setOcc(String(v)); setSame(null); }}>
        <Group gap={6}>{OCCASIONS.map((o) => <Chip key={o.label} value={o.label} size="xs">{t(o.label)}</Chip>)}</Group>
      </Chip.Group>
      {occasion && (
        <>
          {occasion.label === "Other" && <TextInput size="xs" label={t("What was it?")} placeholder={t("e.g. First communion")} value={otherName} onChange={(e) => setOtherName(e.currentTarget.value)} />}
          {pool.length === 0 ? <Note>{t("Nobody was added in the last step, so it won't be tied to anyone yet.")}</Note>
            : wedding ? <Group grow gap="xs">{personSelect(t("Whose wedding?"), who1, setWho1)}{personSelect(t("and"), who2, setWho2)}</Group>
            : personSelect(t("Whose is it?"), who1, setWho1)}
          {match && (
            <Paper withBorder p="xs">
              <Text size="sm" fw={600}>{t("Already in your tree")}: {titleOf(match.event, all)}</Text>
              <Note>{formatDisplayDate((all[match.event]?.date as never) ?? null)}</Note>
              <Text size="sm" mt={4}>{t("Is this the same one?")}</Text>
              <Group gap={4} mt={4}>
                <Button size="compact-xs" variant={same === true ? "filled" : "light"} onClick={() => setSame(true)}>{t("Yes, the same one")}</Button>
                <Button size="compact-xs" variant={same === false ? "filled" : "light"} onClick={() => setSame(false)}>{t("No, a different one")}</Button>
              </Group>
              {usingExisting && <Note>{t("The document will be added as evidence for it. Nothing else about it changes.")}</Note>}
            </Paper>
          )}
          {!usingExisting && !undecided && (
            <>
              <TextInput size="xs" label={t("When? (a year is fine)")} placeholder={t("e.g. June 1972")} value={dateText} onChange={(e) => setDateText(e.currentTarget.value)}
                description={date ? `${t("Read as")}: ${formatDisplayDate(date)}` : undefined} />
              <EventPlacePicker
                value={place && "handle" in place ? place.handle : null}
                all={all}
                onPick={(h, name) => setPlace(h ? { handle: h, name } : null)}
                onNew={(name) => setPlace({ name })}
              />
              {place && !("handle" in place) && <Note>{t("New place")}: {place.name}</Note>}
            </>
          )}
        </>
      )}
      <Footer>
        <Button size="xs" disabled={!occasion || undecided || (occasion.label === "Other" && !otherName.trim())} rightSection={<TreeMark />}
          onClick={() => occasion && actions.onEvent({
            occasion, who1, who2: wedding ? who2 : null, existing: usingExisting ? match : null,
            date: date as unknown as Record<string, unknown> | null,
            place: place ? ("handle" in place ? { handle: place.handle } : { name: place.name }) : null,
            otherName: otherName.trim(), records: all,
          })}>
          {usingExisting ? t("Add it as evidence") : occasion ? t("Add the {occasion}").replace("{occasion}", t(occasion.label).toLowerCase()) : t("Add")}
        </Button>
        <Button size="xs" variant="subtle" color="gray" onClick={() => actions.onStep("done")}>{t("Skip")}</Button>
      </Footer>
    </>
  );
}

