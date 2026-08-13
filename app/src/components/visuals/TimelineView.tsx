import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge, Box, Button, CloseButton, Group, Paper, Text, TextInput, Tooltip, UnstyledButton,
  useComputedColorScheme,
} from "@mantine/core";
import { useVisualData } from "../../hooks/useVisualData";
import { useVisualScope } from "../../hooks/useVisualScope";
import { formatHash, type VisualSubject } from "../../hash";
import type { TimelineEvent } from "../../store/visualData";
import { CATEGORIES, categoryOf, dotStyle, type EventCategory } from "./eventCategories";
import { readVisualColors } from "./cssVar";
import { ScopeChip, type ScopeMode } from "./ScopeChip";
import { TimelineChart } from "./TimelineChart";
import { VisualFrame } from "./VisualFrame";

/** View > Timeline: every dated event in the tree on one zoomable time axis.
 *
 * Both filters here run entirely against the in-memory rows -- no request, no
 * debounce, results on the keystroke -- which is the affordance the local
 * cache buys.
 *
 * So is the person/family scoping, which is the other thing this offers and
 * the one gramps-web reaches for the server to do: its timeline filters by
 * person with ancestors/descendants modes, via the
 * IsLessThanNthGenerationAncestorOf rule and a round trip per change. An
 * Event points forward to its place but never back to its participants, so
 * the Events cache alone can't say whose an event is -- the Person and
 * Family caches carry that (views.ts's hidden `event_refs`), which makes a
 * scoped timeline a primary-key lookup here rather than a query. See
 * store/visualScope.ts. */
