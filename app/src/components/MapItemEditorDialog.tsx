import { useEffect, useRef, useState } from "react";
// Namespace import: maplibre-gl v5+ has no default export -- same reason
// MapCanvas.tsx uses one.
import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import { TerraDraw, TerraDrawLineStringMode, TerraDrawPointMode, TerraDrawPolygonMode, TerraDrawSelectMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { Feature, Geometry, LineString, Point, Polygon } from "geojson";
import {
  Alert, Anchor, Box, Button, Group, Loader, Modal, Stack, Text, TextInput, useComputedColorScheme,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { getToken } from "../auth/auth";
import { formatHash } from "../hash";
import { fetchAllKmlFeatures, invalidateKmlFeatures } from "../store/kmlMedia";
import { featuresToKml } from "../store/kmlWrite";
import { uploadMedia, updateMediaFile, setMediaDesc } from "../store/jobsApi";
import { fetchObjectExtended, getBacklinks } from "../store/objectDetail";
import { attachRefListEntry, detachRefListEntry } from "../store/refListApi";
import { KML_MIME } from "../store/visualData";
import { MEDIA_VIEW, PLACE_VIEW } from "../store/views";
import { mapStyleUrl } from "./visuals/mapStyles";
import { CircleGlyphButton } from "./CircleGlyphButton";
import { RecordPicker } from "./RecordPicker";
import { pickerResultLabel } from "./RefPickerField";
import type { QueryItem } from "../store/api";
import "maplibre-gl/dist/maplibre-gl.css";
import { t } from "../i18n/i18n";

// Registered once, module-level -- the same worker file MapCanvas.tsx
// points at, and maplibregl.setWorkerUrl is idempotent (it just sets a
// static field the next Map reads), so calling it again here if MapCanvas's
// module happens not to have loaded yet in this session costs nothing.
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

type DrawMode = "point" | "linestring" | "polygon" | "select";

const TOOLBAR: { mode: DrawMode; label: string }[] = [
  { mode: "point", label: "Point" },
  { mode: "linestring", label: "Line" },
  { mode: "polygon", label: "Polygon" },
  { mode: "select", label: "Select" },
];

export type MapItemEditorTarget = { kind: "new" } | { kind: "edit"; handle: string };

interface MapItemEditorDialogProps {
  target: MapItemEditorTarget;
  onClose: () => void;
  /** Fired after a successful edit-save (not a new one, which has nowhere
   * existing to refresh) -- lets RelatedPanel re-fetch the media object's
   * own detail, the same refresh MessageButton's onAttached already
   * triggers after attaching something to it. */
  onSaved?: () => void;
}

/** "Add Map Item…" (MenuBar's Add menu) and a KML media object's "Edit"
 * (MediaKmlEditButton.tsx) both open this -- a full-screen map with a
 * terra-draw toolbar for drawing/editing Point/LineString/Polygon shapes,
 * saved as a KML media object's file. Not a reuse of MapCanvas.tsx: that
 * component's source/layers are built around place clustering, which has
 * nothing to do with a blank drawing canvas -- this builds its own small
 * maplibre map instead, reusing only mapStyles.ts's basemap URL (Standard
 * only; no OHM historical mode here) and MapCanvas's worker-registration
 * pattern.
 *
 * No `opened` prop, unlike this app's other dialogs: maplibre-gl and
 * terra-draw are the heaviest thing this app can pull in (see MapView.tsx's
 * own doc comment on maplibre-gl's ~900KB), so this component is only ever
 * present in the tree at all behind a `lazy()`/`Suspense` boundary each
 * caller owns (MenuBar.tsx, MediaKmlEditButton.tsx) -- mounting it *is*
 * opening it, and the caller unmounts it (dropping this state entirely,
 * fresh next time) via `onClose` instead of toggling a boolean prop on an
 * always-mounted instance. */
export function MapItemEditorDialog({ target, onClose, onSaved }: MapItemEditorDialogProps) {
  // A callback ref surfaced as state, not a plain useRef -- this dialog's
  // <div> is inside a Mantine Modal, whose own children aren't necessarily
  // committed to the DOM in the same pass as this component's first render
  // (found live: a plain `useRef` read inside a `[]`-effect saw `null`
  // every time, so the map/draw setup below never ran at all -- an
  // indefinite spinner with nothing to catch, since the effect had already
  // returned). Assigning the DOM node to state instead means the effect
  // below (keyed on `containerEl`) reliably fires once Mantine actually
  // mounts it, whenever that turns out to be.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const dark = useComputedColorScheme("light") === "dark";
  const [mode, setMode] = useState<DrawMode>("select");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whether the canvas currently holds anything worth saving -- Save stays
  // disabled at zero, same as every create dialog's own empty-state guard.
  const [hasFeatures, setHasFeatures] = useState(false);
  // Set once loading an existing file finds a shape terra-draw can't
  // represent (a KML MultiGeometry/GeometryCollection) -- blocks the
  // canvas entirely rather than silently dropping the offending shape,
  // since a save from a partially-loaded file would delete it for real.
  const [tooComplex, setTooComplex] = useState(false);
  // The media object's own `desc` -- blank to start for a new item, loaded
  // from the existing object for an edit (see the effect below). Optional,
  // like every other field a bare Media object starts without.
  const [desc, setDesc] = useState("");
  // The one place this item is attached to -- editable here since
  // attaching the saved item to a place is what actually makes it show up
  // anywhere else (the map overlay, MediaMapButton's own "Map" link, both
  // gated on a Place backlink -- see that component's doc comment), and a
  // freshly-drawn item has nowhere to go otherwise. A single slot, not a
  // list: this editor treats "which place is this item's" as one choice,
  // matching how a map item is actually used even though gramps-web-api's
  // media_list would technically allow attaching it to several. `original`
  // is what it was (edit mode only, from backlinks) when this dialog
  // opened, so handleSave can diff against it -- attach/detach are both
  // deferred to save time rather than firing immediately on pick/remove,
  // same reasoning as every other field here (and a *new* item has no
  // handle yet to attach to before that point regardless).
  const [place, setPlace] = useState<{ handle: string; title: string } | null>(null);
  const [originalPlace, setOriginalPlace] = useState<{ handle: string; title: string } | null>(null);
  const [placePickerOpen, setPlacePickerOpen] = useState(false);

  // Edit mode only: pre-fills `desc` and `place` from the object being
  // edited, so Save doesn't blank out a description or attachment someone
  // already set. fetchObjectExtended is the same
  // `extend=all&profile=all&backlinks=1` fetch RelatedPanel's own detail
  // view makes -- getBacklinks(...).place is exactly what
  // MediaMapButton.tsx already reads to decide whether to show its own
  // "Map" link, reused here rather than a second, narrower backlinks-only
  // request. Only the first backlink is taken (see `place`'s own doc
  // comment on why this is a single slot).
  useEffect(() => {
    if (target.kind !== "edit") return;
    let cancelled = false;
    (async () => {
      const token = await getToken();
      const obj = await fetchObjectExtended(token, MEDIA_VIEW, target.handle);
      if (cancelled) return;
      setDesc((obj.desc as string | undefined) ?? "");
      const places = (getBacklinks(obj).place ?? []) as { handle: string; title?: string }[];
      const first = places[0];
      const resolved = first ? { handle: first.handle, title: first.title || first.handle } : null;
      setPlace(resolved);
      setOriginalPlace(resolved);
    })().catch(() => {
      // Best-effort -- Save still works with a blank/overwritten desc field
      // if this fetch fails, same as uploadMediaFile's own best-effort desc
      // set (jobsApi.ts).
    });
    return () => {
      cancelled = true;
    };
  }, [target]);

  useEffect(() => {
    if (!containerEl) return;
    const map = new maplibregl.Map({
      container: containerEl,
      style: mapStyleUrl(dark, null),
      center: [0, 20],
      zoom: 1.5,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [
        new TerraDrawPointMode(),
        new TerraDrawLineStringMode(),
        new TerraDrawPolygonMode(),
        // Dragging (both a whole feature and its individual vertices) and
        // deletion (terra-draw's own default keybinding, Delete/Backspace
        // on the current selection) are all this editor needs from Select
        // -- no rotate/scale, which "keep it simple" has no use for and
        // which would just be one more thing to explain.
        new TerraDrawSelectMode({
          flags: {
            point: { feature: { draggable: true } },
            linestring: {
              feature: { draggable: true, coordinates: { draggable: true, deletable: true, midpoints: true } },
            },
            polygon: {
              feature: { draggable: true, coordinates: { draggable: true, deletable: true, midpoints: true } },
            },
          },
        }),
      ],
    });
    drawRef.current = draw;
    draw.on("change", () => setHasFeatures(draw.getSnapshot().length > 0));

    // A failed style/tile fetch is the one thing that can leave this view
    // blank for a reason the user can't guess -- same reasoning and same
    // sniff-the-message approach as MapCanvas.tsx's own handler.
    map.on("error", (e) => {
      const message = (e.error as Error | undefined)?.message ?? "";
      if (/style|sprite|tile|fetch|network|Failed/i.test(message)) setError(message || t("The basemap could not be loaded."));
    });

    map.on("style.load", () => {
      // draw.start() registers terra-draw's own sources/layers on the map,
      // which maplibre only allows once the style has actually finished
      // loading -- wrapped so a failure here (a version mismatch, a mode
      // misconfiguration, ...) surfaces as a visible error instead of
      // leaving `ready` false forever.
      try {
        draw.start();
        draw.setMode("select");
      } catch (err: any) {
        setError(err.message ?? String(err));
      } finally {
        setReady(true);
      }
    });

    return () => {
      draw.stop();
      map.remove();
      mapRef.current = null;
      drawRef.current = null;
    };
    // `dark` only matters for the very first style URL -- a scheme flip
    // while this dialog happens to be open isn't worth a style reload here
    // the way MapCanvas.tsx's own crossfade handles it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerEl]);

  // Loads an existing KML media object's shapes in once the map/draw
  // instance is ready -- fetchAllKmlFeatures is the same fetch+parse+cache
  // path MapCanvas's overlay and useVisualData's position guess already
  // share, so this is free if either of those already pulled this handle
  // in during the current session.
  useEffect(() => {
    if (!ready || target.kind !== "edit") return;
    const draw = drawRef.current;
    const map = mapRef.current;
    if (!draw || !map) return;
    let cancelled = false;
    fetchAllKmlFeatures([target.handle]).then((features) => {
      if (cancelled || features.length === 0) return;
      const loadable: { type: "Feature"; geometry: Point | LineString | Polygon; properties: { mode: DrawMode } }[] = [];
      for (const feature of features) {
        const geometry = feature.geometry;
        // A direct literal check here (rather than a separate
        // geometry->mode lookup) so TypeScript narrows `geometry` itself
        // to terra-draw's GeoJSONStoreGeometries union for the push below
        // -- a MultiGeometry/GeometryCollection fails it and blocks the
        // whole load (see tooComplex's own doc comment).
        if (!geometry || (geometry.type !== "Point" && geometry.type !== "LineString" && geometry.type !== "Polygon")) {
          setTooComplex(true);
          return;
        }
        const featureMode: DrawMode =
          geometry.type === "Point" ? "point" : geometry.type === "LineString" ? "linestring" : "polygon";
        loadable.push({ type: "Feature", geometry, properties: { mode: featureMode } });
      }
      draw.addFeatures(loadable);
      const bounds = new maplibregl.LngLatBounds();
      for (const feature of loadable) extendBounds(bounds, feature.geometry);
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 60, maxZoom: 17, duration: 0 });
    }).catch((err: Error) => {
      if (!cancelled) setError(err.message);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, target]);

  function handleModeChange(next: DrawMode) {
    // Guarded, not just disabled on the button below: terra-draw's own
    // setMode() throws ("Terra Draw is not enabled") until draw.start() has
    // actually run (the style.load handler above), and a click landing in
    // that window before `ready` flips would otherwise be an uncaught
    // exception -- found live.
    if (!ready) return;
    setMode(next);
    drawRef.current?.setMode(next);
  }

  async function handleSave() {
    const draw = drawRef.current;
    if (!draw) return;
    // Geometry only -- terra-draw's own bookkeeping properties (mode, id,
    // ...) aren't meaningful outside the editor and have no KML
    // counterpart worth writing.
    const features: Feature[] = draw.getSnapshot()
      .filter((f) => f.geometry != null)
      .map((f) => ({ type: "Feature", geometry: f.geometry, properties: {} }));
    if (features.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      const blob = new Blob([featuresToKml(features)], { type: KML_MIME });
      const trimmedDesc = desc.trim();
      let handle: string;
      if (target.kind === "new") {
        handle = await uploadMedia(token, blob, KML_MIME);
        notifications.show({
          color: "green",
          title: t("Map item added"),
          message: (
            <Anchor component="a" href={formatHash({ viewKey: "media", handle })} underline="never">
              {t("Open it")}
            </Anchor>
          ),
        });
      } else {
        handle = target.handle;
        await updateMediaFile(token, handle, blob, KML_MIME);
        invalidateKmlFeatures(handle);
        notifications.show({ color: "blue", title: t("Map item updated"), message: t("Its shapes have been saved.") });
        onSaved?.();
      }
      // Best-effort, after the geometry itself is safely saved: a failure
      // setting the description or the place attachment shouldn't read as
      // "my shapes weren't saved" (they were, by this point).
      if (trimmedDesc) {
        await setMediaDesc(token, handle, trimmedDesc).catch(() => {});
      }
      if (place?.handle !== originalPlace?.handle) {
        if (originalPlace) {
          await detachRefListEntry(token, PLACE_VIEW, originalPlace.handle, "media_list", handle).catch(() => {});
        }
        if (place) {
          await attachRefListEntry(
            token, PLACE_VIEW, place.handle, "media_list", { _class: "MediaRef", ref: handle }
          ).catch(() => {});
        }
      }
      onClose();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  const title = target.kind === "new" ? t("Add Map Item") : t("Edit Map Item");

  return (
    <Modal opened onClose={onClose} fullScreen withCloseButton={false} styles={{ body: { padding: 0 } }}>
      <Box style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
        <div ref={setContainerEl} style={{ position: "absolute", inset: 0 }} />

        {/* Top bar: title plus Cancel/Save, overlaid on the map with a
            translucent backdrop -- same technique StoryView.tsx's
            fullScreen Modal already uses for the same reason (Mantine's
            own sticky Modal header doesn't compose with a map that needs
            to fill the rest of the viewport; see that component's doc
            comment). */}
        <Group
          justify="space-between"
          wrap="nowrap"
          px="md"
          style={{
            position: "absolute", top: 0, left: 0, right: 0, height: 56, zIndex: 3,
            background: dark ? "rgba(20,20,20,0.75)" : "rgba(255,255,255,0.85)",
          }}
        >
          <Text fw={600}>{title}</Text>
          <Group gap="xs">
            <Button variant="default" size="sm" onClick={onClose} disabled={saving}>
              {t("Cancel")}
            </Button>
            <Button size="sm" onClick={handleSave} loading={saving} disabled={tooComplex || !hasFeatures}>
              {t("Save")}
            </Button>
          </Group>
        </Group>

        {/* Second bar: the two fields that don't fit a bare KML file --
            desc (there's no "filename" for a hand-drawn shape to default it
            from, unlike uploadMediaFile's own uploads) and which place this
            item belongs to (nothing shows this item anywhere else --
            MediaMapButton's "Map" link, the map/story KML overlay -- until
            it's attached to one; see MediaMapButton.tsx's own doc comment).
            Not gated on `ready`: both are plain metadata edits, independent
            of whether the map/canvas has finished loading. */}
        <Group
          wrap="nowrap"
          px="md"
          gap="sm"
          style={{
            position: "absolute", top: 56, left: 0, right: 0, height: 48, zIndex: 3,
            background: dark ? "rgba(20,20,20,0.75)" : "rgba(255,255,255,0.85)",
          }}
        >
          <TextInput
            size="xs"
            style={{ flex: 1, maxWidth: 360 }}
            placeholder={t("Description (optional)")}
            value={desc}
            onChange={(e) => setDesc(e.currentTarget.value)}
          />
          {place ? (
            <Group gap={6} wrap="nowrap">
              <Text size="xs" c="dimmed">{t("Place:")}</Text>
              <Text size="xs" fw={500} truncate style={{ maxWidth: 200 }}>{place.title}</Text>
              <CircleGlyphButton glyph="−" label={t("Detach this place")} size={18} onClick={() => setPlace(null)} />
            </Group>
          ) : (
            <CircleGlyphButton
              glyph="+"
              label={t("Attach to a place")}
              textLabel={t("Attach to place")}
              onClick={() => setPlacePickerOpen(true)}
            />
          )}
        </Group>

        {/* Left toolbar: which terra-draw mode is active. Plain labeled
            buttons rather than new icon assets -- this codebase's existing
            convention for one-off controls (see EditButton.tsx's own doc
            comment on why it uses a text glyph instead). */}
        {!tooComplex && (
          <Stack
            gap={4}
            p={6}
            style={{
              position: "absolute", top: 116, left: 12, zIndex: 3, borderRadius: 8,
              background: dark ? "rgba(20,20,20,0.75)" : "rgba(255,255,255,0.85)",
            }}
          >
            {TOOLBAR.map((entry) => (
              <Button
                key={entry.mode}
                size="xs"
                variant={mode === entry.mode ? "filled" : "default"}
                disabled={!ready}
                onClick={() => handleModeChange(entry.mode)}
              >
                {t(entry.label)}
              </Button>
            ))}
          </Stack>
        )}

        {!ready && (
          <Group justify="center" align="center" style={{ position: "absolute", inset: 0, zIndex: 2 }}>
            <Loader size="sm" />
          </Group>
        )}

        {tooComplex && (
          <Alert
            color="yellow"
            title={t("This file's shapes are too complex to edit here")}
            style={{ position: "absolute", top: 116, left: 12, right: 12, zIndex: 3, maxWidth: 480 }}
          >
            {t("It contains a combined shape (a KML MultiGeometry) rather than a single point, line, or polygon per placemark.")}
          </Alert>
        )}

        {error && (
          <Alert
            color="red" title={t("Save failed")}
            style={{ position: "absolute", bottom: 12, left: 12, right: 12, zIndex: 3, maxWidth: 480 }}
          >
            {error}
          </Alert>
        )}
      </Box>

      {/* A separate, explicitly-higher-z-index Modal, not the outer
          fullScreen one's own content -- an ordinary nested Modal defaults
          to the *same* base z-index as its parent and renders underneath
          it (see RefPickerField.tsx's own doc comment on this exact
          Mantine footgun), which would make this unopenable in practice. */}
      <Modal
        opened={placePickerOpen}
        onClose={() => setPlacePickerOpen(false)}
        title={t("Attach to place")}
        size="sm"
        zIndex={1000}
      >
        <RecordPicker
          view={PLACE_VIEW}
          searchField="gramps_id"
          placeholder={PLACE_VIEW.simpleSearch?.placeholder ?? "Search…"}
          buildExpr={PLACE_VIEW.simpleSearch?.buildExpr}
          renderLabel={(item) => pickerResultLabel("place", item)}
          onPick={(item: QueryItem) => {
            setPlace({ handle: item.handle, title: pickerResultLabel("place", item) });
            setPlacePickerOpen(false);
          }}
          confirmWithButton
        />
      </Modal>
    </Modal>
  );
}

function extendBounds(bounds: maplibregl.LngLatBounds, geometry: Geometry): void {
  if (geometry.type === "Point") {
    bounds.extend(geometry.coordinates as [number, number]);
  } else if (geometry.type === "LineString") {
    for (const c of geometry.coordinates) bounds.extend(c as [number, number]);
  } else if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) for (const c of ring) bounds.extend(c as [number, number]);
  }
}
