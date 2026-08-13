import { useMemo, useState } from "react";
import {
  Badge, Box, CloseButton, Group, Text, TextInput, Tooltip, UnstyledButton, useComputedColorScheme,
} from "@mantine/core";
import { useVisualData } from "../../hooks/useVisualData";
import { formatHash } from "../../hash";
import type { TimelineEvent } from "../../store/visualData";
import { CATEGORIES, categoryOf, dotStyle, type EventCategory } from "./eventCategories";
import { readVisualColors } from "./cssVar";
import { TimelineChart } from "./TimelineChart";
import { VisualModal } from "./VisualModal";

interface TimelineModalProps {
  opened: boolean;
  onClose: () => void;
}

/** View > Timeline: every dated event in the tree on one zoomable time axis.
 *
 * Both filters here run entirely against the in-memory rows -- no request, no
 * debounce, results on the keystroke -- which is the affordance the local
 * cache buys. That's also why they're the filters they are: gramps-web's
 * timeline filters by *person* with ancestors/descendants modes, which needs
 * the server's IsLessThanNthGenerationAncestorOf rule and a round trip per
 * change. The cached Events rows carry their own type, description and place
 * title but no person link, so what's local and instant is a text match over
 * those three plus the category legend, and that's what this offers. A
 * person-scoped timeline is better served by the Events list on a person's
 * own detail panel anyway. */
export function TimelineModal({ opened, onClose }: TimelineModalProps) {
  const { data, loading, error } = useVisualData(opened);
  const [search, setSearch] = useState("");
  const [hidden, setHidden] = useState<Set<EventCategory>>(() => new Set());

  const events = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "" && hidden.size === 0) return data.events;
    return data.events.filter((event) => {
      if (hidden.has(categoryOf(event.type))) return false;
      if (needle === "") return true;
      return matches(event, needle);
    });
  }, [data.events, search, hidden]);

  // Per-category totals for the legend, over the text-filtered set but *not*
  // the category-filtered one -- a legend row has to keep showing its own
  // count while it's switched off, or turning it back on is a guess.
  const counts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const tally = new Map<EventCategory, number>();
    for (const event of data.events) {
      if (needle !== "" && !matches(event, needle)) continue;
      const category = categoryOf(event.type);
      tally.set(category, (tally.get(category) ?? 0) + 1);
    }
    return tally;
  }, [data.events, search]);

  function toggle(category: EventCategory) {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  function openEvent(handle: string) {
    // Hand off to the Events view, where the three-pane layout shows the
    // whole record -- see VisualModal's doc comment.
    window.location.hash = formatHash({ viewKey: "event", handle });
    onClose();
  }

  const undated = data.eventsCached - data.events.length;

  return (
    <VisualModal
      opened={opened}
      onClose={onClose}
      title="Timeline"
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
              : "drag to pan · scroll to zoom · click a dot to open the event"}
          </Text>
        </Group>
      }
    >
      <TimelineChart events={events} allEvents={data.events} onOpenEvent={openEvent} />
    </VisualModal>
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
