import { useMemo, useRef, useState, useEffect } from "react";
// Namespace import: maplibre-gl v5+ has no default export -- same reason
// MapCanvas.tsx uses one.
import * as maplibregl from "maplibre-gl";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { formatDisplayDate } from "../store/placeIndex";
import { Alert, Anchor, Box, Button, Group, Modal, Stack, Text, TextInput, useComputedColorScheme } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  MapEditor, MapEditorHelp, type MapEditorHandle, type MapEditorOverlay,
} from "@gramps-connect/story/editor";
import type { Feature } from "geojson";
import { getToken } from "../auth/auth";
import { fetchAuthedBlobUrl } from "../store/authedFetch";
import { formatHash } from "../hash";
import {
  fetchAllKmlFeatures, fetchAllKmlImageOverlays, fetchOverlaySource, invalidateKmlFeatures,
} from "../store/kmlMedia";
import { mapItemToGeoJson, type ImageOverlay } from "@gramps-connect/story/map-edit";
import { createOverlay } from "../store/mapOverlays";
import { updateMediaFile, setMediaDesc } from "../store/jobsApi";
import { createHandle, createObjects, fetchPlainObject, updateObject } from "../store/objectsApi";
import { fetchObjectExtended, getBacklinks } from "../store/objectDetail";
import { attachRefListEntry, detachRefListEntry } from "../store/refListApi";
import { getViewStore } from "../store/registry";
import { buildSimpleSearchExpr } from "../store/simpleSearch";
import { GEOJSON_MIME } from "../store/mapFileMime";
import { parseCoords } from "../store/visualData";
import { MEDIA_VIEW, PLACE_VIEW } from "../store/views";
import { readVisualColors } from "./visuals/cssVar";
import { seriesColor } from "./visuals/eventCategories";
import { CircleGlyphButton } from "./CircleGlyphButton";
import { InfoButton } from "./InfoButton";
import { RecordPicker } from "./RecordPicker";
import { pickerResultLabel } from "./RefPickerField";
import { WikidataPlaceLookupButton } from "./WikidataPlaceLookupDialog";
import type { QueryItem } from "../store/api";
import "maplibre-gl/dist/maplibre-gl.css";
import { t } from "../i18n/i18n";
import { storyWords } from "./story/storyStrings";

// Registered once, module-level -- the same worker file MapCanvas.tsx
// points at, and maplibregl.setWorkerUrl is idempotent (it just sets a
// static field the next Map reads), so calling it again here if MapCanvas's
// module happens not to have loaded yet in this session costs nothing.
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

/** A media handle's image, for the editor to show -- the same token-in-a-
 * header fetch every other media read uses (discussion #4: keeps the
 * access token out of the URL), released with URL.revokeObjectURL. */
async function resolveMediaImage(handle: string): Promise<string> {
  return fetchAuthedBlobUrl(`/api/media/${encodeURIComponent(handle)}/file`, await getToken());
}

export type MapItemEditorTarget =
  // A map overlay must always belong to a place (see the plan) -- `place`
  // is required here, not optional, so every caller has to already know
  // which one before opening this dialog. MapOverlaysSection.tsx (a
  // place's own detail panel) is the only caller that creates one now.
  // lat/long (raw Place field strings, parsed via visualData.ts's own
  // parseCoords) are optional -- a place created just to hold a new
  // overlay has none yet -- and only ever used once, to center the map
  // there on open (see initialView below) instead of leaving it
  // at this dialog's hardcoded world-view default (found live: opening
  // "+ Add overlay" on an existing, already-located place left the map
  // exactly there).
  | { kind: "new"; place: { handle: string; title: string; lat?: string; long?: string } }
  // Always a map overlay (mapOverlays.ts) -- a GeoJSON file this app
  // wrote, saved back in place.
  | { kind: "edit"; handle: string };

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

