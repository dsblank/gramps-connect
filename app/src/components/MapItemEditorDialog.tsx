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
import {
  Alert, Anchor, Box, Button, ColorInput, Group, Kbd, List, Loader, Modal, Stack, Text, TextInput,
  useComputedColorScheme,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { getToken } from "../auth/auth";
import { fetchAuthedBlobUrl } from "../store/authedFetch";
import { formatHash } from "../hash";
import {
  fetchAllKmlFeatures, fetchAllKmlImageOverlays, invalidateKmlFeatures, rotatedOverlayCorners, rotatePoint,
} from "../store/kmlMedia";
import { featuresToKml, type ImageOverlay } from "../store/kmlWrite";
import { uploadMedia, updateMediaFile, setMediaDesc } from "../store/jobsApi";
import { fetchObjectExtended, getBacklinks } from "../store/objectDetail";
import { attachRefListEntry, detachRefListEntry } from "../store/refListApi";
import { getViewStore } from "../store/registry";
import { KML_MIME } from "../store/visualData";
import { MEDIA_VIEW, PLACE_VIEW } from "../store/views";
import { readVisualColors } from "./visuals/cssVar";
import { seriesColor } from "./visuals/eventCategories";
import { mapStyleUrl } from "./visuals/mapStyles";
import { CircleGlyphButton } from "./CircleGlyphButton";
import { InfoButton } from "./InfoButton";
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

type DrawMode = "point" | "linestring" | "polygon" | "rectangle" | "label" | "select";

const TOOLBAR: { mode: DrawMode; label: string }[] = [
  { mode: "point", label: "Point" },
  { mode: "label", label: "Label" },
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

export type MapItemEditorTarget = { kind: "new" } | { kind: "edit"; handle: string };

/** One placed-and-sized image overlay in this dialog -- see this file's
 * own doc comment on the overlay system further down for how it's rendered
 * and manipulated. `id` is a local key only (React list key + maplibre
 * source/layer id prefix), not persisted -- kmlWrite.ts's ImageOverlay
 * (what actually gets saved) is just the box plus the media handle. */
interface ImageOverlayDraft {
  id: string;
  handle: string;
  north: number;
  south: number;
  east: number;
  west: number;
  rotation: number;
}

/** What's tracked per mounted image overlay -- everything needed to move
 * it (imperatively, outside React) and tear it down again. `box` is the
 * live, authoritative geometry during a drag; `overlays` state (committed
 * on drag end) only needs to be right at Save time and on remount.
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
  box: { north: number; south: number; east: number; west: number; rotation: number };
  deleteMarker: maplibregl.Marker;
  resizeMarker: maplibregl.Marker;
  rotateMarker: maplibregl.Marker;
  startMove: (e: maplibregl.MapMouseEvent) => void;
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

/** The rotate handle's own position, unrotated -- above the box's north
 * edge, offset further out by a fraction of the box's own height so it
 * doesn't crowd the top-edge midpoint. Rotating this same point (like
 * every corner) about the box's center is what makes it orbit the shape
 * as `box.rotation` changes, the standard "stalk above a selected object"
 * rotate-handle convention. */
function rotateHandleAnchor(box: { north: number; south: number; east: number; west: number }): [number, number] {
  return [(box.west + box.east) / 2, box.north + (box.north - box.south) * 0.25];
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
  // Image overlays live outside terra-draw entirely (see ImageOverlayDraft's
  // own doc comment) -- this is their bookkeeping, keyed by
  // ImageOverlayDraft.id, imperative like drawRef itself.
  const overlayMountsRef = useRef<Map<string, OverlayMount>>(new Map());
  const dark = useComputedColorScheme("light") === "dark";
  const [mode, setMode] = useState<DrawMode>("select");
  // Mirrors `mode` state for the finish listener set up once below (same
  // reasoning as colorRef just under this) -- "label" isn't a real
  // terra-draw mode (it draws via the "point" mode, see handleModeChange),
  // so this is how that listener tells a just-placed label apart from an
  // ordinary point.
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
  // The selected point's label text, mirroring `color`'s own pattern --
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
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  // Which overlay's move/resize/delete handles are currently showing --
  // set on mousedown over that overlay's image (see mountOverlay), cleared
  // by clicking anywhere else on the map (see the map-setup effect's own
  // mousedown handler) or by deleting the selected overlay itself.
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
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
  const [infoOpen, setInfoOpen] = useState(false);

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

    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [
        new TerraDrawPointMode({ styles: { pointColor: readColor } }),
        new TerraDrawLineStringMode({ styles: { lineStringColor: readColor } }),
        new TerraDrawPolygonMode({ styles: { fillColor: readColor, outlineColor: readColor } }),
        new TerraDrawRectangleMode({ styles: { fillColor: readColor, outlineColor: readColor } }),
        // Dragging (both a whole feature and its individual vertices) and
        // deletion (terra-draw's own default keybinding, Delete/Backspace
        // on the current selection) are what this editor needs from
        // Select for every mode; `rotateable` additionally turns on
        // terra-draw's own built-in rotate gesture (hold R while dragging
        // a selected shape's vertex) for anything 2D enough for "rotate"
        // to mean something -- not `point`, a single vertex has nothing to
        // rotate around.
        new TerraDrawSelectMode({
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
    // A shape takes the toolbar's current color the moment it's finished
    // drawing -- colorRef (not `color` state) since this listener, like
    // the mode instances above, is registered once per map.
    draw.on("finish", (id) => {
      draw.updateFeatureProperties(id, { color: colorRef.current });
      // A label is a plain terra-draw point (see handleModeChange) placed
      // with the express purpose of carrying text -- jump straight to
      // Select and select it so the text field below is ready to type
      // into immediately, rather than making the user switch to Select
      // and click the point they just placed.
      if (modeRef.current === "label") {
        draw.setMode("select");
        setMode("select");
        draw.selectFeature(id);
        setSelectedId(String(id));
        setLabelText("");
      }
    });
    draw.on("select", (id) => {
      setSelectedId(String(id));
      const feature = draw.getSnapshot().find((f) => f.id === id);
      setLabelText((feature?.properties?.name as string | undefined) ?? "");
    });
    draw.on("deselect", () => {
      setSelectedId(null);
      setLabelText("");
    });

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
      // Marker handles (delete/resize/rotate) are DOM elements appended
      // into maplibre's own canvas container, not the canvas itself --
      // they still receive this same "mousedown" event, so without this
      // check a click that landed on one would also match the point-in-
      // quad test below (a handle sits right at or near the box's own
      // edge) and start a move, fighting the marker's own native drag
      // (found live: dragging the resize handle just moved the image
      // instead of resizing it). Bail out entirely for a click on any
      // handle and let its own listener (Marker's built-in drag, or the
      // delete element's own click handler) run uncontested.
      const target = e.originalEvent.target;
      if (target instanceof Node) {
        for (const mount of overlayMountsRef.current.values()) {
          if (
            mount.deleteMarker.getElement().contains(target)
            || mount.resizeMarker.getElement().contains(target)
            || mount.rotateMarker.getElement().contains(target)
          ) return;
        }
      }
      const mounts = [...overlayMountsRef.current.entries()].reverse();
      for (const [id, mount] of mounts) {
        const corners = rotatedOverlayCorners(mount.box).map((c) => map.project(c));
        if (pointInQuad(e.point, corners)) {
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
    const box = {
      north: overlay.north, south: overlay.south, east: overlay.east, west: overlay.west, rotation: overlay.rotation,
    };
    const objectUrl = await fetchAuthedBlobUrl(`/api/media/${encodeURIComponent(overlay.handle)}/file`, token);
    map.addSource(sourceId, { type: "image", url: objectUrl, coordinates: rotatedOverlayCorners(box) });
    // beforeId keeps this under terra-draw's own shape layers -- see
    // OVERLAY_ANCHOR_LAYER's own doc comment.
    map.addLayer({ id: sourceId, type: "raster", source: sourceId }, OVERLAY_ANCHOR_LAYER);

    // The live geometry during a drag -- `overlays` state (below) is only
    // synced at gesture end, both for perf (no re-render per drag frame)
    // and because Save just needs it right at the end, not mid-drag.
    const setBox = (next: typeof box) => {
      Object.assign(box, next);
      (map.getSource(sourceId) as maplibregl.ImageSource | undefined)?.setCoordinates(rotatedOverlayCorners(box));
    };
    const commit = () => {
      setOverlays((prev) => prev.map((o) => (o.id === overlay.id ? { ...o, ...box } : o)));
    };

    // Not added to the map yet -- all three handles are selection-gated
    // (see the sync effect below), same as terra-draw's own vertex
    // handles only showing up once a shape is actually selected, rather
    // than cluttering every image on screen with three more controls all
    // the time.
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
    resizeEl.title = t("Drag to resize (aspect ratio kept)");
    Object.assign(resizeEl.style, OVERLAY_HANDLE_STYLE);
    const resizeMarker = new maplibregl.Marker({ element: resizeEl, anchor: "center", draggable: true });
    let aspect = 1;
    resizeMarker.on("dragstart", () => {
      // Captured fresh each gesture from the box's *current* local
      // (unrotated) shape -- true to the image's own aspect right after
      // mountOverlay first places it, and locked through every resize
      // after that, without needing a separately-stored aspect field.
      aspect = (box.east - box.west) / (box.north - box.south);
    });
    resizeMarker.on("drag", () => {
      // Resizing works entirely in the box's own *local* (unrotated)
      // lng/lat frame, matching how rotation itself is defined (plain
      // lng/lat, not Mercator-corrected -- see rotatePoint's own doc
      // comment): the handle's live *world* position is rotated back by
      // -box.rotation around the box's current center to find where that
      // corresponds to locally, then the usual anchor (local top-left,
      // which resizing never itself moves)-relative resize applies.
      const center: [number, number] = [(box.west + box.east) / 2, (box.north + box.south) / 2];
      const world = resizeMarker.getLngLat();
      const local = rotatePoint([world.lng, world.lat], center, -box.rotation);
      const w = Math.max(1e-6, local[0] - box.west);
      const h = w / aspect;
      setBox({ ...box, east: box.west + w, south: box.north - h });
      repositionHandles();
    });
    resizeMarker.on("dragend", commit);

    const rotateEl = document.createElement("div");
    rotateEl.textContent = "↻";
    rotateEl.title = t("Drag to rotate");
    Object.assign(rotateEl.style, OVERLAY_HANDLE_STYLE);
    const rotateMarker = new maplibregl.Marker({ element: rotateEl, anchor: "center", draggable: true });
    rotateMarker.on("drag", () => {
      // The handle's own *unrotated* anchor sits due north of the box's
      // center (see rotateHandleAnchor), where atan2 below would read 90°
      // -- subtracting 90 makes "handle pointing north" mean rotation 0,
      // matching rotatePoint's own convention (positive = counter-
      // clockwise), so the handle's angle directly *is* the new rotation
      // with no separate start-offset to track.
      const center: [number, number] = [(box.west + box.east) / 2, (box.north + box.south) / 2];
      const p = rotateMarker.getLngLat();
      const rotation = Math.atan2(p.lat - center[1], p.lng - center[0]) / (Math.PI / 180) - 90;
      setBox({ ...box, rotation });
      repositionHandles();
    });
    rotateMarker.on("dragend", commit);

    // Snaps all three handles back onto the box's current rotated
    // corners/anchor -- called after every geometry change (move, resize,
    // rotate) so they stay glued to the shape instead of drifting back to
    // where an unrotated box's corners would sit.
    const repositionHandles = () => {
      const [topLeft, , bottomRight] = rotatedOverlayCorners(box);
      const center: [number, number] = [(box.west + box.east) / 2, (box.north + box.south) / 2];
      deleteMarker.setLngLat(topLeft);
      resizeMarker.setLngLat(bottomRight);
      rotateMarker.setLngLat(rotatePoint(rotateHandleAnchor(box), center, box.rotation));
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
      const start = e.lngLat;
      const startBox = { ...box };
      const container = map.getContainer();
      const onMove = (moveEvent: MouseEvent) => {
        const rect = container.getBoundingClientRect();
        const lngLat = map.unproject([moveEvent.clientX - rect.left, moveEvent.clientY - rect.top]);
        const dLng = lngLat.lng - start.lng;
        const dLat = lngLat.lat - start.lat;
        setBox({
          ...box,
          north: startBox.north + dLat, south: startBox.south + dLat,
          east: startBox.east + dLng, west: startBox.west + dLng,
        });
        repositionHandles();
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        map.dragPan.enable();
        commit();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    };

    repositionHandles();
    overlayMountsRef.current.set(overlay.id, { sourceId, box, deleteMarker, resizeMarker, rotateMarker, startMove, objectUrl });
  }

  function unmountOverlay(id: string) {
    const map = mapRef.current;
    const mount = overlayMountsRef.current.get(id);
    if (!map || !mount) return;
    mount.deleteMarker.remove();
    mount.resizeMarker.remove();
    mount.rotateMarker.remove();
    if (map.getLayer(mount.sourceId)) map.removeLayer(mount.sourceId);
    if (map.getSource(mount.sourceId)) map.removeSource(mount.sourceId);
    URL.revokeObjectURL(mount.objectUrl);
    overlayMountsRef.current.delete(id);
  }

  // Shows the selected overlay's move/resize/rotate/delete handles, hides
  // every other overlay's -- mountOverlay creates all three markers
  // detached (not added to the map), so a freshly-added or freshly-loaded
  // overlay correctly starts with nothing showing until it's actually
  // clicked.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const [id, mount] of overlayMountsRef.current) {
      if (id === selectedOverlayId) {
        mount.deleteMarker.addTo(map);
        mount.resizeMarker.addTo(map);
        mount.rotateMarker.addTo(map);
      } else {
        mount.deleteMarker.remove();
        mount.resizeMarker.remove();
        mount.rotateMarker.remove();
      }
    }
  }, [selectedOverlayId]);

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
        north: topLeft.lat, west: topLeft.lng, south: bottomRight.lat, east: bottomRight.lng,
        rotation: 0,
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
    fetchAllKmlFeatures([target.handle]).then((features) => {
      if (cancelled || features.length === 0) return;
      const loadable: { type: "Feature"; geometry: Point | LineString | Polygon; properties: { mode: DrawMode; color?: string; name?: string } }[] = [];
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
        loadable.push({
          type: "Feature", geometry,
          properties: {
            mode: featureMode, color: feature.properties?.color as string | undefined,
            name: feature.properties?.name as string | undefined,
          },
        });
      }
      draw.addFeatures(loadable);
      const bounds = new maplibregl.LngLatBounds();
      for (const feature of loadable) extendBounds(bounds, feature.geometry);
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 60, maxZoom: 17, duration: 0 });
    }).catch((err: Error) => {
      if (!cancelled) setError(err.message);
    });
    fetchAllKmlImageOverlays([target.handle]).then((overlays) => {
      if (cancelled) return;
      for (const overlay of overlays) {
        const draft: ImageOverlayDraft = {
          id: crypto.randomUUID(), handle: overlay.imageHandle,
          north: overlay.north, south: overlay.south, east: overlay.east, west: overlay.west,
          rotation: overlay.rotation,
        };
        setOverlays((prev) => [...prev, draft]);
        mountOverlay(draft);
      }
    }).catch(() => {
      // Best-effort, same as the shapes fetch's own catch above wouldn't
      // block the rest of the file's shapes from loading -- one broken
      // overlay shouldn't blank out the rest of an otherwise-editable item.
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
    // "label" has no terra-draw mode of its own -- a label is just a point
    // with text (see the finish listener above and the text field below),
    // so it draws via terra-draw's own "point" mode.
    drawRef.current?.setMode(next === "label" ? "point" : next);
  }

  async function handleSave() {
    const draw = drawRef.current;
    if (!draw) return;
    // Geometry plus color only -- terra-draw's own other bookkeeping
    // properties (mode, id, ...) aren't meaningful outside the editor and
    // have no KML counterpart worth writing. color rides through as a
    // plain ExtendedData property (see kmlWrite.ts's own doc comment on
    // why that beats KML's simplestyle styling here).
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
        return {
          type: "Feature",
          geometry: f.geometry,
          properties: { color: (f.properties?.color as string | undefined) ?? color, ...(name ? { name } : {}) },
        };
      });
    if (features.length === 0 && overlays.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      const imageOverlays: ImageOverlay[] = overlays.map(({ handle, north, south, east, west, rotation }) =>
        ({ handle, north, south, east, west, rotation }));
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

  const title = target.kind === "new" ? t("Add Map Overlay") : t("Edit Map Overlay");

  // Cheap to recompute on every render (getSnapshot() is just an array
  // read) rather than mirrored into its own state -- selectedId already
  // triggers a re-render via draw.on("select"/"deselect") above, so this
  // stays in sync for free. Gated on Point geometry, not on how the point
  // was created (Point tool vs Label tool): any selected point can carry
  // text, an untouched one just renders as a plain dot (see MapCanvas.tsx).
  const selectedFeature = selectedId ? drawRef.current?.getSnapshot().find((f) => String(f.id) === selectedId) : undefined;
  const selectedIsPoint = selectedFeature?.geometry?.type === "Point";

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
            <Button size="sm" onClick={handleSave} loading={saving} disabled={tooComplex || (!hasFeatures && overlays.length === 0)}>
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
            {/* The next shape's color -- or, with a shape currently
                selected (terra-draw's Select mode), that shape's color.
                Swatches-only compact picker; ColorInput's own popover
                still opens the full picker underneath for anything else. */}
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
            {/* Only a selected point offers this -- lines/polygons have no
                well-supported KML label placement (see this feature's own
                design discussion), so a label is always its own point. */}
            {selectedIsPoint && (
              <TextInput
                size="xs"
                placeholder={t("Label text")}
                value={labelText}
                onChange={(e) => {
                  setLabelText(e.currentTarget.value);
                  const draw = drawRef.current;
                  if (draw && selectedId) draw.updateFeatureProperties(selectedId, { name: e.currentTarget.value });
                }}
                disabled={!ready}
              />
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
          buildExpr={MEDIA_VIEW.simpleSearch?.buildExpr}
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
            <List.Item>{t("Drag its ↘ handle to resize it -- its aspect ratio is always kept.")}</List.Item>
            <List.Item>{t("Drag its ↻ handle to rotate it -- handy for aligning a scanned old map.")}</List.Item>
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
