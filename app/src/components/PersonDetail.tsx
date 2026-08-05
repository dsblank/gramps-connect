import { useEffect, useState } from "react";
import { Alert, Anchor, Collapse, Group, Loader, ScrollArea, Stack, Text, Title, UnstyledButton } from "@mantine/core";
import { getToken } from "../auth/auth";
import { formatHash } from "../hash";
import { getViewStore } from "../store/registry";
import { fetchPersonDetail, fetchPersonEventRefs, resolveEventHandle } from "../store/personProfile";
import type { EventProfile, FamilyProfile, PersonProfile } from "../store/personProfile";

interface PersonDetailProps {
  handle: string;
  /** Bumped by ViewStore.applyLiveChange on any live-sync update to the
   * "person" table -- included so the effect below re-fetches this
   * person's profile when a poll picks up a change to it, not just when
   * the user selects a different row. */
  revision: number;
}

const SEX_SYMBOL: Record<PersonProfile["sex"], string> = { M: "♂", F: "♀", X: "⚧", U: "" };

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; profile: PersonProfile };

// Server sends {} rather than omitting the key when a family has no
// father/mother, or a person has no birth/death event -- {} is truthy in
// JS, so presence has to be checked via a field that's only ever set on a
// real record.
function hasPerson(p: PersonProfile | undefined): p is PersonProfile {
  return !!p?.handle;
}

function hasEvent(e: EventProfile | undefined): e is EventProfile {
  return !!e?.date;
}

// Anchor's own "rendered as a button" styles default to a flex-centered,
// full-width control (built for icon+label button content) -- overridden
// back to plain inline text so these read as a name/date, not a wide
// centered button. Shared by PersonSummary's name link and EventLine.
const LINK_STYLE = { display: "inline", width: "auto", textAlign: "left" } as const;

// PersonDetail only ever mounts for the "person" view (see DetailPanel.tsx's
// dispatch on view.key), so a parent/spouse/child link's target view store
// is always this one.
function navigateToPerson(handle: string) {
  getViewStore("person").navigateToHandle(handle).catch((err) => {
    console.error(`[person] failed to navigate to ${handle}`, err);
  });
}

// Unlike navigateToPerson, this can't just call a "person" store method --
// the target is the *Event* view, which isn't mounted right now (PersonDetail
// only ever shows while "person" is active). Setting the hash directly
// reaches it anyway: useHistorySync's hashchange listener applies whatever
// hash it sees, regardless of who set it, so this switches the active tab
// to Event and selects the row as a side effect of the same mechanism that
// makes the browser's Back button work.
async function navigateToEvent(personHandle: string, kind: "birth" | "death") {
  try {
    const token = await getToken();
    const refs = await fetchPersonEventRefs(token, personHandle);
    const eventHandle = resolveEventHandle(refs, kind);
    // No explicit ref -- profile.birth/death was server-side-fallback-
    // derived from some other event (see resolveEventHandle's doc comment)
    // that can't be identified from here. Leaving the line inert is safer
    // than guessing wrong.
    if (!eventHandle) return;
    window.location.hash = formatHash({ viewKey: "event", handle: eventHandle });
  } catch (err) {
    console.error(`[event] failed to navigate to ${kind} event for ${personHandle}`, err);
  }
}

function EventLine({
  symbol,
  event,
  personHandle,
  kind,
}: {
  symbol: string;
  event: EventProfile | undefined;
  personHandle: string;
  kind: "birth" | "death";
}) {
  if (!hasEvent(event)) return null;
  return (
    <Anchor
      component="button"
      type="button"
      size="md"
      underline="hover"
      style={LINK_STYLE}
      onClick={() => navigateToEvent(personHandle, kind)}
    >
      {symbol} {event.date}
      {event.place ? ` in ${event.place}` : ""}
    </Anchor>
  );
}

function PersonSummary({ person }: { person: PersonProfile }) {
  return (
    <Stack gap={0}>
      <Anchor
        component="button"
        type="button"
        size="md"
        fw={600}
        underline="hover"
        style={LINK_STYLE}
        onClick={() => navigateToPerson(person.handle)}
      >
        {person.name_display} {SEX_SYMBOL[person.sex]}
      </Anchor>
      <EventLine symbol="*" event={person.birth} personHandle={person.handle} kind="birth" />
      <EventLine symbol="✝" event={person.death} personHandle={person.handle} kind="death" />
    </Stack>
  );
}