interface MapItemEditorDialogProps {
  target: MapItemEditorTarget;
  onClose: () => void;
  /** Fired after a successful edit-save (not a new one, which has nowhere
   * existing to refresh) -- lets RelatedPanel re-fetch the media object's
   * own detail, the same refresh DiscussButton's onAttached already
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
 * uses the story package's MapEditor (shared with the Story Editor) on its
 * own small maplibre map, and MapCanvas's worker-registration pattern.
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
  // The drawing itself -- map, terra-draw, image overlays and their
  // handles -- is the story package's MapEditor; this dialog loads what it
  // edits, and saves it with the description and place around it.
  const editorRef = useRef<MapEditorHandle>(null);
  const dark = useComputedColorScheme("light") === "dark";
  // In the app's language (story/storyStrings.ts).
  const strings = storyWords().mapEditor;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Anything drawn or placed yet (hasDrawn), and anything to save at all,
  // locked shapes included (hasContent) -- Save stays disabled at nothing,
  // same as every create dialog's own empty-state guard.
  const [status, setStatus] = useState({ hasDrawn: false, hasContent: false });
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  // What the editor opens with: nothing for a new item; an existing one's
  // shapes and image overlays once fetched (null until then) --
  // fetchAllKmlFeatures/fetchAllKmlImageOverlays are the same
  // fetch+parse+cache path MapCanvas's overlay and useVisualData's position
  // guess already share, so this is free if either of those already pulled
  // this handle in during the current session.
  const [initial, setInitial] = useState<{ features: Feature[]; overlays: MapEditorOverlay[] } | null>(
    target.kind === "new" ? { features: [], overlays: [] } : null,
  );
  useEffect(() => {
    if (target.kind !== "edit") return;
    let cancelled = false;
    const features = fetchAllKmlFeatures([target.handle]).catch((err: Error) => {
      if (!cancelled) setError(err.message);
      return [];
    });
    // Best-effort: one broken overlay shouldn't blank out the rest of an
    // otherwise-editable item.
    const overlays = fetchAllKmlImageOverlays([target.handle]).catch(() => []);
    Promise.all([features, overlays]).then(([loadedFeatures, loadedOverlays]) => {
      if (cancelled) return;
      setInitial({
        features: loadedFeatures,
        overlays: loadedOverlays.map((o) => ({ image: o.imageHandle, corners: o.corners, name: o.name, opacity: o.opacity, order: o.order })),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [target]);
  // A brand-new overlay's target place may already have its own
  // coordinates (the common case -- MapOverlaysSection.tsx only ever opens
  // this for a place already being viewed) -- the editor starts there,
  // instead of at its world view, so the user doesn't have to hunt for
  // where they actually are before drawing anything (found live).
  const initialView = useMemo(() => {
    if (target.kind !== "new") return undefined;
    const coords = parseCoords(target.place.lat ?? null, target.place.long ?? null);
    return coords ? { center: [coords[1], coords[0]] as [number, number], zoom: 14 } : undefined;
  }, [target]);

  // The media object's own `desc` -- blank to start for a new item, loaded
  // from the existing object for an edit (see the effect below). Optional,
  // like every other field a bare Media object starts without.
  const [desc, setDesc] = useState("");
  // This overlay's primary place -- required (see MapItemEditorTarget's own
  // doc comment): a map overlay's date visibility is entirely the attached
  // place's own doing, so an overlay with no place at all would have no way
  // to ever be date-gated, and no home for MediaMapButton's "Map" link
  // either. A single slot here, not a list -- even though a map overlay can
  // legitimately also be attached to other places (MapOverlaysSection.tsx's
  // own "+ Add map overlay" picker allows that; see its doc comment), this
  // dialog treats whichever one it's editing as the overlay's primary
  // place, the same first-backlink slot used elsewhere (e.g. the coordinate
  // backfill in handleSave loops every attached place, but MediaMapButton's
  // "Map" link and this dialog's own picker both only ever look at this
  // one). Any other places stay attached and untouched by this dialog --
  // only the primary one is surfaced/diffed here. Seeded from
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
  // request. Only the first backlink is taken as the primary place -- see
  // `place`'s own doc comment.
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

  /** RecordPicker's onPick for the image overlay picker -- rejects
   * anything that isn't actually an image (a KML/PDF/audio media object
   * picked by mistake) rather than trying to render it; the editor centers
   * it in the current view at its own aspect ratio. */
  async function handleAddImage(item: QueryItem) {
    setImagePickerOpen(false);
    const mime = (item.mime as string | undefined) ?? "";
    if (!mime.startsWith("image/")) {
      notifications.show({ color: "red", title: t("Not an image"), message: t("Pick a media object whose type is an image.") });
      return;
    }
    try {
      // The same image placed twice on one place has no use: date-gating
      // an overlay is a *place's* own name.date (see mapStyles.ts's own doc
      // comment on overlayDateVisible), not something an individual
      // overlay carries, so a second copy of the same image couldn't even
      // be given a different active era. Only catches a duplicate in
      // *this* file -- the same image used in another map-overlay file also
      // attached to this place isn't checked here.
      if (!(await editorRef.current?.addImage(item.handle))) {
        notifications.show({
          color: "red",
          title: t("Already added"),
          message: t("This image is already one of this file's overlays."),
        });
      }
    } catch (err: any) {
      notifications.show({ color: "red", title: t("Could not add that image"), message: err.message ?? String(err) });
    }
  }