export function TimelineView({ subject }: { subject: VisualSubject | null }) {
  const { data, loading, error } = useVisualData(true);
  const { scope, loading: scopeLoading, error: scopeError } = useVisualScope(subject, data);
  const [search, setSearch] = useState("");
  const [hidden, setHidden] = useState<Set<EventCategory>>(() => new Set());
  const [selected, setSelected] = useState<TimelineEvent | null>(null);

  // The scope's events this timeline can actually draw: a scope names event
  // handles, but only dated ones are plotted. This -- not
  // scope.eventHandles.size -- is what decides whether scoping does anything
  // here. Null means unscoped.
  const scopedEvents = useMemo(
    () => (scope ? data.events.filter((event) => scope.eventHandles.has(event.handle)) : null),
    [scope, data.events],
  );
  const scopeActive = scopedEvents !== null && scopedEvents.length > 0;

  // A single Event resolves to one dot, which says nothing on its own -- so
  // that subject opens framed against the whole tree instead of filtered
  // down to itself. Every other subject is a set worth seeing alone, Place
  // included: "everything that happened in this town, over time" is the one
  // combination that turns a record into a view it has nowhere else.
  const [mode, setMode] = useState<ScopeMode>("only");
  useEffect(() => {
    setMode(subject?.type === "event" ? "context" : "only");
  }, [subject?.type, subject?.handle]);

  const filtering = scopeActive && mode === "only";
  const events = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "" && hidden.size === 0 && !filtering) return data.events;
    return data.events.filter((event) => {
      if (filtering && !scope!.eventHandles.has(event.handle)) return false;
      if (hidden.has(categoryOf(event.type))) return false;
      if (needle === "") return true;
      return matches(event, needle);
    });
  }, [data.events, search, hidden, filtering, scope]);

  // The year range the scope occupies, handed to the chart to frame on
  // arrival. Padded by a tenth of its own span (and at least a year) so the
  // outermost dots aren't jammed against the plot's edges, and so a scope
  // spanning a single instant still gets a readable window rather than a
  // zero-width domain.
  //
  // Computed once per subject, in an effect guarded by a ref rather than as
  // a memo over the data: the scoped set grows while a background fill is
  // still running, and re-framing on each page would repeatedly throw away
  // whatever the user had zoomed to. State rather than a ref alone because
  // the chart needs to see it change.
  const [focus, setFocus] = useState<[number, number] | null>(null);
  const framedFor = useRef<string | null>(null);
  useEffect(() => {
    const key = subject ? `${subject.type}:${subject.handle}` : null;
    if (key === null) {
      framedFor.current = null;
      setFocus(null);
      return;
    }
    if (!scopeActive || framedFor.current === key) return;
    framedFor.current = key;
    let min = Infinity;
    let max = -Infinity;
    for (const event of scopedEvents!) {
      if (event.year < min) min = event.year;
      if (event.year > max) max = event.year;
    }
    const pad = Math.max((max - min) * 0.1, 1);
    setFocus([min - pad, max + pad]);
  }, [scopeActive, scopedEvents, subject?.type, subject?.handle]);

  // Per-category totals for the legend, over the text-filtered and (when
  // one is filtering) scope-filtered set, but *not* the category-filtered
  // one -- a legend row has to keep showing its own count while it's
  // switched off, or turning it back on is a guess. The scope does belong
  // in here though: a legend reading "412 Births" beside a plot of one
  // person's three dots would be describing a different chart.
  const counts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const tally = new Map<EventCategory, number>();
    for (const event of filtering ? scopedEvents! : data.events) {
      if (needle !== "" && !matches(event, needle)) continue;
      const category = categoryOf(event.type);
      tally.set(category, (tally.get(category) ?? 0) + 1);
    }
    return tally;
  }, [data.events, search, filtering, scopedEvents]);

  function toggle(category: EventCategory) {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  // An event that drops out of the filtered set can't stay selected -- its
  // card would describe a dot that's no longer drawn. Mirrors MapView's own
  // guard on the selected place.
  useEffect(() => {
    if (selected && !events.some((e) => e.handle === selected.handle)) setSelected(null);
  }, [events, selected]);

  function openEvent(handle: string) {
    // Hand off to the Events view, where the three-pane layout shows the
    // whole record -- see VisualFrame's doc comment. Reached only from the
    // detail card's own button, never from a click in the plot.
    window.location.hash = formatHash({ viewKey: "event", handle });
  }

  const undated = data.eventsCached - data.events.length;

  return (
    <VisualFrame
      title="Timeline"
      scope={subject && (
        <ScopeChip
          visual="timeline"
          scope={scope}
          loading={scopeLoading}
          unresolved={!scopeLoading && scopeError === null && scope === null}
          mode={mode}
          onModeChange={setMode}
          matched={scopedEvents?.length ?? 0}
          noun="event"
        />
      )}
      loading={loading}
      error={error}
      empty={data.events.length === 0 ? (
        <Text size="sm" c="dimmed" ta="center">
          No event in this tree has a date that can be placed on a timeline.
        </Text>
      ) : undefined}
      toolbar={
        <Group gap="md" wrap="wrap">
          <TextInput
            size="xs"
            w={280}
            placeholder="Filter by type, place or description"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            rightSection={search ? <CloseButton size="sm" onClick={() => setSearch("")} /> : null}
            aria-label="Filter events"
          />
          <Legend counts={counts} hidden={hidden} onToggle={toggle} />
        </Group>
      }
      status={
        <Group gap="xs" justify="space-between">
          <Text size="xs" c="dimmed">
            {events.length.toLocaleString()} of {data.events.length.toLocaleString()} dated events shown
            {undated > 0 && ` · ${undated.toLocaleString()} undated events omitted`}
          </Text>
          <Text size="xs" c="dimmed">
            {data.eventsCached < data.eventsTotal
              ? `from ${data.eventsCached.toLocaleString()} of ${data.eventsTotal.toLocaleString()} events cached so far — still filling`
              : "drag to pan · scroll to zoom · click a dot for details"}
          </Text>
        </Group>
      }
    >
      <TimelineChart
        events={events}
        allEvents={data.events}
        // Only in context mode -- in "only" mode every dot drawn is already
        // a scoped one, so dimming would have nothing to say.
        highlighted={scopeActive && mode === "context" ? scope!.eventHandles : undefined}
        focus={focus}
        selectedHandle={selected?.handle ?? null}
        onSelectEvent={setSelected}
      />
      {selected && (
        <EventCard
          event={selected}
          onOpen={() => openEvent(selected.handle)}
          onClose={() => setSelected(null)}
        />
      )}
    </VisualFrame>
  );
}