function SectionToggle({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <UnstyledButton onClick={onToggle} style={{ display: "block", cursor: "pointer" }}>
      <Text size="md" fw={600}>
        {open ? "▾" : "▸"} {label}
      </Text>
    </UnstyledButton>
  );
}

function FamilySection({ person, family }: { person: PersonProfile; family: FamilyProfile }) {
  const [open, setOpen] = useState(true);
  const father = family.father;
  const mother = family.mother;
  const spouse = hasPerson(father) && father.handle !== person.handle
    ? father
    : hasPerson(mother) && mother.handle !== person.handle
      ? mother
      : null;

  return (
    <div>
      <SectionToggle label={`Family: ${family.gramps_id}`} open={open} onToggle={() => setOpen((v) => !v)} />
      <Collapse in={open}>
        <Stack gap="sm" pl="md" pt="xs">
          {spouse && (
            <div>
              <Text size="sm" c="dimmed">Spouse:</Text>
              <PersonSummary person={spouse} />
            </div>
          )}
          {family.children.length > 0 && (
            <div>
              <Text size="sm" c="dimmed">Children:</Text>
              <Stack gap="xs" mt={4}>
                {family.children.map((child, i) => (
                  <Group key={child.handle} gap={6} wrap="nowrap" align="flex-start">
                    <Text size="md" c="dimmed">{i + 1}.</Text>
                    <PersonSummary person={child} />
                  </Group>
                ))}
              </Stack>
            </div>
          )}
        </Stack>
      </Collapse>
    </div>
  );
}

/** Person-specific detail view (see DetailPanel.tsx for the generic
 * fallback other object types get) -- fetches the full, display-ready
 * profile fresh on every handle change (or live-sync revision bump)
 * rather than deriving it from DataTable's cached row, which only
 * carries the flat columns PERSON_VIEW.columns lists. */
export function PersonDetail({ handle, revision }: PersonDetailProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [parentsOpen, setParentsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    setParentsOpen(false);
    (async () => {
      try {
        const token = await getToken();
        const profile = await fetchPersonDetail(token, handle);
        if (!cancelled) setState({ status: "ready", profile });
      } catch (err: any) {
        if (!cancelled) setState({ status: "error", message: err.message ?? String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handle, revision]);

  if (state.status === "loading") {
    return (
      <Group p="md">
        <Loader size="sm" />
      </Group>
    );
  }
  if (state.status === "error") {
    return (
      <Alert color="red" m="md" title="Failed to load person">
        {state.message}
      </Alert>
    );
  }

  const { profile } = state;
  const parentFather = profile.primary_parent_family?.father;
  const parentMother = profile.primary_parent_family?.mother;
  const showParents = hasPerson(parentFather) || hasPerson(parentMother);

  return (
    <ScrollArea h="100%" type="auto">
      <Stack gap="md" p="md">
        <div>
          <Title order={3}>
            {profile.name_display} {SEX_SYMBOL[profile.sex]}
          </Title>
          <Text size="sm" c="dimmed">ID: {profile.gramps_id}</Text>
        </div>
        <Stack gap={0}>
          <EventLine symbol="*" event={profile.birth} personHandle={profile.handle} kind="birth" />
          <EventLine symbol="✝" event={profile.death} personHandle={profile.handle} kind="death" />
        </Stack>

        {showParents && (
          <div>
            <SectionToggle label="Parents" open={parentsOpen} onToggle={() => setParentsOpen((v) => !v)} />
            <Collapse in={parentsOpen}>
              <Stack gap="xs" pl="md" pt="xs">
                {hasPerson(parentFather) && <PersonSummary person={parentFather} />}
                {hasPerson(parentMother) && <PersonSummary person={parentMother} />}
              </Stack>
            </Collapse>
          </div>
        )}

        {(profile.families ?? []).map((family) => (
          <FamilySection key={family.handle} person={profile} family={family} />
        ))}
      </Stack>
    </ScrollArea>
  );
}
