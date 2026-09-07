import { useEffect, useRef, useState } from "react";
// Namespace import: maplibre-gl v5+ has no default export -- same reason
// MapCanvas.tsx uses one.
import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import {
  TerraDraw, TerraDrawLineStringMode, TerraDrawPointMode, TerraDrawPolygonMode, TerraDrawRectangleMode,
  TerraDrawSelectMode,
} from "terra-draw";
import type { GeoJSONStoreFeatures, HexColor } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { Feature, FeatureCollection, Geometry, LineString, Point, Polygon } from "geojson";
import { formatDate, type GrampsDate } from "@gramps-connect/gramps-date";
import {
  Alert, Anchor, Box, Button, ColorInput, Divider, Group, Kbd, List, Loader, Modal, NumberInput, SegmentedControl,
  Slider, Stack, Text, TextInput, useComputedColorScheme,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { getToken } from "../auth/auth";
import { fetchAuthedBlobUrl } from "../store/authedFetch";
import { formatHash } from "../hash";
import {
  fetchAllKmlFeatures, fetchAllKmlImageOverlays, invalidateKmlFeatures, mercatorBearing, mercatorDistance, rotatePoint,
  scalePoint, type OverlayCorners,
} from "../store/kmlMedia";
import { featuresToKml, type ImageOverlay } from "../store/kmlWrite";
import { uploadMedia, updateMediaFile, setMediaDesc } from "../store/jobsApi";
import { createHandle, createObjects, fetchPlainObject } from "../store/objectsApi";
import { fetchObjectExtended, getBacklinks } from "../store/objectDetail";
import { attachRefListEntry, detachRefListEntry } from "../store/refListApi";
import { getViewStore } from "../store/registry";
import { buildSimpleSearchExpr } from "../store/simpleSearch";
import { KML_MIME } from "../store/visualData";
import { MEDIA_VIEW, PLACE_VIEW } from "../store/views";
import { readVisualColors } from "./visuals/cssVar";
import { seriesColor } from "./visuals/eventCategories";
import { mapStyleUrl } from "./visuals/mapStyles";
import { CircleGlyphButton } from "./CircleGlyphButton";
import { InfoButton } from "./InfoButton";
import { RecordPicker } from "./RecordPicker";
import { pickerResultLabel } from "./RefPickerField";
import { WikidataPlaceLookupButton } from "./WikidataPlaceLookupDialog";
import type { QueryItem } from "../store/api";
import "maplibre-gl/dist/maplibre-gl.css";
import { t } from "../i18n/i18n";

// Registered once, module-level -- the same worker file MapCanvas.tsx
// points at, and maplibregl.setWorkerUrl is idempotent (it just sets a
// static field the next Map reads), so calling it again here if MapCanvas's
// module happens not to have loaded yet in this session costs nothing.
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

type DrawMode = "point" | "linestring" | "polygon" | "rectangle" | "select";

const TOOLBAR: { mode: DrawMode; label: string }[] = [
  { mode: "point", label: "Point" },
  { mode: "linestring", label: "Line" },
  { mode: "polygon", label: "Polygon" },
  { mode: "rectangle", label: "Rectangle" },
  { mode: "select", label: "Select" },
];

// A handful of preset swatches for the color picker -- ColorInput's own
// popover still offers the full picker for anything else, this just saves
// a trip there for the common case.
const COLOR_SWATCHES = [
  "#2a78d6", "#d64545", "#3aa657", "#e0a325", "#8654c9", "#2aa7a0", "#e0678a", "#555555",
];

const EMPTY_LABEL_PREVIEW: FeatureCollection = { type: "FeatureCollection", features: [] };

export type MapItemEditorTarget =
  // A map overlay must always belong to a place (see the plan) -- `place`
  // is required here, not optional, so every caller has to already know
  // which one before opening this dialog. MapOverlaysSection.tsx (a
  // place's own detail panel) is the only caller that creates one now.
  | { kind: "new"; place: { handle: string; title: string } }
  | { kind: "edit"; handle: string };

/** One placed-and-sized image overlay in this dialog -- always 4 explicit
 * world corners, mirroring kmlMedia.ts's KmlImageOverlay (what a save
 * round-trips to). `id` is a local key only (React list key + maplibre
 * source/layer id prefix), not persisted.
 *
 * There's deliberately no separate "box" (north/south/east/west/rotation)
 * representation: move/resize/rotate/corner-drag all transform these same
 * 4 points directly (see mountOverlay) -- resize scales all 4 uniformly
 * from their shared center, rotate spins all 4 uniformly around it, a
 * corner drag moves just the one point -- so a plain rectangle is simply
 * the case where the 4 points happen to describe one, and resize/rotate
 * stay exactly as meaningful (and aspect-preserving) on an already-warped
 * quad as on a rectangle. The free-transform checkbox only ever shows or
 * hides the 4 individual corner-drag handles (see showCornerHandles further
 * down) -- it never touches `corners` itself. */
interface ImageOverlayDraft {
  id: string;
  handle: string;
  corners: OverlayCorners;
  /** Label shown in this dialog's own properties panel and (once saved)
   * the Overlays panel -- purely descriptive, mirrors kmlMedia.ts's
   * KmlImageOverlay.name. */
  name?: string;
  /** 0-1; undefined means "fully opaque", same default as an overlay saved
   * before this field existed (see kmlMedia.ts's own default). */
  opacity?: number;
  /** Stacking rank among every overlay attached to the currently-plotted
   * place(s) -- not just the ones in this file (see kmlMedia.ts's
   * KmlImageOverlay.order). Defaults to this overlay's position among the
   * others already in `overlays` state when first added/loaded. */
  order?: number;
}

/** What's tracked per mounted image overlay -- everything needed to move
 * it (imperatively, outside React) and tear it down again. `box.corners`
 * is the live, authoritative geometry during a drag; `overlays` state
 * (committed on drag end) only needs to be right at Save time and on
 * remount.
 *
 * No mousedown listener of its own -- maplibre's layer-filtered events
 * (`map.on(type, layerId, listener)`) work by hit-testing via
 * queryRenderedFeatures, which only supports vector-ish layer types
 * (circle/fill/fill-extrusion/line/symbol); a `type: "raster"` layer (what
 * an image source renders as) never matches, so a per-layer listener here
 * would simply never fire (found live: this is why clicking an image did
 * nothing at all). `startMove` is called instead by the one map-wide
 * mousedown handler in the map-setup effect, which does its own point-in-
 * box hit test against every mount's `box`. */
interface OverlayMount {
  sourceId: string;
  box: { corners: OverlayCorners };
  deleteMarker: maplibregl.Marker;
  resizeMarker: maplibregl.Marker;
  rotateMarker: maplibregl.Marker;
  /** The 4 free-transform corner handles, maplibre's own `coordinates`
   * order -- shown only while this overlay's id is in `warpHandleIds` (see
   * the selection/visibility effect below); dragging one is the only way
   * to actually turn a rectangle into a non-rectangular quad. */
  cornerMarkers: [maplibregl.Marker, maplibregl.Marker, maplibregl.Marker, maplibregl.Marker];
  startMove: (e: maplibregl.MapMouseEvent) => void;
  /** Applies a new set of corners to `box` and the live map source in one
   * step -- shared by every drag handler (move/resize/rotate/corner-drag),
   * so there's exactly one place that keeps `box` and the rendered image
   * in sync. */
  setCorners: (next: OverlayCorners) => void;
  /** Snaps every handle back onto `box`'s current corners -- called after
   * every geometry change. */
  repositionHandles: () => void;
  /** The blob: URL fetchAuthedBlobUrl() built for this overlay's `image`
   * source (discussion #4: keeps the access token out of the URL) --
   * revoked in unmountOverlay() and the map-teardown effect's own cleanup,
   * not before: maplibre's `image` source keeps reading from it for as
   * long as the layer exists. */
  objectUrl: string;
}

/** See the style.load handler's own doc comment on why every image
 * overlay's raster layer is inserted directly below this one layer,
 * rather than wherever addLayer's default "on top of everything" would
 * otherwise put it. */
const OVERLAY_ANCHOR_LAYER = "image-overlay-anchor";

/** terra-draw's own point mode has no text-label styling (see
 * refreshLabelPreview's own doc comment below), so a labeled point's text
 * is drawn by this separate, independent geojson source/layer stacked on
 * top of terra-draw's own -- purely visual, never saved from directly
 * (handleSave reads terra-draw's own snapshot, this is a mirror of it). */
const LABEL_PREVIEW_SOURCE = "label-preview";
const LABEL_PREVIEW_LAYER = "label-preview-text";

/** The average of `corners` -- a plain centroid, not an area-weighted one,
 * which is all a resize/rotate pivot or a delete-handle position needs.
 * Corner indices are tracked by identity (index 0 is always "whichever
 * point started as top-left", however far move/resize/rotate/warp has
 * since carried it), so this stays a stable, sensible center throughout. */
function overlayCenter(corners: OverlayCorners): [number, number] {
  let lng = 0, lat = 0;
  for (const [x, y] of corners) { lng += x; lat += y; }
  return [lng / 4, lat / 4];
}

/** The rotate handle's own resting position -- beyond the midpoint of the
 * corners[0]-corners[1] edge (this overlay's "top" edge, by index, however
 * it's currently oriented), extended further out from `center` so the
 * handle doesn't crowd that edge. Since this is recomputed from the
 * *current* corners every time (not from a persisted rotation angle), it
 * naturally orbits the shape as move/resize/rotate/corner-drag change it,
 * the standard "stalk above a selected object" rotate-handle convention --
 * with no separate "unrotated" reference frame needed. */
function rotateHandleAnchor(corners: OverlayCorners, center: [number, number]): [number, number] {
  const [topLeft, topRight] = corners;
  const topMid: [number, number] = [(topLeft[0] + topRight[0]) / 2, (topLeft[1] + topRight[1]) / 2];
  return [center[0] + (topMid[0] - center[0]) * 1.5, center[1] + (topMid[1] - center[1]) * 1.5];
}

/** Whether `point` (screen pixels) falls inside the convex quad described
 * by `corners` (in order around the shape) -- a plain same-side-of-every-
 * edge cross-product test, since a rotated overlay's screen footprint
 * isn't an axis-aligned rectangle a simple min/max bounds check could
 * handle anymore. */
function pointInQuad(point: { x: number; y: number }, corners: { x: number; y: number }[]): boolean {
  let sign = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (cross === 0) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

// MEDIA_VIEW's own default simpleSearch fields, with an always-on
// "images only" filter ANDed in -- only an image can be overlaid on the
// map, unlike Media's own broader picker elsewhere in the app. Since
// RecordPicker asks buildExpr even for an empty term, this filters the
// picker's default browse-all list too, not just once something's typed --
// same pattern as ComparisonsSection.tsx's own imageOnlyExpr (that one also
// excludes a self handle, which doesn't apply here -- there's no existing
// media object to exclude when picking one to newly overlay).
function imageOnlyExpr(term: string): string | null {
  const termExpr = buildSimpleSearchExpr(["gramps_id", "desc", "path"])(term);
  const fixed = 'like(mime, "image/%")';
  return termExpr ? `(${termExpr}) and ${fixed}` : fixed;
}

// How see-through a dragged overlay image gets, so whatever's underneath
// (other images, map features) is visible for positioning it precisely.
const OVERLAY_DRAG_OPACITY = 0.5;

const OVERLAY_HANDLE_STYLE = {
  width: "20px", height: "20px", borderRadius: "50%", background: "white",
  border: "2px solid #333", display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: "12px", fontWeight: "700", color: "#333", cursor: "pointer",
  boxShadow: "0 1px 3px rgba(0,0,0,0.4)", userSelect: "none",
} as const;

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The image failed to load."));
    img.src = src;
  });
}

