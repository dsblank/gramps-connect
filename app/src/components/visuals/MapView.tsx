import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge, Box, Button, CloseButton, Group, Loader, Paper, RangeSlider, Stack, Switch, Text, TextInput,
} from "@mantine/core";
import { useVisualData } from "../../hooks/useVisualData";
import { useVisualScope } from "../../hooks/useVisualScope";
import { formatHash, type VisualSubject } from "../../hash";
import type { MapPlace } from "../../store/visualData";
import { ScopeChip, type ScopeMode } from "./ScopeChip";
import { VisualFrame } from "./VisualFrame";

// maplibre-gl is ~900KB of the bundle on its own -- an order of magnitude more
// than anything else here -- so it's split out and only fetched when someone
// actually opens View > Map.
const MapCanvas = lazy(() => import("./MapCanvas").then((m) => ({ default: m.MapCanvas })));

/** View > Map: every place in the tree that has coordinates, plotted from the
 * local Places cache.
 *
 * The two filters are both local and immediate, and they're the two that
 * matter for a map of a family tree: which places, and when. The time filter
 * is the one gramps-web's map has (its time slider), reworked as a plain
 * range rather than its year-plus-span pair -- "1850 to 1900" is what someone
 * actually means, and the span-around-a-year form makes them solve for it.
 * It's driven by a local join of events onto places (see visualData.ts) rather
 * than gramps-web's separate /api/events/ fetch.
 *
 * With a `subject` in the route it shows one record's slice of the tree
 * instead -- a person's places, a region's places (see store/visualScope.ts,
 * which resolves that entirely from the caches). */