interface EventCardProps {
  event: TimelineEvent;
  onOpen: () => void;
  onClose: () => void;
}

/** The clicked dot's details, and the one control that leaves the timeline
 * for the Events view -- the exact counterpart of the map's PlaceCard, in
 * the same corner, with the same shape and the same commit button, because
 * the two plots now answer a click the same way. Bottom-left, clear of the
 * axis strip below and the zoom controls at the right. */
function EventCard({ event, onOpen, onClose }: EventCardProps) {
  return (
    <Paper
      withBorder
      shadow="md"
      p="sm"
      // Same offsets as PlaceCard, which clear maplibre's scale control
      // there and the 26px axis strip here.
      style={{ position: "absolute", left: 12, bottom: 42, width: 280, zIndex: 3 }}
    >
      <Group justify="space-between" wrap="nowrap" gap="xs" mb={4}>
        <Text size="sm" fw={600} lineClamp={2}>{event.type || "Event"}</Text>
        <CloseButton size="sm" onClick={onClose} aria-label="Close event details" />
      </Group>
      <Group gap="xs" mb="xs">
        {event.grampsId && <Badge size="xs" variant="light" color="gray">{event.grampsId}</Badge>}
        {event.dateText && <Badge size="xs" variant="light">{event.dateText}</Badge>}
      </Group>
      {event.placeTitle && <Text size="xs" mb={4}>{event.placeTitle}</Text>}
      {event.description && (
        <Text size="xs" c="dimmed" mb="xs" lineClamp={3}>{event.description}</Text>
      )}
      <Button size="xs" fullWidth onClick={onOpen}>Open in Events</Button>
    </Paper>
  );
}

function matches(event: TimelineEvent, needle: string): boolean {
  return (
    event.type.toLowerCase().includes(needle) ||
    event.placeTitle.toLowerCase().includes(needle) ||
    event.description.toLowerCase().includes(needle) ||
    event.grampsId.toLowerCase().includes(needle)
  );
}

interface LegendProps {
  counts: Map<EventCategory, number>;
  hidden: Set<EventCategory>;
  onToggle: (category: EventCategory) => void;
}

/** Always present (there's more than one series), always labelled, and
 * doubling as the category filter -- so identity never rests on colour alone,
 * which is also the relief the light-mode aqua slot's contrast requires. */
function Legend({ counts, hidden, onToggle }: LegendProps) {
  const dark = useComputedColorScheme("light") === "dark";
  const colors = readVisualColors();
  return (
    <Group gap="xs" role="group" aria-label="Event categories">
      {CATEGORIES.map((category) => {
        const style = dotStyle(category.key, dark, colors.muted);
        const off = hidden.has(category.key);
        return (
          <Tooltip key={category.key} label={`${category.hint} — click to ${off ? "show" : "hide"}`} withArrow>
            <UnstyledButton
              onClick={() => onToggle(category.key)}
              aria-pressed={!off}
              style={{ opacity: off ? 0.4 : 1 }}
            >
              <Group gap={6} wrap="nowrap">
                <Box
                  w={10}
                  h={10}
                  style={{
                    borderRadius: "50%",
                    background: style.fill ?? "transparent",
                    border: style.fill ? undefined : `1.5px solid ${style.stroke}`,
                  }}
                />
                {/* Label in a text token, not the series colour. */}
                <Text size="xs" td={off ? "line-through" : undefined}>{category.label}</Text>
                <Badge size="xs" variant="light" color="gray">
                  {(counts.get(category.key) ?? 0).toLocaleString()}
                </Badge>
              </Group>
            </UnstyledButton>
          </Tooltip>
        );
      })}
    </Group>
  );
}
