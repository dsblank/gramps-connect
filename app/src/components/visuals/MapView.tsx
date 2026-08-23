import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge, Box, Button, CloseButton, Group, Loader, Paper, RangeSlider, Stack, Switch, Text, TextInput,
} from "@mantine/core";
import { useVisualData } from "../../hooks/useVisualData";
import { useVisualScope } from "../../hooks/useVisualScope";
import { formatHash, type VisualSubject } from "../../hash";
import type { EventRecord, MapPlace } from "../../store/visualData";
import { MapModeControl } from "./MapModeControl";
import type { MapMode } from "./mapStyles";
import { NoMatches } from "./NoMatches";
import { ScopeChip, type ScopeMode } from "./ScopeChip";
import { VisualFrame } from "./VisualFrame";
import { t } from "../../i18n/i18n";

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
  const visual = useVisualData(true);
  const { data, loading, error } = visual;
  const { scope, loading: scopeLoading, error: scopeError } = useVisualScope(subject, visual);
  const [search, setSearch] = useState("");
  const [timeOn, setTimeOn] = useState(false);
  const [fitRequest, setFitRequest] = useState(0);
  const [selected, setSelected] = useState<MapPlace | null>(null);

  // The historical-map mode (see MapModeControl / mapStyles.ts) -- distinct
  // from `timeOn`/`range` above, which filter which places are drawn rather
  // than which basemap tiles are shown.
  const [mapMode, setMapMode] = useState<MapMode>("standard");
  const [historicalYear, setHistoricalYear] = useState(() => new Date().getFullYear());

  // "Auto" resolves to the latest year among the current subject's linked
  // events -- null when there's no scoped subject to derive one from (the
  // whole-tree map), where Auto has nothing to differ from Standard by.
  const autoYear = useMemo(() => {
    if (!scope) return null;
    let max = -Infinity;
    for (const handle of scope.eventHandles) {
      const year = data.eventsByHandle.get(handle)?.year;
      if (year != null && year > max) max = year;
    }
    return Number.isFinite(max) ? Math.floor(max) : null;
  }, [scope, data]);

  // The scope's places that this map can actually draw, with their event
  // counts and years *recomputed against the scope*.
  //
  // That recomputation is the whole point. MapPlace.eventCount and .years
  // are tallied over every cached event in the tree (visualData.ts), which
  // is right for the whole-tree map and actively misleading on a scoped
  // one: a place where a couple had a single wedding would take its marker
  // size, its "1,204 events" and its 1650-1980 span from everyone else's
  // events there, so the only thing on screen that meant anything about
  // this family was *which* markers appeared. Now the marker size, the
  // detail card and the year filter all describe the scope.
  //
  // Null means unscoped, where the whole-tree figures are the correct ones.
  const scopedPlaces = useMemo(() => {
    if (!scope) return null;
    const result: MapPlace[] = [];
    for (const place of data.places) {
      if (!scope.placeHandles.has(place.handle)) continue;
      const here = (data.eventsByPlace.get(place.handle) ?? [])
        .filter((handle) => scope.eventHandles.has(handle));
      const years: number[] = [];
      for (const handle of here) {
        const year = data.eventsByHandle.get(handle)?.year;
        if (year != null) years.push(year);
      }
      years.sort((a, b) => a - b);
      result.push({ ...place, eventCount: here.length, years });
    }
    return result;
  }, [scope, data]);
  // A resolved scope is active even when it matched nothing. It used to take
  // a non-empty match to count, so a record with no located place fell back
  // to plotting the entire tree -- see NoMatches: the filter is honoured and
  // the empty result is said out loud instead.
  const scopeActive = scopedPlaces !== null;

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

  // In "only" mode the scoped copies *are* the map, so they replace the
  // whole-tree rows outright. In context mode the tree is deliberately what's
  // plotted, and its own figures are the honest ones there.
  const filtering = scopeActive && mode === "only";
  const source = filtering ? scopedPlaces! : data.places;

  // The years actually present, so the slider's ends are the range of
  // whatever is on the map -- the tree's own, or the scope's when one is
  // filtering, rather than an arbitrary 1500-to-now.
  const yearBounds = useMemo<[number, number]>(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const place of source) {
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
  }, [source]);

  const [range, setRange] = useState<[number, number]>(yearBounds);
  // Re-seed the range whenever the data's own bounds change (first load, or a
  // background-fill page widening them) -- but only while the filter is off,
  // so it never yanks a range the user has set.
  useEffect(() => {
    if (!timeOn) setRange(yearBounds);
  }, [yearBounds, timeOn]);

  // Seed the historical slider on *entering* historical mode -- to the
  // subject's own auto year when there is one (switching from Auto to
  // Historical should hand off the same year, not jump to some default),
  // or the map's latest year otherwise. Left alone the rest of the time, so
  // it doesn't yank a year the user is actively dragging.
  const wasHistoricalRef = useRef(false);
  useEffect(() => {
    if (mapMode === "historical" && !wasHistoricalRef.current) {
      setHistoricalYear(autoYear ?? yearBounds[1]);
    }
    wasHistoricalRef.current = mapMode === "historical";
  }, [mapMode, autoYear, yearBounds]);

  // "standard" never touches OHM; "auto" and "historical" both do, differing
  // only in where the year comes from (see MapModeControl's doc comment).
  const ohmYear = mapMode === "standard" ? null : mapMode === "auto" ? autoYear : historicalYear;

  const places = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return source.filter((place) => {
      if (needle !== "" && !place.title.toLowerCase().includes(needle)
        && !place.grampsId.toLowerCase().includes(needle)) {
        return false;
      }
      if (timeOn && !place.years.some((year) => year >= range[0] && year <= range[1])) return false;
      return true;
    });
  }, [source, search, timeOn, range]);

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
    // Nothing to fit to yet: a scope can resolve empty and stay that way, or
    // fill in as the caches do, so this waits for a marker rather than
    // spending the one fit this subject gets on an empty set.
    if (!scopeActive || scopedPlaces!.length === 0 || fittedFor.current === key) return;
    fittedFor.current = key;
    setFitRequest((n) => n + 1);
    // A place subject names one specific marker, not just an area to frame
    // -- selecting it opens its detail card and, via MapCanvas's own
    // MapPlace.kmlMedia handling, draws any KML file attached to it, so a
    // "Map" link from that file's own media page (MediaMapButton.tsx) lands
    // on it drawn rather than one more click away.
    if (subject?.type === "place") {
      const own = scopedPlaces!.find((p) => p.handle === subject.handle);
      if (own) setSelected(own);
    }
  }, [scopeActive, scopedPlaces, subject?.type, subject?.handle]);

  // The scoped events at the clicked place -- the answer to "why is this
  // marker here?", which a count alone can't give. Null when unscoped,
  // where the card keeps to its summary: a busy place can hold hundreds of
  // events tree-wide, and listing them all would be a worse card, not a
  // better one.
  const selectedEvents = useMemo(() => {
    if (!selected || !scope) return null;
    const records = (data.eventsByPlace.get(selected.handle) ?? [])
      .filter((handle) => scope.eventHandles.has(handle))
      .map((handle) => data.eventsByHandle.get(handle))
      .filter((record): record is EventRecord => record !== undefined);
    // Chronological, with undated events last rather than sorted as if they
    // were year zero.
    records.sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity));
    return records;
  }, [selected, scope, data]);

  // Naming whose event each one is only earns its space when the scope
  // actually draws from more than one record -- true of a family (the
  // couple plus each parent), pointless for a person, where every row would
  // repeat the name already on the chip above.
  const namedContributors = scope ? new Set(scope.contributor.values()).size > 1 : false;

  function openPlace(handle: string) {
    window.location.hash = formatHash({ viewKey: "place", handle });
  }

  // While filtering, the places dropped for want of coordinates are the
  // scope's own -- the tree-wide figure would be describing places this map
  // was never going to show anyway.
  const withoutCoords = filtering
    ? scope!.placeHandles.size - scopedPlaces!.length
    : data.placesCached - data.places.length;

  // Nothing plotted, with places in the tree to plot -- so it's the scope or
  // the filters that emptied the map, and which one decides both what to say
  // and what the one button undoes. (`data.places` empty is the other case
  // entirely, and VisualFrame's `empty` has it.)
  const noMatches = data.places.length > 0 && places.length === 0
    ? filtering && scopedPlaces!.length === 0
      ? {
        title: `Nothing to map for ${scope!.label}`,
        detail: scope!.placeHandles.size === 0
          ? "None of this record's events names a place."
          : withoutCoords === 1
            ? "Its one place has no coordinates."
            : `None of its ${withoutCoords.toLocaleString()} places has coordinates.`,
        action: { label: "Show the whole tree", href: formatHash({ viewKey: "map" }) },
      }
      : {
        title: "No places match these filters",
        detail: filtering
          ? "Widen them to see the rest of this record's places."
          : "Widen them to see the rest of the tree.",
        action: {
          label: "Clear filters",
          onClick: () => { setSearch(""); setTimeOn(false); },
        },
      }
    : null;

  return (
    <VisualFrame
      title={t("Map")}
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
          <Text size="sm" c="dimmed" ta="center">{t("No place in this tree has coordinates.")}</Text>
          <Text size="xs" c="dimmed" ta="center">
            {t("Add latitude and longitude to a place and it will appear here.")}
          </Text>
        </Stack>
      ) : undefined}
      toolbar={
        <Group gap="lg" wrap="wrap" align="center">
          <TextInput
            size="xs"
            w={260}
            placeholder={t("Find a place")}
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
              label={t("Years")}
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
            {t("Fit to results")}
          </Button>
          <MapModeControl
            mode={mapMode}
            onModeChange={setMapMode}
            autoYear={autoYear}
            year={historicalYear}
            onYearChange={setHistoricalYear}
            yearBounds={yearBounds}
          />
        </Group>
      }
      status={
        <Group gap="xs" justify="space-between">
          <Text size="xs" c="dimmed">
            {/* Both numbers come from `source`, so while filtering they
                describe the scope ("2 of 2 of this family's places") rather
                than quoting a tree-wide total the map isn't showing. */}
            {places.length.toLocaleString()} of {source.length.toLocaleString()} located places shown
            {withoutCoords > 0 && ` · ${withoutCoords.toLocaleString()} without coordinates omitted`}
          </Text>
          <Text size="xs" c="dimmed">
            {data.placesCached < data.placesTotal
              ? `from ${data.placesCached.toLocaleString()} of ${data.placesTotal.toLocaleString()} places cached so far — still filling`
              : filtering
                ? "marker size shows how many of these events happened there · click a marker to see which"
                : "marker size shows how many events happened there · click a marker for details"}
          </Text>
        </Group>
      }
    >
      <Suspense
        fallback={
          <Stack align="center" justify="center" gap="xs" style={{ flex: 1 }}>
            <Loader size="sm" />
            <Text size="sm" c="dimmed">{t("Loading map…")}</Text>
          </Stack>
        }
      >
        <MapCanvas
          places={places}
          fitRequest={fitRequest}
          // Only in context mode: in "only" mode every marker drawn is
          // already a scoped one, so dimming would have nothing to say. Nor
          // with an empty scope, where it would dim every marker on the map
          // to make a point the chip above already makes in words.
          highlighted={scopeActive && mode === "context" && scopedPlaces!.length > 0
            ? scope!.placeHandles
            : undefined}
          fitTo={scopeActive && mode === "context" ? scopedPlaces! : undefined}
          selectedHandle={selected?.handle ?? null}
          onSelectPlace={setSelected}
          ohmYear={ohmYear}
        />
      </Suspense>
      {noMatches && <NoMatches {...noMatches} />}
      {selected && (
        <PlaceCard
          place={selected}
          events={selectedEvents}
          contributor={namedContributors ? scope!.contributor : null}
          onOpen={() => openPlace(selected.handle)}
          onClose={() => setSelected(null)}
        />
      )}
    </VisualFrame>
  );
}