export function MapView({ subject }: { subject: VisualSubject | null }) {
  const { data, loading, error } = useVisualData(true);
  const { scope, loading: scopeLoading, error: scopeError } = useVisualScope(subject, data);
  const [search, setSearch] = useState("");
  const [timeOn, setTimeOn] = useState(false);
  const [fitRequest, setFitRequest] = useState(0);
  const [selected, setSelected] = useState<MapPlace | null>(null);

  // The years actually present, so the slider's ends are the tree's own range
  // rather than an arbitrary 1500-to-now.
  const yearBounds = useMemo<[number, number]>(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const place of data.places) {
      for (const year of place.years) {
        if (year < min) min = year;
        if (year > max) max = year;
      }
    }
    if (!Number.isFinite(min)) {
      const thisYear = new Date().getFullYear();
      return [thisYear - 200, thisYear];
    }
    return [Math.floor(min), Math.ceil(max)];
  }, [data.places]);

  const [range, setRange] = useState<[number, number]>(yearBounds);
  // Re-seed the range whenever the data's own bounds change (first load, or a
  // background-fill page widening them) -- but only while the filter is off,
  // so it never yanks a range the user has set.
  useEffect(() => {
    if (!timeOn) setRange(yearBounds);
  }, [yearBounds, timeOn]);

  // The scope's places that this map can actually draw. A scope names place
  // handles; only the ones with coordinates are ever plotted, so this -- not
  // scope.placeHandles.size -- is what decides whether scoping does anything
  // here at all. Null means unscoped.
  const scopedPlaces = useMemo(
    () => (scope ? data.places.filter((place) => scope.placeHandles.has(place.handle)) : null),
    [scope, data.places],
  );
  const scopeActive = scopedPlaces !== null && scopedPlaces.length > 0;

  // A person's or family's places are a handful scattered across a
  // continent, and filtering to them is the point. A *place* subject
  // resolves to itself and whatever it encloses, and filtering to that
  // would just be a map of the one thing the user was already looking at --
  // so it opens showing where that sits in the tree instead. Same reasoning
  // as an Event, which resolves to a single marker.
  const [mode, setMode] = useState<ScopeMode>("only");
  useEffect(() => {
    setMode(subject && (subject.type === "place" || subject.type === "event") ? "context" : "only");
  }, [subject?.type, subject?.handle]);

  const filtering = scopeActive && mode === "only";
  const places = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return data.places.filter((place) => {
      if (filtering && !scope!.placeHandles.has(place.handle)) return false;
      if (needle !== "" && !place.title.toLowerCase().includes(needle)
        && !place.grampsId.toLowerCase().includes(needle)) {
        return false;
      }
      if (timeOn && !place.years.some((year) => year >= range[0] && year <= range[1])) return false;
      return true;
    });
  }, [data.places, search, timeOn, range, filtering, scope]);

  // Fit the view to a search result set, which is the whole point of typing
  // one -- but debounced by a frame's worth of keystrokes so it doesn't fly
  // the map on every character. Not fitted when the box is empty: that's
  // "show everything", and re-fitting to the world there would throw away
  // whatever the user had zoomed to.
  const searchRef = useRef(search);
  useEffect(() => {
    const previous = searchRef.current;
    searchRef.current = search;
    if (search.trim() === "" || search === previous) return;
    const timer = setTimeout(() => setFitRequest((n) => n + 1), 350);
    return () => clearTimeout(timer);
  }, [search]);

  // A place that drops out of the filtered set can't stay selected -- its
  // card would describe a marker that's no longer drawn.
  useEffect(() => {
    if (selected && !places.some((p) => p.handle === selected.handle)) setSelected(null);
  }, [places, selected]);

  // Arriving with a scope frames it, in either mode -- that's the whole
  // point of following a Map button, and in context mode the scoped markers
  // would otherwise be invisible needles in the whole-tree haystack.
  //
  // Once per subject, tracked by a ref rather than by the effect's deps.
  // `scope` is a fresh object every time the underlying caches change, and
  // they change repeatedly while a background fill is still running -- so
  // depending on it directly would re-fit the map every few hundred rows,
  // yanking the viewport back from wherever the user had just panned it.
  const fittedFor = useRef<string | null>(null);
  useEffect(() => {
    const key = subject ? `${subject.type}:${subject.handle}` : null;
    if (key === null) fittedFor.current = null;
    if (!scopeActive || fittedFor.current === key) return;
    fittedFor.current = key;
    setFitRequest((n) => n + 1);
  }, [scopeActive, subject?.type, subject?.handle]);

  function openPlace(handle: string) {
    window.location.hash = formatHash({ viewKey: "place", handle });
  }

  const withoutCoords = data.placesCached - data.places.length;

  return (
    <VisualFrame
      title="Map"
      scope={subject && (
        <ScopeChip
          visual="map"
          scope={scope}
          loading={scopeLoading}
          unresolved={!scopeLoading && scopeError === null && scope === null}
          mode={mode}
          onModeChange={setMode}
          matched={scopedPlaces?.length ?? 0}
          noun="place"
        />
      )}
      loading={loading}
      error={error}
      empty={data.places.length === 0 ? (
        <Stack align="center" gap="xs">
          <Text size="sm" c="dimmed" ta="center">No place in this tree has coordinates.</Text>
          <Text size="xs" c="dimmed" ta="center">
            Add latitude and longitude to a place and it will appear here.
          </Text>
        </Stack>
      ) : undefined}
      toolbar={
        <Group gap="lg" wrap="wrap" align="center">
          <TextInput
            size="xs"
            w={260}
            placeholder="Find a place"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            rightSection={search ? <CloseButton size="sm" onClick={() => setSearch("")} /> : null}
            aria-label="Find a place"
          />
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 320, flex: 1, maxWidth: 520 }}>
            <Switch
              size="xs"
              checked={timeOn}
              onChange={(e) => setTimeOn(e.currentTarget.checked)}
              label="Years"
              styles={{ label: { whiteSpace: "nowrap" } }}
            />
            <RangeSlider
              size="xs"
              style={{ flex: 1 }}
              disabled={!timeOn}
              min={yearBounds[0]}
              max={yearBounds[1]}
              value={range}
              onChange={setRange}
              minRange={1}
              label={(value) => String(value)}
              marks={[
                { value: yearBounds[0], label: String(yearBounds[0]) },
                { value: yearBounds[1], label: String(yearBounds[1]) },
              ]}
              aria-label="Limit to places with events in these years"
            />
          </Group>
          <Button size="xs" variant="default" onClick={() => setFitRequest((n) => n + 1)}>
            Fit to results
          </Button>
        </Group>
      }
      status={
        <Group gap="xs" justify="space-between">
          <Text size="xs" c="dimmed">
            {places.length.toLocaleString()} of {data.places.length.toLocaleString()} located places shown
            {withoutCoords > 0 && ` · ${withoutCoords.toLocaleString()} without coordinates omitted`}
          </Text>
          <Text size="xs" c="dimmed">
            {data.placesCached < data.placesTotal
              ? `from ${data.placesCached.toLocaleString()} of ${data.placesTotal.toLocaleString()} places cached so far — still filling`
              : "marker size shows how many events happened there · click a marker for details"}
          </Text>
        </Group>
      }
    >
      <Suspense
        fallback={
          <Stack align="center" justify="center" gap="xs" style={{ flex: 1 }}>
            <Loader size="sm" />
            <Text size="sm" c="dimmed">Loading map…</Text>
          </Stack>
        }
      >
        <MapCanvas
          places={places}
          fitRequest={fitRequest}
          // Only in context mode: in "only" mode every marker drawn is
          // already a scoped one, so dimming would have nothing to say.
          highlighted={scopeActive && mode === "context" ? scope!.placeHandles : undefined}
          fitTo={scopeActive && mode === "context" ? scopedPlaces! : undefined}
          onSelectPlace={setSelected}
        />
      </Suspense>
      {selected && (
        <PlaceCard place={selected} onOpen={() => openPlace(selected.handle)} onClose={() => setSelected(null)} />
      )}
    </VisualFrame>
  );
}