interface MapItemEditorDialogProps {
  target: MapItemEditorTarget;
  onClose: () => void;
  /** Fired after a successful edit-save (not a new one, which has nowhere
   * existing to refresh) -- lets RelatedPanel re-fetch the media object's
   * own detail, the same refresh MessageButton's onAttached already
   * triggers after attaching something to it. */
  onSaved?: () => void;
}

/** MapOverlaysSection.tsx's own "+ Add overlay" (a place's detail panel) and
 * "Edit", and a KML media object's own "Edit" (MediaKmlEditButton.tsx),
 * both open this -- a full-screen map with a terra-draw toolbar for
 * drawing/editing Point/LineString/Polygon shapes, saved as a KML media
 * object's file. A map overlay always belongs to a place (see
 * MapItemEditorTarget) -- there used to also be a place-less "Add Map
 * Overlay…" entry in MenuBar's Add menu, removed once every overlay was
 * required to start from a specific place's own panel instead. Not a reuse
 * of MapCanvas.tsx: that component's source/layers are built around place
 * clustering, which has nothing to do with a blank drawing canvas -- this
 * builds its own small maplibre map instead, reusing only mapStyles.ts's
 * basemap URL (Standard only; no OHM historical mode here) and MapCanvas's
 * worker-registration pattern.
 *
 * No `opened` prop, unlike this app's other dialogs: maplibre-gl and
 * terra-draw are the heaviest thing this app can pull in (see MapView.tsx's
 * own doc comment on maplibre-gl's ~900KB), so this component is only ever
 * present in the tree at all behind a `lazy()`/`Suspense` boundary each
 * caller owns (MapOverlaysSection.tsx, MediaKmlEditButton.tsx) -- mounting
 * it *is* opening it, and the caller unmounts it (dropping this state
 * entirely, fresh next time) via `onClose` instead of toggling a boolean
 * prop on an always-mounted instance. */
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
  // Image overlays live outside terra-draw entirely (see ImageOverlayDraft's
  // own doc comment) -- this is their bookkeeping, keyed by
  // ImageOverlayDraft.id, imperative like drawRef itself.
  const overlayMountsRef = useRef<Map<string, OverlayMount>>(new Map());
  const dark = useComputedColorScheme("light") === "dark";
  const [mode, setMode] = useState<DrawMode>("select");
  // Mirrors `mode` state for the finish listener set up once below (same
  // reasoning as colorRef just under this) -- lets it tell a just-finished
  // region (polygon/rectangle) apart from a point/line, since it's
  // registered once per map rather than fresh on every `mode` change.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The color a newly-finished shape takes (draw.on("finish") below), and
  // -- when a shape is currently selected -- what changing this recolors
  // in place. Seeded from the fixed color every shape used before per-
  // feature color existed, so an untouched session still matches it.
  const [color, setColor] = useState(() => seriesColor(dark));
  // Mirrors `color` state for the terra-draw styling functions/listeners
  // set up once (keyed on `containerEl`, see that effect) below -- they
  // close over this ref instead of `color` itself so a later color change
  // doesn't need the whole map/draw instance rebuilt to see it.
  const colorRef = useRef(color);
  colorRef.current = color;
  // A region's (polygon/rectangle) fill opacity, same pattern as `color`:
  // both a newly-finished region's own opacity and, while one is selected,
  // what changing this edits in place. 0.25 matches MapCanvas.tsx's own
  // KML_FILL_LAYER default, so an untouched region still renders exactly as
  // it did before this property existed.
  const [opacity, setOpacity] = useState(0.25);
  const opacityRef = useRef(opacity);
  opacityRef.current = opacity;
  // The selected point/region's own `name` (a point's label text, or a
  // region's purely-descriptive name), mirroring `color`'s own pattern --
  // NOT derived from getSnapshot() on every render, since
  // updateFeatureProperties (called on every keystroke below) doesn't
  // itself trigger a re-render, which would leave a derived value stuck
  // showing whatever it read on the last unrelated render. Seeded/cleared
  // by the select/deselect listeners below instead.
  const [labelText, setLabelText] = useState("");
  // Populated fresh every render by the effect below -- lets the map-setup
  // effect's own terra-draw listeners (registered once, see colorRef's own
  // doc comment on this pattern) call the latest refreshLabelPreview
  // without closing over a stale `labelText`.
  const refreshLabelPreviewRef = useRef<(() => void) | null>(null);
  // terra-draw's own select mode only ever has zero or one feature
  // selected at a time (see TOOLBAR's "select" mode) -- this mirrors that
  // via draw.on("select"/"deselect") so the color picker knows whether a
  // change should recolor something instead of just setting the next
  // shape's color.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Mirrors `selectedId` for the canvas keydown listener set up once
  // below (Backspace-deletes-the-selection), same reasoning as colorRef.
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  // Keeps LABEL_PREVIEW_SOURCE (the editor's own text-rendering layer,
  // added in the style.load handler below since terra-draw's point mode
  // can't render text itself) in sync with every named point -- including,
  // for the currently selected feature only, `labelText` itself rather
  // than its last-saved `name` property, so a keystroke shows up
  // immediately instead of only once the point is deselected (terra-draw's
  // updateFeatureProperties, called on every keystroke by the text field
  // below, doesn't reliably fire draw's own "change" event).
  useEffect(() => {
    const draw = drawRef.current;
    const map = mapRef.current;
    const source = map?.getSource(LABEL_PREVIEW_SOURCE) as maplibregl.GeoJSONSource | undefined;
    const refresh = () => {
      const currentDraw = drawRef.current;
      const currentSource = mapRef.current?.getSource(LABEL_PREVIEW_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (!currentDraw || !currentSource) return;
      const features: Feature[] = [];
      for (const f of currentDraw.getSnapshot()) {
        if (f.geometry?.type !== "Point") continue;
        const isSelected = String(f.id) === selectedId;
        const name = (isSelected ? labelText : (f.properties?.name as string | undefined))?.trim();
        if (!name) continue;
        features.push({
          type: "Feature", geometry: f.geometry,
          properties: { name, color: f.properties?.color as string | undefined },
        });
      }
      currentSource.setData({ type: "FeatureCollection", features });
    };
    refreshLabelPreviewRef.current = refresh;
    if (draw && source) refresh();
  }, [labelText, selectedId]);
  // Every placed image overlay (KML GroundOverlay) -- a wholly separate
  // system from terra-draw (which has no image geometry type), see the
  // block of effects/handlers below this component's map-setup effect.
  const [overlays, setOverlays] = useState<ImageOverlayDraft[]>([]);
  // Mirrors `overlays` for startMove's onUp (below), set up once per mount
  // and so unable to see a later opacity edit via closure alone -- same
  // colorRef/selectedIdRef pattern as elsewhere in this file.
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  // Which overlay's move/resize/delete handles are currently showing --
  // set on mousedown over that overlay's image (see mountOverlay), cleared
  // by clicking anywhere else on the map (see the map-setup effect's own
  // mousedown handler) or by deleting the selected overlay itself.
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  // Which overlays currently show their 4 free-transform corner handles
  // (in addition to the always-available delete/resize/rotate) -- purely a
  // display preference, never touched by geometry (see
  // toggleCornerHandles's own doc comment), so it lives here rather than on
  // ImageOverlayDraft/`overlays` state.
  const [warpHandleIds, setWarpHandleIds] = useState<Set<string>>(new Set());
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
  // The one place this item is attached to -- required (see
  // MapItemEditorTarget's own doc comment): a map overlay's date visibility
  // is entirely the attached place's own doing, so an overlay with no place
  // at all would have no way to ever be date-gated, and no home for
  // MediaMapButton's "Map" link either. A single slot, not a list: this
  // editor treats "which place is this item's" as one choice, matching how
  // a map item is actually used even though gramps-web-api's media_list
  // would technically allow attaching it to several. Seeded from
  // `target.place` for a new item (always present); null only ever appears
  // in edit mode, for an overlay saved before a place was required (see the
  // no-place branch in the render below) -- otherwise the same as
  // `originalPlace` until changed via the picker. `original` is what it was
  // (edit mode only, from backlinks) when this dialog opened, so handleSave
  // can diff against it -- attach/detach are both deferred to save time
  // rather than firing immediately on pick, same reasoning as every other
  // field here (and a *new* item has no handle yet to attach to before that
  // point regardless).
  const [place, setPlace] = useState<{ handle: string; title: string } | null>(
    target.kind === "new" ? target.place : null
  );
  const [originalPlace, setOriginalPlace] = useState<{ handle: string; title: string } | null>(null);
  const [placePickerOpen, setPlacePickerOpen] = useState(false);
  // Read-only: an overlay's date visibility comes from the attached
  // Place's own name.date (see the plan) rather than a field on the
  // overlay itself, so this is fetched purely to show the user where that
  // date actually lives -- editing it happens via the ordinary Place
  // editor (Places view / RelatedPanel), not here.
  const [placeDate, setPlaceDate] = useState<GrampsDate | null>(null);
  useEffect(() => {
    if (!place) {
      setPlaceDate(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const token = await getToken();
      const obj = await fetchPlainObject(token, PLACE_VIEW, place.handle).catch(() => null);
      if (cancelled) return;
      const name = (obj?.name ?? {}) as Record<string, unknown>;
      setPlaceDate((name.date as GrampsDate | undefined) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [place]);
  const [infoOpen, setInfoOpen] = useState(false);
  // "Create a place from this shape" -- see handleCreatePlace's own doc
  // comment. A separate small modal rather than routing through
  // RefPickerField's own onOpenNew/PlaceEditDialog stack: this one specific
  // field (lat/long) needs to come from the shape just drawn, which that
  // generic flow has no way to feed in, and everything else a brand-new
  // place needs beyond a title is exactly what gramps-web-api's own
  // complete_gramps_object_dict already fills in for a create with just
  // `{_class: "Place", handle}` (see draftStack.ts's own CLASS_NAME default).
  const [createPlaceOpen, setCreatePlaceOpen] = useState(false);
  const [newPlaceTitle, setNewPlaceTitle] = useState("");
  const [creatingPlace, setCreatingPlace] = useState(false);
  const [createPlaceError, setCreatePlaceError] = useState<string | null>(null);
  // Everything WikidataPlaceLookupButton's onChange wrote for this
  // in-progress place -- place_type/urls/placeref_list, and (only when
  // newPlaceTitle was still blank) title/name, immediately mirrored into
  // newPlaceTitle itself below rather than kept here (see that onChange).
  // Deliberately excludes lat/long: this dialog's whole point is that the
  // shape just drawn *is* the place, so its own bounds-derived center
  // (handleCreatePlace's `center`) always wins over whatever coordinates
  // Wikidata reported for the general area.
  const [wikidataExtra, setWikidataExtra] = useState<Record<string, unknown>>({});

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
    // maplibre's own default: holding Ctrl and dragging (or a two-finger
    // touch twist) rotates/pitches the *camera*, which collides directly
    // with terra-draw's own Ctrl+R-drag gesture for rotating a *selected
    // shape* (see the select mode's `rotateable` flag below) -- found
    // live, holding Ctrl+R and dragging a vertex was spinning the whole
    // map instead of the shape. This editor has no use for a tilted/
    // rotated basemap anyway (a flat KML file doesn't have a "camera
    // bearing"), so the camera's own rotate/pitch is disabled outright
    // rather than trying to make the two coexist.
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();

    // Every drawing mode's color comes from the feature's own `color`
    // property, not a fixed style -- colorRef (below) is what the styling
    // functions actually read, kept live via a ref rather than closing
    // over `color` state directly, since these mode instances are built
    // once per map (this effect is keyed on `containerEl`, not `color`)
    // and terra-draw calls a styling function fresh on every render, not
    // just at construction time.
    const readColor = (feature: GeoJSONStoreFeatures): HexColor =>
      (feature.properties.color as HexColor | undefined) ?? (colorRef.current as HexColor);
    // Same pattern as readColor, for a region's own `opacity` property --
    // only polygon/rectangle modes take a `fillOpacity` style at all (point/
    // line have nothing to fill).
    const readOpacity = (feature: GeoJSONStoreFeatures): number =>
      (feature.properties.opacity as number | undefined) ?? opacityRef.current;

    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [
        new TerraDrawPointMode({ styles: { pointColor: readColor } }),
        new TerraDrawLineStringMode({ styles: { lineStringColor: readColor } }),
        new TerraDrawPolygonMode({ styles: { fillColor: readColor, fillOpacity: readOpacity, outlineColor: readColor } }),
        new TerraDrawRectangleMode({ styles: { fillColor: readColor, fillOpacity: readOpacity, outlineColor: readColor } }),
        // Dragging (both a whole feature and its individual vertices) and
        // deletion (terra-draw's own default keybinding, Delete/Backspace
        // on the current selection) are what this editor needs from
        // Select for every mode; `rotateable` additionally turns on
        // terra-draw's own built-in rotate gesture (hold R while dragging
        // a selected shape's vertex) for anything 2D enough for "rotate"
        // to mean something -- not `point`, a single vertex has nothing to
        // rotate around.
        new TerraDrawSelectMode({
          // While a feature is selected, terra-draw renders it through
          // *this* mode's own styling, not the drawing mode that created it
          // (see TerraDraw's own per-feature style dispatch: only the
          // selected feature goes through TerraDrawSelectMode.styleFeature;
          // every other feature keeps using its own mode's, which is why an
          // unselected shape's color/opacity already reflects its own
          // properties fine). Without these, the selected-state styling
          // falls back to terra-draw's fixed defaults regardless of
          // `feature.properties` -- so dragging the opacity slider (or
          // recoloring) while a shape is actively selected had no visible
          // effect until it was deselected. Found live.
          styles: {
            selectedPointColor: readColor,
            selectedLineStringColor: readColor,
            selectedPolygonColor: readColor,
            selectedPolygonOutlineColor: readColor,
            selectedPolygonFillOpacity: readOpacity,
          },
          // Half terra-draw's own default (40px) -- with labels sitting
          // right next to their point (see LABEL_PREVIEW_LAYER's
          // text-offset above) and vertices sometimes placed close
          // together, the default hit-test radius made clicking one point
          // too likely to grab a neighboring one instead. Found live.
          pointerDistance: 20,
          // Every field restated (terra-draw's own type doesn't allow a
          // partial override), only `rotate` actually changed from its
          // default -- plain "r" instead of the default Ctrl+R, an
          // awkward two-handed chord to hold through an entire drag. Bare
          // "r" is safe here the same way Backspace-delete is (see the
          // canvas keydown listener above): terra-draw's own keydown
          // listener is bound to the map canvas specifically, so it never
          // fires while typing "r" into the Description field.
          keyEvents: { deselect: "Escape", delete: "Delete", rotate: ["r"], scale: ["Control", "s"] },
          flags: {
            point: { feature: { draggable: true } },
            linestring: {
              feature: {
                draggable: true, rotateable: true,
                coordinates: { draggable: true, deletable: true, midpoints: true },
              },
            },
            polygon: {
              feature: {
                draggable: true, rotateable: true,
                coordinates: { draggable: true, deletable: true, midpoints: true },
              },
            },
            rectangle: {
              feature: {
                draggable: true, rotateable: true,
                coordinates: { draggable: true, deletable: true, midpoints: true },
              },
            },
          },
        }),
      ],
    });
    drawRef.current = draw;
    draw.on("change", () => {
      // Same guidance-point exclusion as handleSave's own filter below --
      // otherwise a shape's selection handles alone (nothing actually
      // drawn) would count as "has features".
      setHasFeatures(
        draw.getSnapshot().some((f) => f.geometry != null && !f.properties?.selectionPoint && !f.properties?.midPoint),
      );
      refreshLabelPreviewRef.current?.();
    });
    // A shape takes the toolbar's current color (and, for a region, opacity)
    // the moment it's finished drawing -- colorRef/opacityRef (not `color`/
    // `opacity` state) since this listener, like the mode instances above,
    // is registered once per map. Opacity only for polygon/rectangle (both
    // land here as "polygon"/"rectangle" -- see modeRef): a point or line
    // has no fill for it to mean anything on.
    //
    // Shared by the "select" listener below and the finish handler just
    // under it: selecting an existing feature and just having finished
    // drawing a new one both need the color/opacity/label widgets to catch
    // up to *that* feature's own properties, not whatever the toolbar was
    // last left showing. `id` null means deselected -- nothing to edit, so
    // the widgets themselves go away entirely (see selectedFeature/
    // selectedIsRegion in the render body below).
    function syncSelection(id: string | null) {
      setSelectedId(id);
      const feature = id ? draw.getSnapshot().find((f) => String(f.id) === id) : undefined;
      setLabelText((feature?.properties?.name as string | undefined) ?? "");
      if (feature) {
        setColor((feature.properties?.color as string | undefined) ?? colorRef.current);
        setOpacity((feature.properties?.opacity as number | undefined) ?? 0.25);
        // Mirrors the overlay mousedown handler's own deselectFeature call
        // -- an image overlay and a drawn shape are mutually exclusive
        // selections, so a shape becoming selected clears any overlay
        // selection the same way.
        setSelectedOverlayId(null);
      }
    }
    draw.on("finish", (id) => {
      const isRegion = modeRef.current === "polygon" || modeRef.current === "rectangle";
      draw.updateFeatureProperties(
        id,
        isRegion ? { color: colorRef.current, opacity: opacityRef.current } : { color: colorRef.current },
      );
      // Every finished shape drops straight into Select mode with itself
      // selected -- lets someone place a boundary, say, and immediately
      // see/adjust its color and opacity without an extra click to the
      // Select tool and back onto the shape it just placed.
      draw.setMode("select");
      setMode("select");
      draw.selectFeature(id);
      syncSelection(String(id));
    });
    draw.on("select", (id) => syncSelection(String(id)));
    draw.on("deselect", () => syncSelection(null));

    // terra-draw's own delete keybinding only recognizes the literal
    // "Delete" key (terra-draw-maplibre-gl-adapter's default keyEvents) --
    // on a Mac laptop keyboard, the key labelled "delete" actually sends
    // "Backspace" (only Fn+Delete sends "Delete"), so without this a Mac
    // user's most natural keypress would silently do nothing. Bound to
    // the same canvas element terra-draw's own keydown listener uses
    // (getMapEventElement() in that adapter), so -- like terra-draw's own
    // handler -- this only fires while the map canvas has focus, never
    // while typing in the Description field.
    const canvas = map.getCanvas();
    const onCanvasKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Backspace" || !selectedIdRef.current) return;
      try {
        draw.removeFeatures([selectedIdRef.current]);
      } catch {
        // Selection may already be stale (e.g. removed some other way) --
        // nothing more to do.
      }
      setSelectedId(null);
    };
    canvas.addEventListener("keydown", onCanvasKeyDown);

    // Some WebKit-based environments (found live: the standalone desktop
    // build's native window, see standalone/launcher.py) never dispatch
    // PointerEvents for mouse input, even though ordinary MouseEvents work
    // fine there -- map pan/zoom and the image-overlay drag above both ride
    // on mousedown/mousemove/mouseup and both work. terra-draw's own Select
    // mode listens *exclusively* for pointerdown/pointermove/pointerup on
    // the map canvas (see TerraDrawBaseAdapter), so without a bridge,
    // selecting a shape to drag it silently does nothing on such a
    // platform while every other gesture in this editor keeps working.
    // Detected once at runtime -- a "mousedown" on the canvas not followed
    // by a real "pointerdown" within a frame means this environment isn't
    // dispatching pointer events for mouse input at all, so from then on
    // every mouse event on the canvas is re-dispatched as the equivalent
    // pointer event. terra-draw's own listeners only read
    // clientX/clientY/button/isPrimary/target, none of which require an
    // actual PointerEvent instance -- a MouseEvent with `isPrimary` patched
    // on satisfies them exactly the same.
    let sawNativePointerdown = false;
    let pointerBridgeActive = false;
    let pendingFirstMouseDown: MouseEvent | null = null;
    const onNativePointerDown = () => { sawNativePointerdown = true; };
    canvas.addEventListener("pointerdown", onNativePointerDown, { once: true });
    const dispatchAsPointerEvent = (type: string, e: MouseEvent) => {
      const synthetic = new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: e.clientX, clientY: e.clientY, button: e.button, buttons: e.buttons,
      });
      Object.defineProperty(synthetic, "isPrimary", { value: true });
      canvas.dispatchEvent(synthetic);
    };
    const onMouseDownBridge = (e: MouseEvent) => {
      if (pointerBridgeActive) { dispatchAsPointerEvent("pointerdown", e); return; }
      if (sawNativePointerdown) return;
      pendingFirstMouseDown = e;
      requestAnimationFrame(() => {
        if (sawNativePointerdown || !pendingFirstMouseDown) return;
        pointerBridgeActive = true;
        dispatchAsPointerEvent("pointerdown", pendingFirstMouseDown);
        pendingFirstMouseDown = null;
      });
    };
    const onMouseMoveBridge = (e: MouseEvent) => { if (pointerBridgeActive) dispatchAsPointerEvent("pointermove", e); };
    const onMouseUpBridge = (e: MouseEvent) => { if (pointerBridgeActive) dispatchAsPointerEvent("pointerup", e); };
    canvas.addEventListener("mousedown", onMouseDownBridge);
    canvas.addEventListener("mousemove", onMouseMoveBridge);
    canvas.addEventListener("mouseup", onMouseUpBridge);

    // Selects whichever image overlay (if any) was clicked, deselects
    // otherwise, and kicks off that overlay's move-drag -- all in one
    // map-wide handler rather than a per-overlay one, since raster/image
    // layers can't be hit-tested via maplibre's layer-filtered events (see
    // OverlayMount's own doc comment). Does its own point-in-quad check
    // (a rotated overlay's screen footprint isn't axis-aligned) against
    // every mounted overlay's live geometry, topmost (last-added) first,
    // mirroring how they're actually layered on screen.
    map.on("mousedown", (e) => {
      // Marker handles (delete/resize/rotate/corner) are DOM elements
      // appended into maplibre's own canvas container, not the canvas
      // itself -- they still receive this same "mousedown" event, so
      // without this check a click that landed on one would also match the
      // point-in-quad test below (a handle sits right at or near the box's
      // own edge) and start a move, fighting the marker's own native drag
      // (found live: dragging the resize handle just moved the image
      // instead of resizing it -- the same bug recurred for the 4 warp-
      // mode corner handles until they were added to this same check).
      // Bail out entirely for a click on any handle and let its own
      // listener (Marker's built-in drag, or the delete element's own
      // click handler) run uncontested.
      const target = e.originalEvent.target;
      if (target instanceof Node) {
        for (const mount of overlayMountsRef.current.values()) {
          if (
            mount.deleteMarker.getElement().contains(target)
            || mount.resizeMarker.getElement().contains(target)
            || mount.rotateMarker.getElement().contains(target)
            || mount.cornerMarkers.some((marker) => marker.getElement().contains(target))
          ) return;
        }
      }
      const mounts = [...overlayMountsRef.current.entries()].reverse();
      for (const [id, mount] of mounts) {
        const corners = mount.box.corners.map((c) => map.project(c));
        if (pointInQuad(e.point, corners)) {
          // An image overlay and a drawn shape are mutually exclusive
          // selections -- deselect any terra-draw feature first, or its
          // own color/name/opacity controls would keep showing alongside
          // this overlay's, none of them meaningful for the other's kind
          // of item. Found live.
          if (selectedIdRef.current) draw.deselectFeature(selectedIdRef.current);
          setSelectedOverlayId(id);
          mount.startMove(e);
          return;
        }
      }
      setSelectedOverlayId(null);
    });

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
        // A permanent, invisible layer added before draw.start() -- image
        // overlays (mountOverlay below) always insert themselves directly
        // below this anchor, so they stay under terra-draw's own shape
        // layers (added next, appended above everything as normal) no
        // matter what order shapes/images actually get added in during the
        // session: images first, geometries on top, matching how a photo
        // of an old map should sit relative to pins/routes drawn over it.
        map.addLayer({ id: OVERLAY_ANCHOR_LAYER, type: "background", paint: { "background-opacity": 0 } });
        draw.start();
        draw.setMode("select");
        // Added after draw.start() so it stacks above terra-draw's own
        // point layer -- see LABEL_PREVIEW_SOURCE's own doc comment on why
        // this mirror exists at all. refreshLabelPreviewRef is populated by
        // the effect below; called once here too, in case any features
        // were already loaded before this handler ran.
        const colors = readVisualColors();
        map.addSource(LABEL_PREVIEW_SOURCE, { type: "geojson", data: EMPTY_LABEL_PREVIEW });
        map.addLayer({
          id: LABEL_PREVIEW_LAYER,
          type: "symbol",
          source: LABEL_PREVIEW_SOURCE,
          layout: {
            "text-field": ["get", "name"],
            "text-size": 12,
            "text-font": ["Noto Sans Regular"],
            // Offset right rather than centered on the point -- centered
            // text sat directly on top of the point, making it hard to see
            // (and, in the real map views, click) the point itself.
            "text-anchor": "left",
            "text-offset": [0.6, 0],
          },
          paint: {
            "text-color": ["coalesce", ["get", "color"], colors.text],
            "text-halo-color": colors.surface,
            "text-halo-width": 1.5,
          },
        });
        refreshLabelPreviewRef.current?.();
      } catch (err: any) {
        setError(err.message ?? String(err));
      } finally {
        setReady(true);
      }
    });

    return () => {
      draw.stop();
      canvas.removeEventListener("keydown", onCanvasKeyDown);
      canvas.removeEventListener("pointerdown", onNativePointerDown);
      canvas.removeEventListener("mousedown", onMouseDownBridge);
      canvas.removeEventListener("mousemove", onMouseMoveBridge);
      canvas.removeEventListener("mouseup", onMouseUpBridge);
      // Markers aren't part of the map's own style/source tree -- map.remove()
      // below doesn't clean these up on its own.
      for (const mount of overlayMountsRef.current.values()) {
        mount.deleteMarker.remove();
        mount.resizeMarker.remove();
        mount.rotateMarker.remove();
        for (const marker of mount.cornerMarkers) marker.remove();
        URL.revokeObjectURL(mount.objectUrl);
      }
      overlayMountsRef.current.clear();
      map.remove();
      mapRef.current = null;
      drawRef.current = null;
    };
    // `dark` only matters for the very first style URL -- a scheme flip
    // while this dialog happens to be open isn't worth a style reload here
    // the way MapCanvas.tsx's own crossfade handles it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerEl]);

  // Mounts one image overlay onto the live map: a maplibre `image` source +
  // `raster` layer (created once, then moved/resized via setCoordinates
  // rather than recreated) plus two drag handles and a whole-image move
  // gesture. Called both when a new image is picked and when an existing
  // item's overlays are loaded in (the effect below). Async only for the
  // token fetch -- callers fire-and-forget this, matching this file's
  // other imperative map setup (draw.addFeatures et al).
  async function mountOverlay(overlay: ImageOverlayDraft) {
    const map = mapRef.current;
    if (!map) return;
    const token = await getToken();
    const sourceId = `img-${overlay.id}`;
    const box: { corners: OverlayCorners } = { corners: overlay.corners };
    const objectUrl = await fetchAuthedBlobUrl(`/api/media/${encodeURIComponent(overlay.handle)}/file`, token);
    map.addSource(sourceId, { type: "image", url: objectUrl, coordinates: box.corners });
    // beforeId keeps this under terra-draw's own shape layers -- see
    // OVERLAY_ANCHOR_LAYER's own doc comment.
    map.addLayer({ id: sourceId, type: "raster", source: sourceId }, OVERLAY_ANCHOR_LAYER);
    map.setPaintProperty(sourceId, "raster-opacity", overlay.opacity ?? 1);

    // The live geometry during a drag -- `overlays` state (below) is only
    // synced at gesture end, both for perf (no re-render per drag frame)
    // and because Save just needs it right at the end, not mid-drag.
    const setCorners = (next: OverlayCorners) => {
      box.corners = next;
      (map.getSource(sourceId) as maplibregl.ImageSource | undefined)?.setCoordinates(box.corners);
    };
    const commit = () => {
      setOverlays((prev) => prev.map((o) => (o.id === overlay.id ? { ...o, corners: box.corners } : o)));
    };

    // Not added to the map yet -- all handles are selection-gated (see the
    // sync effect below), same as terra-draw's own vertex handles only
    // showing up once a shape is actually selected, rather than cluttering
    // every image on screen with several more controls all the time.
    const deleteEl = document.createElement("div");
    deleteEl.textContent = "×";
    deleteEl.title = t("Remove this image");
    Object.assign(deleteEl.style, OVERLAY_HANDLE_STYLE);
    const deleteMarker = new maplibregl.Marker({ element: deleteEl, anchor: "center" });
    deleteEl.addEventListener("click", (e) => {
      e.stopPropagation();
      unmountOverlay(overlay.id);
      setOverlays((prev) => prev.filter((o) => o.id !== overlay.id));
      setSelectedOverlayId((current) => (current === overlay.id ? null : current));
    });

    const resizeEl = document.createElement("div");
    resizeEl.textContent = "↘";
    resizeEl.title = t("Drag to resize (keeps its exact shape, warped or not)");
    Object.assign(resizeEl.style, OVERLAY_HANDLE_STYLE);
    const resizeMarker = new maplibregl.Marker({ element: resizeEl, anchor: "center", draggable: true });
    // Captured at the start of each drag: the corners and the handle's own
    // distance from their shared center right then, so every subsequent
    // "drag" frame computes one clean scale factor relative to the drag's
    // own start (distance-now / distance-then) rather than compounding a
    // per-frame ratio, which would drift.
    let resizeStartCorners: OverlayCorners = box.corners;
    let resizeStartDist = 1;
    resizeMarker.on("dragstart", () => {
      resizeStartCorners = box.corners;
      const center = overlayCenter(resizeStartCorners);
      const p = resizeMarker.getLngLat();
      resizeStartDist = Math.max(1e-9, mercatorDistance(center, [p.lng, p.lat]));
    });
    resizeMarker.on("drag", () => {
      // Scales every corner's distance from their shared center by the
      // same factor (in Mercator-projected space -- see scalePoint's own
      // doc comment), so this works identically whether the current
      // corners describe a plain rectangle or an already-warped quad: the
      // exact shape is preserved either way, just bigger or smaller. No
      // separate "aspect ratio" to track at all -- a uniform scale from
      // center can't distort it.
      const center = overlayCenter(resizeStartCorners);
      const p = resizeMarker.getLngLat();
      const scale = Math.max(0.02, mercatorDistance(center, [p.lng, p.lat]) / resizeStartDist);
      setCorners(resizeStartCorners.map((c) => scalePoint(c, center, scale)) as OverlayCorners);
      repositionHandles();
    });
    resizeMarker.on("dragend", commit);

    const rotateEl = document.createElement("div");
    rotateEl.textContent = "↻";
    rotateEl.title = t("Drag to rotate");
    Object.assign(rotateEl.style, OVERLAY_HANDLE_STYLE);
    const rotateMarker = new maplibregl.Marker({ element: rotateEl, anchor: "center", draggable: true });
    // Same start-of-drag capture as resize, but for an angle instead of a
    // distance: every "drag" frame rotates the *start* corners by
    // (current handle bearing - start handle bearing), an incremental
    // delta from center rather than an absolute angle -- there's no
    // persisted "rotation" field to be absolute relative to anymore (see
    // rotateHandleAnchor's own doc comment on why that's fine).
    let rotateStartCorners: OverlayCorners = box.corners;
    let rotateStartAngle = 0;
    rotateMarker.on("dragstart", () => {
      rotateStartCorners = box.corners;
      const center = overlayCenter(rotateStartCorners);
      const p = rotateMarker.getLngLat();
      rotateStartAngle = mercatorBearing(center, [p.lng, p.lat]);
    });
    rotateMarker.on("drag", () => {
      const center = overlayCenter(rotateStartCorners);
      const p = rotateMarker.getLngLat();
      const delta = mercatorBearing(center, [p.lng, p.lat]) - rotateStartAngle;
      setCorners(rotateStartCorners.map((c) => rotatePoint(c, center, delta)) as OverlayCorners);
      repositionHandles();
    });
    rotateMarker.on("dragend", commit);

    // Free-transform's 4 independent corner handles -- one per index of
    // maplibre's own `coordinates` order (top-left, top-right,
    // bottom-right, bottom-left). Each drag writes only its own corner,
    // leaving the other 3 exactly where they were -- the actual "rubber
    // sheet" warp, as opposed to resize/rotate's whole-shape transforms.
    const cornerMarkers = [0, 1, 2, 3].map((i) => {
      const el = document.createElement("div");
      el.title = t("Drag to warp this corner");
      Object.assign(el.style, OVERLAY_HANDLE_STYLE);
      const marker = new maplibregl.Marker({ element: el, anchor: "center", draggable: true });
      marker.on("drag", () => {
        const corners = [...box.corners] as OverlayCorners;
        const p = marker.getLngLat();
        corners[i] = [p.lng, p.lat];
        setCorners(corners);
        repositionHandles();
      });
      marker.on("dragend", commit);
      return marker;
    }) as [maplibregl.Marker, maplibregl.Marker, maplibregl.Marker, maplibregl.Marker];

    // Snaps every handle back onto the box's current corners -- called
    // after every geometry change (move, resize, rotate, corner drag) so
    // they stay glued to the image instead of drifting back to a stale
    // position. Delete/resize/rotate always track the actual corners (no
    // separate "rect" representation to fall back to); the 4 corner
    // handles are additionally repositioned here too, since a resize or
    // rotate gesture moves them right along with everything else.
    const repositionHandles = () => {
      const [topLeft, topRight, bottomRight, bottomLeft] = box.corners;
      const center = overlayCenter(box.corners);
      deleteMarker.setLngLat(center);
      resizeMarker.setLngLat(bottomRight);
      rotateMarker.setLngLat(rotateHandleAnchor(box.corners, center));
      cornerMarkers[0].setLngLat(topLeft);
      cornerMarkers[1].setLngLat(topRight);
      cornerMarkers[2].setLngLat(bottomRight);
      cornerMarkers[3].setLngLat(bottomLeft);
    };

    // Move -- dragging anywhere on the image itself (not a small handle;
    // the image can be much bigger than one). Called by the map-wide
    // mousedown handler in the map-setup effect once its own point-in-box
    // test picks this overlay out (see OverlayMount's own doc comment on
    // why that test exists instead of a listener here). Tracked via plain
    // document listeners rather than map-scoped ones so a fast drag that
    // leaves the map div doesn't get stuck without a mouseup.
    const startMove = (e: maplibregl.MapMouseEvent) => {
      e.preventDefault();
      map.dragPan.disable();
      // Nearly-transparent while being dragged so whatever's underneath
      // (other images, the base map) stays visible for positioning --
      // restored to fully opaque on mouseup.
      map.setPaintProperty(sourceId, "raster-opacity", OVERLAY_DRAG_OPACITY);
      // In screen pixels, not raw lng/lat degrees -- a fixed degree offset
      // covers a different on-screen distance depending on latitude (Web
      // Mercator isn't uniformly scaled north-south), so translating this
      // way visibly grew/shrank the image as it crossed latitudes mid-drag,
      // even though its own lat/lng span never actually changed. Found
      // live. Projecting each corner once up front, shifting all of them by
      // the same pixel delta the cursor has moved, and unprojecting back
      // keeps the dragged image's on-screen size constant -- the same
      // "work in projected space, not raw degrees" fix rotatePoint/
      // scalePoint already apply to rotate/resize (see their own doc
      // comments), just via maplibre's own project/unproject here instead
      // of kmlMedia.ts's hand-rolled Mercator math, since screen pixels
      // (not zoom-independent normalized Mercator units) are exactly what a
      // mouse drag is measured in.
      const startPoint = e.point;
      const startScreenCorners = box.corners.map((corner) => map.project(corner));
      const container = map.getContainer();
      const onMove = (moveEvent: MouseEvent) => {
        const rect = container.getBoundingClientRect();
        const dx = moveEvent.clientX - rect.left - startPoint.x;
        const dy = moveEvent.clientY - rect.top - startPoint.y;
        const newCorners = startScreenCorners.map((screenCorner) => {
          const lngLat = map.unproject([screenCorner.x + dx, screenCorner.y + dy]);
          return [lngLat.lng, lngLat.lat] as [number, number];
        });
        setCorners(newCorners as OverlayCorners);
        repositionHandles();
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        map.dragPan.enable();
        // Restores this overlay's own persisted opacity (not necessarily
        // fully opaque) -- overlaysRef, not the `overlay` param captured at
        // mount time, so an opacity edit made since this overlay was
        // mounted is still honored.
        const current = overlaysRef.current.find((o) => o.id === overlay.id);
        map.setPaintProperty(sourceId, "raster-opacity", current?.opacity ?? 1);
        commit();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    };

    repositionHandles();
    overlayMountsRef.current.set(overlay.id, {
      sourceId, box, deleteMarker, resizeMarker, rotateMarker, cornerMarkers, startMove, setCorners, repositionHandles, objectUrl,
    });
  }

  function unmountOverlay(id: string) {
    const map = mapRef.current;
    const mount = overlayMountsRef.current.get(id);
    if (!map || !mount) return;
    mount.deleteMarker.remove();
    mount.resizeMarker.remove();
    mount.rotateMarker.remove();
    for (const marker of mount.cornerMarkers) marker.remove();
    if (map.getLayer(mount.sourceId)) map.removeLayer(mount.sourceId);
    if (map.getSource(mount.sourceId)) map.removeSource(mount.sourceId);
    URL.revokeObjectURL(mount.objectUrl);
    overlayMountsRef.current.delete(id);
  }

  /** Shows or hides one overlay's 4 free-transform corner handles -- the
   * "Scale" / "Transform" SegmentedControl's onChange. Purely a
   * display preference (see warpHandleIds' own doc comment): move/resize/
   * rotate/delete always work the same way regardless of this, uniformly
   * transforming whatever the current corners are (see mountOverlay), so
   * unlike an earlier version of this feature, picking either option never
   * touches geometry at all -- there's nothing here to make lossy or to
   * restore. */
  function setCornerHandlesVisible(id: string, visible: boolean) {
    setWarpHandleIds((prev) => {
      const next = new Set(prev);
      if (visible) next.add(id); else next.delete(id);
      return next;
    });
  }

  // Shows the selected overlay's delete/resize/rotate handles (always) and
  // its 4 free-transform corner handles (only while its id is in
  // warpHandleIds), hides every other overlay's -- mountOverlay creates
  // every marker detached (not added to the map), so a freshly-added or
  // freshly-loaded overlay correctly starts with nothing showing until
  // it's actually clicked.
  const showCornerHandles = selectedOverlayId !== null && warpHandleIds.has(selectedOverlayId);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const [id, mount] of overlayMountsRef.current) {
      if (id !== selectedOverlayId) {
        mount.deleteMarker.remove();
        mount.resizeMarker.remove();
        mount.rotateMarker.remove();
        for (const marker of mount.cornerMarkers) marker.remove();
        continue;
      }
      mount.deleteMarker.addTo(map);
      mount.resizeMarker.addTo(map);
      mount.rotateMarker.addTo(map);
      for (const marker of mount.cornerMarkers) (showCornerHandles ? marker.addTo(map) : marker.remove());
    }
  }, [selectedOverlayId, showCornerHandles]);

  const selectedOverlay = overlays.find((o) => o.id === selectedOverlayId) ?? null;

  /** Patches the selected overlay's name/opacity/order in `overlays` state
   * -- and, for opacity, also pushes the change straight onto the live
   * mounted layer for immediate visual feedback, the same way color
   * changes update terra-draw's own selected feature in place rather than
   * waiting for Save. No-op with nothing selected. */
  function updateSelectedOverlay(patch: Partial<Pick<ImageOverlayDraft, "name" | "opacity" | "order">>) {
    if (!selectedOverlayId) return;
    setOverlays((prev) => prev.map((o) => (o.id === selectedOverlayId ? { ...o, ...patch } : o)));
    if (patch.opacity !== undefined) {
      const mount = overlayMountsRef.current.get(selectedOverlayId);
      if (mount) mapRef.current?.setPaintProperty(mount.sourceId, "raster-opacity", patch.opacity);
    }
  }

  /** RecordPicker's onPick for the image overlay picker -- rejects
   * anything that isn't actually an image (a KML/PDF/audio media object
   * picked by mistake) rather than trying to render it, then centers a
   * new overlay in the current view at a fixed on-screen size, true to
   * the image's real aspect ratio (read from the loaded image itself,
   * not any Gramps-side metadata, which doesn't reliably carry pixel
   * dimensions). */
  async function handleAddImage(item: QueryItem) {
    setImagePickerOpen(false);
    const mime = (item.mime as string | undefined) ?? "";
    if (!mime.startsWith("image/")) {
      notifications.show({ color: "red", title: t("Not an image"), message: t("Pick a media object whose type is an image.") });
      return;
    }
    // The same image placed twice on one place has no use: date-gating an
    // overlay is a *place's* own name.date (see mapStyles.ts's own doc
    // comment on overlayDateVisible), not something an individual overlay
    // carries, so a second copy of the same image couldn't even be given a
    // different active era to justify it -- it would just be a redundant
    // duplicate always showing (or not) in lockstep with the first. Only
    // catches a duplicate already open in *this* file's own `overlays`
    // state -- the same image used in another map-overlay file also
    // attached to this place isn't checked here.
    if (overlays.some((o) => o.handle === item.handle)) {
      notifications.show({
        color: "red",
        title: t("Already added"),
        message: t("This image is already one of this file's overlays."),
      });
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    try {
      const token = await getToken();
      // Only used to measure the image's own pixel dimensions below --
      // mountOverlay() (called further down) fetches this same file again
      // for its persistent `image` source, so this one's blob URL is
      // revoked right after reading naturalWidth/naturalHeight rather than
      // kept around.
      const objectUrl = await fetchAuthedBlobUrl(`/api/media/${encodeURIComponent(item.handle)}/file`, token);
      const image = await loadImageElement(objectUrl).finally(() => URL.revokeObjectURL(objectUrl));
      const aspect = image.naturalWidth / image.naturalHeight;
      const centerScreen = map.project(map.getCenter());
      const halfWidthPx = 130;
      const halfHeightPx = halfWidthPx / aspect;
      const topLeft = map.unproject([centerScreen.x - halfWidthPx, centerScreen.y - halfHeightPx]);
      const bottomRight = map.unproject([centerScreen.x + halfWidthPx, centerScreen.y + halfHeightPx]);
      const draft: ImageOverlayDraft = {
        id: crypto.randomUUID(),
        handle: item.handle,
        corners: [
          [topLeft.lng, topLeft.lat], [bottomRight.lng, topLeft.lat],
          [bottomRight.lng, bottomRight.lat], [topLeft.lng, bottomRight.lat],
        ],
        // Same default-rank convention as kmlMedia.ts's own reader --
        // leaves room to insert between existing overlays later without
        // renumbering.
        order: overlays.length * 10,
      };
      setOverlays((prev) => [...prev, draft]);
      // Awaited (unlike the edit-mode load effect's own fire-and-forget
      // mountOverlay calls) so the overlay's mount exists before selecting
      // it -- selecting one before it's mounted would have nothing for the
      // handle-visibility effect above to find. Auto-selected so its
      // resize/move handles are immediately visible: the initial placement
      // is only ever an approximation, and needing an extra click just to
      // start adjusting it would be a needless speed bump.
      await mountOverlay(draft);
      setSelectedOverlayId(draft.id);
    } catch (err: any) {
      notifications.show({ color: "red", title: t("Could not add that image"), message: err.message ?? String(err) });
    }
  }

  // Loads an existing KML media object's shapes and image overlays in once
  // the map/draw instance is ready -- fetchAllKmlFeatures/
  // fetchAllKmlImageOverlays are the same fetch+parse+cache path
  // MapCanvas's overlay and useVisualData's position guess already share,
  // so this is free if either of those already pulled this handle in
  // during the current session.
  useEffect(() => {
    if (!ready || target.kind !== "edit") return;
    const draw = drawRef.current;
    const map = mapRef.current;
    if (!draw || !map) return;
    let cancelled = false;
    // Both fetches feed one shared `bounds` so the final fitBounds -- fired
    // once whichever finishes last resolves -- accounts for image overlays
    // too, not just vector shapes: a KML whose only geographic content is a
    // GroundOverlay (no Point/LineString/Polygon placemark) would otherwise
    // leave the map stuck at its hardcoded world-view default, since
    // fetchAllKmlFeatures strips groundoverlay placemarks out entirely.
    const bounds = new maplibregl.LngLatBounds();
    let shapesDone = false;
    let overlaysDone = false;
    function maybeFitBounds() {
      if (shapesDone && overlaysDone && !cancelled && !bounds.isEmpty()) {
        map!.fitBounds(bounds, { padding: 60, maxZoom: 17, duration: 0 });
      }
    }
    fetchAllKmlFeatures([target.handle]).then((features) => {
      if (cancelled || features.length === 0) return;
      const loadable: { type: "Feature"; geometry: Point | LineString | Polygon; properties: { mode: DrawMode; color?: string; name?: string; opacity?: number } }[] = [];
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
        // Round-tripped through tokml/togeojson as a plain string
        // ExtendedData value (same as color), so it needs the same numeric
        // coercion+range check kmlMedia.ts's own image-overlay opacity
        // parsing already does -- undefined (not just any junk value)
        // falls through to readOpacity's own opacityRef default.
        const opacityRaw = Number(feature.properties?.opacity);
        const opacity = Number.isFinite(opacityRaw) && opacityRaw >= 0 && opacityRaw <= 1 ? opacityRaw : undefined;
        loadable.push({
          type: "Feature", geometry,
          properties: {
            mode: featureMode, color: feature.properties?.color as string | undefined,
            name: feature.properties?.name as string | undefined,
            ...(geometry.type === "Polygon" ? { opacity } : {}),
          },
        });
      }
      draw.addFeatures(loadable);
      for (const feature of loadable) extendBounds(bounds, feature.geometry);
    }).catch((err: Error) => {
      if (!cancelled) setError(err.message);
    }).finally(() => {
      shapesDone = true;
      maybeFitBounds();
    });
    fetchAllKmlImageOverlays([target.handle]).then((overlays) => {
      if (cancelled) return;
      for (const overlay of overlays) {
        const draft: ImageOverlayDraft = {
          id: crypto.randomUUID(), handle: overlay.imageHandle, corners: overlay.corners,
          name: overlay.name, opacity: overlay.opacity, order: overlay.order,
        };
        setOverlays((prev) => [...prev, draft]);
        mountOverlay(draft);
        for (const corner of overlay.corners) bounds.extend(corner);
      }
    }).catch(() => {
      // Best-effort, same as the shapes fetch's own catch above wouldn't
      // block the rest of the file's shapes from loading -- one broken
      // overlay shouldn't blank out the rest of an otherwise-editable item.
    }).finally(() => {
      overlaysDone = true;
      maybeFitBounds();
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
    // Switching drawing tools while an image overlay is selected leaves it
    // selected otherwise -- the overlay mousedown handler and syncSelection
    // (map-setup effect above) only clear it from the *other* direction
    // (a shape getting selected), not a mere tool change with nothing
    // clicked yet.
    setSelectedOverlayId(null);
    drawRef.current?.setMode(next);
  }

  async function handleSave() {
    const draw = drawRef.current;
    if (!draw) return;
    // Geometry plus color (and, for a region, opacity) only -- terra-draw's
    // own other bookkeeping properties (mode, id, ...) aren't meaningful
    // outside the editor and have no KML counterpart worth writing. Both
    // ride through as plain ExtendedData properties (see kmlWrite.ts's own
    // doc comment on why that beats KML's simplestyle styling here).
    //
    // Also excluded: terra-draw's own selection-mode guidance points --
    // the small vertex/midpoint handle dots it draws on a shape's corners
    // and edges while selected. Select mode stores those as ordinary Point
    // features in the same snapshot (tagged `selectionPoint`/`midPoint`),
    // so saving mid-selection without this filter wrote them into the KML
    // as if they were real map-item points, and MapCanvas/StoryMapBackground
    // (which render every unnamed Point as a small circle) then reproduced
    // the edit-mode handle look in read-only views. Found live.
    const features: Feature[] = draw.getSnapshot()
      .filter((f) => f.geometry != null && !f.properties?.selectionPoint && !f.properties?.midPoint)
      .map((f) => {
        // Trimmed, and omitted entirely rather than written as "" -- a
        // label point placed but never typed into should round-trip as a
        // plain, nameless point (see kmlWrite.ts/MapCanvas.tsx: presence of
        // `name` is itself what marks a point as a label), not an
        // invisible label with empty text.
        const name = (f.properties?.name as string | undefined)?.trim();
        // Opacity only for a region (Polygon) -- meaningless on a point/
        // line, which have nothing to fill (see readOpacity/opacityRef).
        const regionOpacity = f.geometry.type === "Polygon"
          ? (f.properties?.opacity as number | undefined) ?? opacity
          : undefined;
        return {
          type: "Feature",
          geometry: f.geometry,
          properties: {
            color: (f.properties?.color as string | undefined) ?? color,
            ...(name ? { name } : {}),
            ...(regionOpacity !== undefined ? { opacity: regionOpacity } : {}),
          },
        };
      });
    if (features.length === 0 && overlays.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      const imageOverlays: ImageOverlay[] = overlays.map(({ handle, corners, name, opacity, order }) => ({
        handle, corners, name, opacity, order,
      }));
      const blob = new Blob([featuresToKml(features, imageOverlays)], { type: KML_MIME });
      const trimmedDesc = desc.trim();
      let handle: string;
      if (target.kind === "new") {
        handle = await uploadMedia(token, blob, KML_MIME);
        // Immediate feedback rather than waiting on historyPoll's next
        // tick (same reasoning as draftStack.ts's saveAll/useMediaDrop.ts):
        // visualData.ts's kmlMedia derivation cross-references a place's
        // media_list against the Media ViewStore's own local `mime`
        // column, so this new handle has to land there before the Map
        // view can recognize it as a KML overlay.
        getViewStore("media").requeryDebounced();
        notifications.show({
          color: "green",
          title: t("Map overlay added"),
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
        notifications.show({ color: "blue", title: t("Map overlay updated"), message: t("Its shapes have been saved.") });
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
        // Same reasoning as the media requery above -- the Place's own
        // media_refs column (what visualData.ts reads to find its kmlMedia)
        // just changed server-side and would otherwise sit stale in the
        // local cache until historyPoll's next tick.
        getViewStore("place").requeryDebounced();
      }
      onClose();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  /** Every currently-drawn shape and image overlay's own bounds, combined --
   * the same "what's on the canvas right now" bounds handleSave itself would
   * write out, computed synchronously from local state/terra-draw's own
   * snapshot rather than round-tripping through a save first. Null with
   * nothing drawn yet (mirrors Save's own disabled condition). */
  function currentDrawnBounds(): maplibregl.LngLatBounds | null {
    const bounds = new maplibregl.LngLatBounds();
    const draw = drawRef.current;
    if (draw) {
      for (const f of draw.getSnapshot()) {
        if (f.geometry == null || f.properties?.selectionPoint || f.properties?.midPoint) continue;
        extendBounds(bounds, f.geometry as Geometry);
      }
    }
    for (const overlay of overlays) for (const corner of overlay.corners) bounds.extend(corner);
    return bounds.isEmpty() ? null : bounds;
  }

  /** Creates a brand-new Place, positioned at the center of whatever's
   * currently drawn, and attaches this item to it the same way picking an
   * existing one does -- the actual media_list attach still happens in
   * handleSave (its own place-vs-originalPlace diff), this just gives that
   * diff a freshly-created handle to attach to. Answers this feature's own
   * "would I have to go create the place separately first?" friction for
   * the common case (a farm, a field, a boundary) where the shape being
   * drawn *is* the place -- see this dialog's design discussion. */
  async function handleCreatePlace() {
    const trimmedTitle = newPlaceTitle.trim();
    const bounds = currentDrawnBounds();
    if (!trimmedTitle || !bounds) return;
    setCreatingPlace(true);
    setCreatePlaceError(null);
    try {
      const token = await getToken();
      const handle = createHandle();
      const center = bounds.getCenter();
      await createObjects(token, [{
        _class: "Place",
        handle,
        // wikidataExtra first, so its own title/name/lat/long (if any --
        // WikidataPlaceLookupButton's onChange can include title/name
        // when this was still blank at Apply time) never win over the
        // authoritative values right after: newPlaceTitle already mirrors
        // whatever title Wikidata picked (that same onChange), and the
        // shape's own drawn-bounds center always wins on location, per
        // this dialog's whole reason for existing (see wikidataExtra's
        // own doc comment above).
        ...wikidataExtra,
        title: trimmedTitle,
        name: { _class: "PlaceName", value: trimmedTitle },
        lat: String(center.lat),
        long: String(center.lng),
      }]);
      getViewStore("place").requeryDebounced();
      setPlace({ handle, title: trimmedTitle });
      setCreatePlaceOpen(false);
      setNewPlaceTitle("");
      setWikidataExtra({});
    } catch (err: any) {
      setCreatePlaceError(err.message ?? String(err));
    } finally {
      setCreatingPlace(false);
    }
  }

  const title = target.kind === "new" ? t("Add Map Overlay") : t("Edit Map Overlay");

  // Cheap to recompute on every render (getSnapshot() is just an array
  // read) rather than mirrored into its own state -- selectedId already
  // triggers a re-render via draw.on("select"/"deselect") above, so this
  // stays in sync for free. Any selected point can carry text (see the
  // "Label text" field below); an untouched one just renders as a plain
  // dot (see MapCanvas.tsx).
  const selectedFeature = selectedId ? drawRef.current?.getSnapshot().find((f) => String(f.id) === selectedId) : undefined;
  const selectedIsPoint = selectedFeature?.geometry?.type === "Point";
  // Covers both polygon and rectangle tools -- a rectangle is stored as a
  // Polygon feature under the hood, same as terra-draw's own styling above.
  const selectedIsRegion = selectedFeature?.geometry?.type === "Polygon";

  function renderModeButton(entry: { mode: DrawMode; label: string }) {
    return (
      <Button
        key={entry.mode}
        size="xs"
        variant={mode === entry.mode ? "filled" : "default"}
        disabled={!ready}
        onClick={() => handleModeChange(entry.mode)}
      >
        {t(entry.label)}
      </Button>
    );
  }

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
          <Group gap={6}>
            <Text fw={600}>{title}</Text>
            <InfoButton label={t("How to use this editor")} onClick={() => setInfoOpen(true)} />
          </Group>
          <Group gap="xs">
            <Button variant="default" size="sm" onClick={onClose} disabled={saving}>
              {t("Cancel")}
            </Button>
            <Button
              size="sm" onClick={handleSave} loading={saving}
              disabled={tooComplex || (!hasFeatures && overlays.length === 0) || !place || !desc.trim()}
            >
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
            Both required (see the Save button's own disabled check above):
            an unlabeled, unattached KML file is nearly impossible to tell
            apart from another in a media list later. Not gated on `ready`:
            both are plain metadata edits, independent of whether the map/
            canvas has finished loading. */}
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
            placeholder={t("Description")}
            withAsterisk
            error={desc.trim() === ""}
            value={desc}
            onChange={(e) => setDesc(e.currentTarget.value)}
          />
          {place ? (
            <Group gap={6} wrap="nowrap">
              <Text size="xs" c="dimmed">{t("Place:")}</Text>
              <Text size="xs" fw={500} truncate style={{ maxWidth: 200 }}>{place.title}</Text>
              {/* This overlay's visible date range comes from the attached
                  Place's own name date (edited in the Place editor, not
                  here) -- shown so it's clear where to go change it. No
                  date set there means this place's overlay(s) always
                  show. */}
              <Text size="xs" c="dimmed" truncate style={{ maxWidth: 200 }}>
                {placeDate ? formatDate(placeDate) : t("(always visible -- no date on this place)")}
              </Text>
              {/* Read-only, deliberately -- a map overlay can only ever be
                  added to the place its own panel was opened from (see
                  MapOverlaysSection.tsx), and stays there; there's no picker
                  to reassign it to a different place, matching the plan. */}
            </Group>
          ) : (
            // Only reachable editing an overlay saved before a place was
            // required (or one that somehow lost its attachment) -- every
            // new overlay is created with a place already chosen (see
            // MapOverlaysSection.tsx, the only place-that-creates-one now
            // that MenuBar's old unattached "Add Map Overlay…" is gone).
            <Group gap={10} wrap="nowrap">
              <Text size="xs" c="red">{t("This overlay has no place attached -- pick one before saving.")}</Text>
              <CircleGlyphButton
                glyph="+"
                label={t("Attach to a place")}
                textLabel={t("Attach to place")}
                onClick={() => setPlacePickerOpen(true)}
              />
              {(hasFeatures || overlays.length > 0) && (
                <CircleGlyphButton
                  glyph="⊕"
                  label={t("Create a new place from this shape's location")}
                  textLabel={t("New place")}
                  onClick={() => setCreatePlaceOpen(true)}
                />
              )}
            </Group>
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
            {/* Point/Line/Polygon/Rectangle -- the terra-draw creation
                tools, TOOLBAR's own order minus its trailing "select"
                entry, which renders last below (grouped with the other
                creation tools, not the "edit what's already there" one). */}
            {TOOLBAR.filter((entry) => entry.mode !== "select").map(renderModeButton)}
            {/* Not a terra-draw mode (there's no drawing gesture for it,
                just a media picker), so it's not in TOOLBAR/DrawMode and
                never shows as "active" the way the others do -- but it
                belongs in this same list, not the metadata bar above, since
                it's one more kind of shape to add, same as Point/Line/
                Rectangle, and more than one image is supported. */}
            <Button size="xs" variant="default" disabled={!ready} onClick={() => setImagePickerOpen(true)}>
              {t("Image")}
            </Button>
            {TOOLBAR.filter((entry) => entry.mode === "select").map(renderModeButton)}

            <Divider my={2} />
            <Text size="xs" fw={600} c="dimmed">{t("Edit Options")}</Text>

            {/* Only a selected drawn shape (point/line/region) offers this
                -- hidden, not just disabled, the rest of the time (nothing
                selected, or an image overlay selected instead, which
                `selectedFeature` is never set for -- see selectedOverlayId's
                own separate selection tracking): a picker with nothing to
                recolor is more confusing left sitting there than gone.
                Swatches-only compact picker; ColorInput's own popover still
                opens the full picker underneath for anything else. */}
            {selectedFeature && (
              <ColorInput
                size="xs"
                value={color}
                onChange={(next) => {
                  setColor(next);
                  const draw = drawRef.current;
                  if (draw && selectedId) draw.updateFeatureProperties(selectedId, { color: next });
                }}
                swatches={COLOR_SWATCHES}
                disabled={!ready}
                popoverProps={{ withinPortal: true, zIndex: 1000 }}
              />
            )}
            {/* A point's `name` places a text label on the map (see
                MapCanvas.tsx's KML_LABEL_LAYER) -- lines have no well-
                supported KML label placement (see this feature's own design
                discussion), so a label is always its own point. A region's
                `name` is purely descriptive, the same as an image overlay's
                own (mirrors OverlayLayersPanel.tsx's `row.name` there);
                nothing currently renders it on the map. */}
            {(selectedIsPoint || selectedIsRegion) && (
              <TextInput
                size="xs"
                placeholder={selectedIsPoint ? t("Label text") : t("Region name (optional)")}
                value={labelText}
                onChange={(e) => {
                  setLabelText(e.currentTarget.value);
                  const draw = drawRef.current;
                  if (draw && selectedId) draw.updateFeatureProperties(selectedId, { name: e.currentTarget.value });
                }}
                disabled={!ready}
              />
            )}
            {/* Only a selected region (polygon/rectangle) offers this,
                same reasoning as the color picker above -- gone (not just
                disabled) the moment you're done drawing one and nothing's
                selected yet, rather than lingering with the previous
                shape's value showing while it edits nothing. Found live: a
                finished shape doesn't auto-select (only a just-placed Label
                point does, see draw.on("finish") above), so the tool
                staying "active" was never actually the same thing as a
                region existing to apply this to. Same live-edit pattern as
                the color picker, applied to fill opacity instead (see
                readOpacity/opacityRef). */}
            {selectedIsRegion && (
              <Stack gap={2}>
                <Text size="xs" c="dimmed">{t("Fill opacity")}</Text>
                <Slider
                  size="xs"
                  min={0.1}
                  max={1}
                  step={0.05}
                  label={(v) => `${Math.round(v * 100)}%`}
                  value={opacity}
                  onChange={(v) => {
                    setOpacity(v);
                    const draw = drawRef.current;
                    if (draw && selectedId) draw.updateFeatureProperties(selectedId, { opacity: v });
                  }}
                  disabled={!ready}
                />
              </Stack>
            )}
            {/* Only a selected image overlay offers this -- purely shows or
                hides the 4 corner-drag handles (see setCornerHandlesVisible's
                own doc comment); move/resize/rotate/delete work the same
                either way, "Scale" rather than "Rotate and scale" since
                rotate is available in both, not just this one. */}
            {selectedOverlayId && (
              <SegmentedControl
                size="xs"
                value={showCornerHandles ? "transform" : "scale"}
                onChange={(value) => setCornerHandlesVisible(selectedOverlayId, value === "transform")}
                disabled={!ready}
                data={[
                  { label: t("Scale"), value: "scale" },
                  { label: t("Transform"), value: "transform" },
                ]}
              />
            )}
            {/* Name/opacity/order -- only the selected image overlay's own
                properties (a region's own name/opacity are the two blocks
                just above, via updateFeatureProperties/terra-draw instead
                of updateSelectedOverlay -- no `order` for a region, which
                doesn't stack against anything the way overlapping images
                do). Opacity applies live (see updateSelectedOverlay); order
                is just this overlay's own rank number -- true reordering
                *among* overlays that live in different KML files/places
                happens in the Overlays panel on the map itself, which can
                see all of them at once, not just this file's. */}
            {selectedOverlay && (
              <>
                <TextInput
                  size="xs"
                  placeholder={t("Overlay name (optional)")}
                  value={selectedOverlay.name ?? ""}
                  onChange={(e) => updateSelectedOverlay({ name: e.currentTarget.value })}
                  disabled={!ready}
                />
                <Stack gap={2}>
                  <Text size="xs" c="dimmed">{t("Opacity")}</Text>
                  <Slider
                    size="xs"
                    min={0.1}
                    max={1}
                    step={0.05}
                    label={(v) => `${Math.round(v * 100)}%`}
                    value={selectedOverlay.opacity ?? 1}
                    onChange={(v) => updateSelectedOverlay({ opacity: v })}
                    disabled={!ready}
                  />
                </Stack>
                <NumberInput
                  size="xs"
                  label={t("Stacking order")}
                  hideControls={false}
                  value={selectedOverlay.order ?? 0}
                  onChange={(v) => updateSelectedOverlay({ order: Number(v) || 0 })}
                  disabled={!ready}
                />
              </>
            )}
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

      <Modal
        opened={createPlaceOpen}
        onClose={() => setCreatePlaceOpen(false)}
        title={t("Create a new place")}
        size="sm"
        zIndex={1000}
      >
        <Stack gap="sm">
          {/* zIndex above this modal's own 1000 -- this dialog lives
              outside the app's Modal.Stack (see WikidataPlaceLookupButton's
              own zIndex doc comment), so it needs a manual bump the same
              way every other nested modal in this file already gets one. */}
          <WikidataPlaceLookupButton
            stackId="map-create-place-wikidata"
            zIndex={1001}
            data={{ title: newPlaceTitle, ...wikidataExtra }}
            onChange={(patch) => {
              // lat/long dropped -- see wikidataExtra's own doc comment on
              // why this dialog never takes coordinates from Wikidata.
              const { lat: _lat, long: _long, ...rest } = patch;
              setWikidataExtra((prev) => ({ ...prev, ...rest }));
              if (typeof rest.title === "string") setNewPlaceTitle(rest.title);
            }}
          />
          <TextInput
            label={t("Place title")}
            placeholder={t("e.g. Smith family farm")}
            value={newPlaceTitle}
            onChange={(e) => setNewPlaceTitle(e.currentTarget.value)}
            data-autofocus
          />
          <Text size="xs" c="dimmed">
            {t("Its coordinates will be set to the center of what you've drawn here.")}
          </Text>
          {createPlaceError && (
            <Alert color="red" title={t("Could not create that place")}>{createPlaceError}</Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreatePlaceOpen(false)} disabled={creatingPlace}>
              {t("Cancel")}
            </Button>
            <Button onClick={handleCreatePlace} loading={creatingPlace} disabled={!newPlaceTitle.trim()}>
              {t("Create")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={imagePickerOpen}
        onClose={() => setImagePickerOpen(false)}
        title={t("Overlay an image")}
        size="sm"
        zIndex={1000}
      >
        <RecordPicker
          view={MEDIA_VIEW}
          searchField="desc"
          placeholder={MEDIA_VIEW.simpleSearch?.placeholder ?? "Search…"}
          buildExpr={imageOnlyExpr}
          renderLabel={(item) => pickerResultLabel("media", item)}
          onPick={handleAddImage}
          confirmWithButton
        />
      </Modal>

      <Modal opened={infoOpen} onClose={() => setInfoOpen(false)} title={t("How to use this editor")} size="md" zIndex={1000}>
        <Stack gap="md">
          <Text size="sm" fw={600}>{t("Drawing")}</Text>
          <List spacing={4} size="sm">
            <List.Item>{t("Point: click once to place it.")}</List.Item>
            <List.Item>
              {t("Line, Polygon: click to place each point, then click that first point's own marker again to "
                + "finish -- it's styled differently once there's enough points to close the shape. Pressing")}{" "}
              <Kbd>Enter</Kbd> {t("finishes it too;")} <Kbd>Esc</Kbd> {t("cancels it.")}
            </List.Item>
            <List.Item>{t("Rectangle: click and drag from one corner to the opposite corner.")}</List.Item>
            <List.Item>{t("Image: pick a media object to overlay -- see")} <Text span fw={600}>{t("Images")}</Text>{" "}
              {t("below.")}
            </List.Item>
          </List>
          <Text size="sm" fw={600}>{t("Editing a shape")}</Text>
          <List spacing={4} size="sm">
            <List.Item>{t("Select: click a shape to select it, then drag it or one of its handles.")}</List.Item>
            <List.Item>
              {t("Drag a vertex to move it. To add a new point on a Line, Polygon, or Rectangle, drag the small "
                + "midpoint marker between two existing vertices outward.")}
            </List.Item>
            <List.Item>
              {t("The color swatch sets the next shape's color -- or, with a shape selected, changes its color.")}
            </List.Item>
            <List.Item>
              {t("Delete a selected shape or image with")} <Kbd>Delete</Kbd> {t("or")} <Kbd>Backspace</Kbd>.
            </List.Item>
            <List.Item>
              {t("Rotate a selected Polygon, Rectangle, or Line: hold")} <Kbd>R</Kbd>{" "}
              {t("while dragging one of its handles.")}
            </List.Item>
          </List>
          <Text size="sm" fw={600}>{t("Images")}</Text>
          <List spacing={4} size="sm">
            <List.Item>{t("Drag anywhere on an image to move it.")}</List.Item>
            <List.Item>{t("Drag its ↘ handle to resize it -- grows or shrinks from its own center, "
              + "keeping its exact shape (works the same on a warped image, too).")}</List.Item>
            <List.Item>{t("Drag its ↻ handle to rotate it -- handy for aligning a scanned old map.")}</List.Item>
            <List.Item>
              {t("Switch to \"Transform\" to also show 4 corner handles you can drag independently "
                + "(rubber-sheeting) -- for a scanned map that isn't printed at a uniform scale/orientation. "
                + "Switching back to \"Scale\" just hides those 4 handles again; move/resize/rotate keep "
                + "working on the image's exact current shape either way.")}
            </List.Item>
            <List.Item>{t("Click its × handle to remove it.")}</List.Item>
          </List>
        </Stack>
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