interface PlaceCardProps {
  place: MapPlace;
  /** The scoped events here, chronologically -- null when the map isn't
   * scoped, where the summary above is all this card shows. */
  events: EventRecord[] | null;
  /** Event handle -> whose record it came from, or null when naming them
   * would add nothing (see namedContributors). */
  contributor: Map<string, string> | null;
  onOpen: () => void;
  onClose: () => void;
}

/** The clicked marker's details, and the one control that leaves the map for
 * the Places view. Bottom-left, clear of maplibre's own controls (navigation
 * top-right, scale bottom-left is shifted by this card's own margin).
 *
 * On a scoped map it also lists the events that put this place in scope,
 * which is the question a scoped marker actually raises -- "Cardiff, 2
 * events" doesn't distinguish where a couple married from where one of them
 * was born, and for a family map that distinction is the entire content. */
function PlaceCard({ place, events, contributor, onOpen, onClose }: PlaceCardProps) {
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
      {events && events.length > 0 && (
        // Capped and scrolled: a place can hold a dozen of one person's
        // events, and an unbounded list would push the card off the map.
        <Stack gap={4} mb="xs" style={{ maxHeight: 150, overflowY: "auto" }}>
          {events.map((event) => (
            <div key={event.handle}>
              <Text size="xs" fw={500}>
                {event.type}
                {/* Said out loud rather than left blank -- an undated event
                    is still why this marker is here, and a bare type would
                    read as a rendering gap. */}
                <Text span size="xs" c="dimmed" fw={400}>
                  {" · "}{event.dateText || "no date"}
                </Text>
              </Text>
              {contributor?.get(event.handle) && (
                <Text size="xs" c="dimmed">{contributor.get(event.handle)}</Text>
              )}
            </div>
          ))}
        </Stack>
      )}
      <Button size="xs" fullWidth onClick={onOpen}>{t("Open in Places")}</Button>
    </Paper>
  );
}