interface PlaceCardProps {
  place: MapPlace;
  onOpen: () => void;
  onClose: () => void;
}

/** The clicked marker's details, and the one control that leaves the map for
 * the Places view. Bottom-left, clear of maplibre's own controls (navigation
 * top-right, scale bottom-left is shifted by this card's own margin). */
function PlaceCard({ place, onOpen, onClose }: PlaceCardProps) {
  // Both ends floored, because MapPlace.years are fractional *within* a year
  // -- so Math.floor is simply the calendar year the event falls in. Ceiling
  // the later end instead made a single 1916 event read as a two-year span,
  // "1916–1917". Collapsed to one year when both ends agree, for the same
  // reason.
  const first = place.years.length > 0 ? Math.floor(place.years[0]) : null;
  const last = place.years.length > 0 ? Math.floor(place.years[place.years.length - 1]) : null;
  const span = first === null ? null : first === last ? String(first) : `${first}–${last}`;
  return (
    <Paper
      withBorder
      shadow="md"
      p="sm"
      style={{ position: "absolute", left: 12, bottom: 42, width: 280, zIndex: 3 }}
    >
      <Group justify="space-between" wrap="nowrap" gap="xs" mb={4}>
        <Text size="sm" fw={600} lineClamp={2}>{place.title || "(untitled place)"}</Text>
        <CloseButton size="sm" onClick={onClose} aria-label="Close place details" />
      </Group>
      <Group gap="xs" mb="xs">
        <Badge size="xs" variant="light" color="gray">{place.grampsId}</Badge>
        <Badge size="xs" variant="light">
          {place.eventCount === 1 ? "1 event" : `${place.eventCount.toLocaleString()} events`}
        </Badge>
        {span && <Badge size="xs" variant="light" color="gray">{span}</Badge>}
      </Group>
      <Text size="xs" c="dimmed" mb="xs">
        {place.lat.toFixed(4)}, {place.long.toFixed(4)}
      </Text>
      <Button size="xs" fullWidth onClick={onOpen}>Open in Places</Button>
    </Paper>
  );
}