  async function handleSave() {
    const editor = editorRef.current;
    if (!editor) return;
    // Shapes put back together with everything set aside when they were
    // loaded (see map-edit's assembleForSaving), and the image overlays.
    const result = editor.getResult();
    const features = result.features;
    if (features.length === 0 && result.overlays.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      const imageOverlays: ImageOverlay[] = result.overlays.map(({ image, corners, name, opacity, order }) => ({
        handle: image, corners, name, opacity, order,
      }));
      const trimmedDesc = desc.trim();
      let handle: string;
      if (target.kind === "new") {
        handle = await createOverlay(token, features, imageOverlays, trimmedDesc);
        // Immediate feedback rather than waiting on historyPoll's next
        // tick (same reasoning as draftStack.ts's saveAll/useMediaDrop.ts):
        // visualData.ts's kmlMedia derivation cross-references a place's
        // media_list against the Media ViewStore's own local `mime`
        // column, so this new handle has to land there before the Map
        // view can recognize it as a map overlay.
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
        // Re-read, not kept from the load: the file it was made from, if
        // any (map-edit's SOURCE_PROPERTY), so the link survives.
        const source = await fetchOverlaySource(handle);
        const blob = new Blob([mapItemToGeoJson(features, imageOverlays, source)], { type: GEOJSON_MIME });
        await updateMediaFile(token, handle, blob, GEOJSON_MIME);
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
      // Best-effort, same reasoning as desc/attach above: a place created
      // without ever picking a location (the common case for a brand-new
      // "just draw the boundary" place -- see handleCreatePlace) shouldn't
      // stay stranded off the map forever just because this dialog is how
      // someone happened to give it a shape. Re-fetches this overlay's own
      // backlinks rather than using just the primary `place` slot above --
      // MapOverlaysSection.tsx allows the same overlay to be attached to
      // several places (see its own doc comment), and every one of them
      // that has no coordinates of its own yet gets backfilled here, not
      // only the primary one this dialog's own picker manages.
      // Never overwrites a location someone set deliberately, on this save
      // or any later edit of the same overlay. Uses the same bounds-center-
      // of-everything-drawn as handleCreatePlace's own `center`, not an
      // area-weighted centroid.
      try {
        const bounds = editorRef.current?.drawnBounds();
        if (bounds) {
          const [west, south, east, north] = bounds;
          const center = { lat: (south + north) / 2, lng: (west + east) / 2 };
          const obj = await fetchObjectExtended(token, MEDIA_VIEW, handle);
          const attachedPlaces = (getBacklinks(obj).place ?? []) as { handle: string }[];
          const toBackfill: { handle: string; placeObj: any }[] = [];
          for (const p of attachedPlaces) {
            const placeObj = await fetchPlainObject(token, PLACE_VIEW, p.handle);
            const hasLat = typeof placeObj.lat === "string" && placeObj.lat.trim() !== "";
            const hasLong = typeof placeObj.long === "string" && placeObj.long.trim() !== "";
            if (hasLat || hasLong) continue;
            toBackfill.push({ handle: p.handle, placeObj });
          }
          if (toBackfill.length > 0) {
            // Spread multiple places sharing this overlay around its centroid
            // rather than stacking them all on one identical point: coincident
            // places sit 0px apart at every zoom, so the map's clustering can
            // never split them apart -- clicking their "N" badge just zooms in
            // and the badge vanishes into a single indistinguishable dot
            // instead of separating into individual pins.
            const MIN_SPREAD_DEGREES = 0.0005;
            const radiusLat = Math.max((north - south) * 0.15, MIN_SPREAD_DEGREES);
            const radiusLng = Math.max((east - west) * 0.15, MIN_SPREAD_DEGREES);
            for (let i = 0; i < toBackfill.length; i++) {
              const { handle: placeHandle, placeObj } = toBackfill[i];
              let lat = center.lat;
              let lng = center.lng;
              if (toBackfill.length > 1) {
                const angle = (2 * Math.PI * i) / toBackfill.length;
                lat += Math.sin(angle) * radiusLat;
                lng += Math.cos(angle) * radiusLng;
              }
              await updateObject(token, PLACE_VIEW, placeHandle, {
                ...placeObj, lat: String(lat), long: String(lng),
              });
            }
            getViewStore("place").requeryDebounced();
          }
        }
      } catch {
        // Coordinates are a nice-to-have backfill, not essential to what
        // was just saved -- same as the desc/attach failures above.
      }
      onClose();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setSaving(false);
    }
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
    const bounds = editorRef.current?.drawnBounds();
    if (!trimmedTitle || !bounds) return;
    setCreatingPlace(true);
    setCreatePlaceError(null);
    try {
      const token = await getToken();
      const handle = createHandle();
      const center = { lat: (bounds[1] + bounds[3]) / 2, lng: (bounds[0] + bounds[2]) / 2 };
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

  return (
    <Modal opened onClose={onClose} fullScreen withCloseButton={false} styles={{ body: { padding: 0 } }}>
      <Box style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
        <MapEditor
          ref={editorRef}
          initial={initial}
          initialView={initialView}
          resolveImage={resolveMediaImage}
          releaseImage={(url) => URL.revokeObjectURL(url)}
          onAddImage={() => setImagePickerOpen(true)}
          onStatus={setStatus}
          onError={setError}
          dark={dark}
          defaultColor={seriesColor(dark)}
          labelColors={readVisualColors()}
          // Below this dialog's own two bars (56 + 48) and a margin.
          toolbarTop={116}
          strings={strings}
        />

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
              disabled={!status.hasContent || !place || !desc.trim()}
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
                {placeDate ? formatDisplayDate(placeDate) : t("(always visible -- no date on this place)")}
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
              {status.hasDrawn && (
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
        <MapEditorHelp strings={strings} />
      </Modal>
    </Modal>
  );
}
