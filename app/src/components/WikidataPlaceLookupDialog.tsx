// Step 3 of WIKIDATA_PLACE_LOOKUP_PLAN.md: search Wikidata for a place,
// walk its P131 chain, and let the user confirm the whole resolved
// hierarchy (root to leaf) in one screen before anything is created --
// "one confirmation, not a per-level wizard" per the plan. Every Wikidata
// call lives in store/wikidataApi.ts; this component adds the dedup lookup
// (an existing Place already carrying a given QID, via the urls-field
// query_lang trick verified in the plan) and the actual create/patch step.
import { useEffect, useState } from "react";
import { Alert, Badge, Button, Checkbox, Group, Loader, Modal, ScrollArea, Stack, Text, TextInput } from "@mantine/core";
import { getToken } from "../auth/auth";
import { fetchPage } from "../store/api";
import { PLACE_VIEW } from "../store/views";
import { createHandle, createObjects, fetchPlainObject, updateObject } from "../store/objectsApi";
import { getViewStore } from "../store/registry";
import {
  fetchWikidataChain, fetchWikidataGeoshape, searchWikidata,
  type WikidataPlaceNode, type WikidataSearchResult,
} from "../store/wikidataApi";
import { featuresToKml } from "../store/kmlWrite";
import { setMediaDesc, uploadMedia } from "../store/jobsApi";
import { KML_MIME } from "../store/visualData";
import { t } from "../i18n/i18n";

const TYPE_HINT = "e.g. a built-in name, or your own custom label…";

// Below this length, Wikidata's search endpoint mostly returns noise --
// same reasoning as RecordPicker's own local-cache search, just applied to
// an external round trip instead of a free local query, so it's worth
// guarding here specifically.
const MIN_SEARCH_LENGTH = 2;

/** One level of the walked chain, root-first (reverse of
 * fetchWikidataChain's own leaf-first order -- see the plan's "ancestors
 * must be created top-down" requirement), plus what this dialog itself
 * worked out about it. */
interface ChainRow {
  node: WikidataPlaceNode;
  /** The place currently being edited -- always last in a root-first list.
   * Never dedup-checked or created; only ever contributes to the result
   * handed back via onApply. */
  isLeaf: boolean;
  /** Editable copy of node.placeType (or "" for an unmapped P31, i.e. a
   * free-text custom type) -- the confirmation screen's own "fix a wrong
   * guess before anything is created" escape hatch. */
  typeOverride: string;
  /** Set when an existing Place already carries this QID in its urls list
   * (see WIKIDATA_PLACE_LOOKUP_PLAN.md's verified dedup query) -- that
   * place is reused as this row's contribution to the chain instead of
   * creating a new one. Always null for the leaf (never dedup-checked). */
  existingHandle: string | null;
  existingTitle: string | null;
  /** How existingHandle was found -- "qid" is the confident case (an exact
   * QID already recorded on that Place), "name" is a same-name fallback
   * used when no place has ever been QID-tagged yet (the common case for a
   * hierarchy that predates this feature entirely -- see issue #14: every
   * ancestor read "New" even though all but one already existed, because
   * dedup only ever looked for a QID nothing had recorded yet). A "name"
   * match is a guess, not a certainty (homonymous places exist), so the
   * confirm screen surfaces it distinctly and lets the user reject it. */
  matchedBy: "qid" | "name" | null;
  /** User said a "name" match isn't actually the same place (see the
   * confirm screen's "Incorrect match, create a new one" checkbox) --
   * toggled, not destructive: existingHandle/existingTitle/matchedBy are left
   * alone so the row can go right back to "Possible match" by toggling
   * this off again, rather than the lookup having to be re-run from
   * scratch to get back to that state. Every place that reads whether
   * this row actually resolves to an existing Place should check
   * `existingHandle && !nameMatchRejected` (see effectiveHandle below),
   * never `existingHandle` alone -- this field is never set for a "qid"
   * match, which is confident enough not to offer rejecting it. */
  nameMatchRejected: boolean;
  /** User opted this level out of the hierarchy entirely (see issue #14's
   * follow-up: Wikidata's admin levels don't always match the granularity
   * a Gramps tree actually uses -- a "Government Region" the user doesn't
   * track, say). A skipped row is never created/patched and never linked
   * to as a parent; its neighbors connect directly to each other instead,
   * exactly as if this row weren't in the chain at all. Always false for
   * the leaf -- there's nothing to skip *to* past the place being edited. */
  skip: boolean;
}

/** The existing Place this row actually resolves to right now -- null once
 * a "name" match has been rejected (see ChainRow.nameMatchRejected), even
 * though existingHandle itself is left populated so rejecting can be
 * undone. Every "is this row reusing an existing place" check goes through
 * this, not existingHandle directly. */
function effectiveHandle(row: ChainRow): string | null {
  return row.nameMatchRejected ? null : row.existingHandle;
}

/** Escapes a Wikidata label for splicing into a query_lang string literal
 * (single-quoted, backslash-escaped -- see
 * gramps-object-query-language/docs/where_expr.md). Labels can contain an
 * apostrophe ("Côte d'Ivoire") that would otherwise end the literal early. */
function escapeQueryLangString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

type Phase =
  | { name: "search" }
  | { name: "resolving" }
  | { name: "confirm"; rows: ChainRow[] }
  | { name: "applying"; rows: ChainRow[] }
  | { name: "error"; message: string };

/** What a caller actually needs once "Apply" has created every new
 * ancestor: the leaf's own coordinates/type guess, its own QID (for the
 * urls-field dedup entry the caller writes), and the handle of whatever
 * now immediately encloses it (new or reused) -- null when the chain
 * turned out to have no parent at all (searching a country itself, say).
 * Deliberately not a ready-made patch: merging this into a place's
 * *existing* urls/placeref_list (rather than overwriting them) needs that
 * place's own current data, which this dialog never has -- see
 * WikidataPlaceLookupButton below, the thing that actually holds it. */
export interface WikidataLookupResult {
  qid: string;
  label: string;
  /** Every confirmed row's own label, leaf first up through the root
   * ("Indianapolis, Marion County, Indiana, United States") -- full
   * Wikidata labels, not the guessed/edited PlaceType, and not affected by
   * a row being reused vs newly created (an existing ancestor's own
   * *title* may differ, but this is about naming the place being edited,
   * not describing what got created). Used as the fallback title when the
   * place being edited doesn't already have one -- see
   * WikidataPlaceLookupButton. */
  hierarchyTitle: string;
  lat: number | null;
  long: number | null;
  placeType: string | null;
  parentHandle: string | null;
}

interface WikidataPlaceLookupDialogProps {
  opened: boolean;
  onClose: () => void;
  stackId: string;
  /** Only meaningful for a caller *outside* the app's Modal.Stack (e.g.
   * MapItemEditorDialog.tsx, which stacks its own nested modals by a
   * plain manual `zIndex` bump, not `stackId`/Modal.Stack -- confirmed
   * safe to pass both props at once: Mantine's Modal only ever reads
   * `stackId` through `useModalStackContext()`, which is `null` outside a
   * real `<Modal.Stack>`, so `stackId` here is simply ignored and this
   * `zIndex` wins). Every ObjectEditDialog.tsx/PlaceEditDialog.tsx caller
   * leaves this unset and relies on `stackId` instead, same as every
   * other Modal.Stack member in this app. */
  zIndex?: number;
  /** Pre-fills the search box with the place's own current title, if any
   * -- most lookups start from a name already typed into the place being
   * edited, not a blank search. */
  initialQuery: string;
  onApply: (result: WikidataLookupResult) => void;
}

export function WikidataPlaceLookupDialog({
  opened, onClose, stackId, zIndex, initialQuery, onApply,
}: WikidataPlaceLookupDialogProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<WikidataSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [phase, setPhase] = useState<Phase>({ name: "search" });
  // Default on (see the plan's geoshape follow-up: most people adding a
  // place from Wikidata will want its outline too) -- applies to every
  // newly-created row in the confirmed chain, not reused/"Existing" ones
  // (see handleApply).
  const [fetchOutlines, setFetchOutlines] = useState(true);

  // Every open starts fresh -- resuming mid-resolve or on an already-
  // decided confirm screen from a previous open would be confusing, and
  // nothing here is worth remembering across opens the way an edit
  // draft's own fields are (this dialog holds no persistent state of its
  // own at all; see draftStack.ts's DraftEntry for what does).
  useEffect(() => {
    if (opened) {
      setQuery(initialQuery);
      setResults([]);
      setPhase({ name: "search" });
      setFetchOutlines(true);
    }
  }, [opened, initialQuery]);

  useEffect(() => {
    if (phase.name !== "search") return;
    const term = query.trim();
    if (term.length < MIN_SEARCH_LENGTH) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setSearching(true);
    searchWikidata(term, controller.signal)
      .then((hits) => {
        if (!cancelled) setResults(hits);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [query, phase.name]);

  async function handlePick(qid: string) {
    setPhase({ name: "resolving" });
    try {
      const chain = await fetchWikidataChain(qid); // leaf-first
      const token = await getToken();
      const rows: ChainRow[] = [];
      for (let i = chain.length - 1; i >= 0; i--) {
        const node = chain[i];
        const isLeaf = i === 0;
        let existingHandle: string | null = null;
        let existingTitle: string | null = null;
        let matchedBy: "qid" | "name" | null = null;
        if (!isLeaf) {
          // Verified query (see the plan): urls isn't a registered
          // query_lang collection, so this resolves as a plain JSON-path
          // field -- like() forces a TEXT extraction regardless, and both
          // SQLite/PostgreSQL render the whole urls array as JSON text on
          // that path, so this substring-matches the QID inside it.
          const qidWhereExpr = `like(urls, '%wikidata.org/wiki/${node.qid}%')`;
          const { page } = await fetchPage(PLACE_VIEW, token, null, false, qidWhereExpr, PLACE_VIEW.orderBy, 1);
          const match = page.items[0];
          if (match) {
            existingHandle = match.handle;
            existingTitle = (match.title as string | undefined) ?? node.label;
            matchedBy = "qid";
          } else {
            // Fallback for a hierarchy that predates this feature: nothing
            // has ever been QID-tagged, so the query above always misses
            // even when the place already exists (see issue #14). name.value
            // holds just the place's own name (not the hierarchical title --
            // see PLACE_VIEW's own title/name split in views.ts), matching
            // what a Wikidata chain label looks like at every level. A guess,
            // not a certainty, so it's surfaced as "possible", not "existing".
            const nameWhereExpr = `name.value == '${escapeQueryLangString(node.label)}'`;
            const { page: namePage } = await fetchPage(PLACE_VIEW, token, null, false, nameWhereExpr, PLACE_VIEW.orderBy, 1);
            const nameMatch = namePage.items[0];
            if (nameMatch) {
              existingHandle = nameMatch.handle;
              existingTitle = (nameMatch.title as string | undefined) ?? node.label;
              matchedBy = "name";
            }
          }
        }
        rows.push({
          node, isLeaf, typeOverride: node.placeType ?? "", existingHandle, existingTitle, matchedBy,
          nameMatchRejected: false, skip: false,
        });
      }
      setPhase({ name: "confirm", rows });
    } catch (err: any) {
      setPhase({ name: "error", message: err.message ?? String(err) });
    }
  }

  function updateRow(index: number, patch: Partial<ChainRow>) {
    setPhase((prev) => {
      if (prev.name !== "confirm") return prev;
      const rows = prev.rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
      return { name: "confirm", rows };
    });
  }

  async function handleApply(rows: ChainRow[]) {
    setPhase({ name: "applying", rows });
    try {
      const token = await getToken();
      const objects: Record<string, unknown>[] = [];
      let parentHandle: string | null = null;
      let createdAny = false;
      // Every existing place actually resolved in this chain (whichever
      // rows a skip didn't remove or a rejected name match didn't disown --
      // see effectiveHandle) -- any PlaceRef among these still on a kept
      // row once the walk below is done is necessarily a stale link to a
      // level this confirmed hierarchy no longer routes through (skipped,
      // or superseded by a newly inserted level), and gets swapped for the
      // one it actually precedes now. A place's PlaceRef to something
      // *outside* this chain is left alone -- it's none of this dialog's
      // business.
      const chainHandles = new Set(
        rows.filter((r) => !r.isLeaf).map((r) => effectiveHandle(r)).filter((h): h is string => h != null)
      );
      // What each kept (non-skipped) existing row's placeref_list should
      // resolve to, recorded during the same root-first walk that decides
      // what to create -- applied in a second pass below, once every
      // newly created ancestor is guaranteed to exist server-side (a
      // patch may need to reference a handle that's still only a pending
      // entry in `objects` at the point its own row is visited).
      const reconcile: { handle: string; correctParent: string | null; addQid?: string }[] = [];
      // Root-first order (see ChainRow's own doc comment) is exactly
      // creation order: each new row's placeref_list can point at the
      // previous row's handle -- reused or just-minted -- because that
      // one is always already in `objects` (or already exists) by the
      // time this row is built. Stops before the leaf: that place already
      // exists (or is still an in-progress draft) and is never created
      // here, only patched via the result handed back below.
      for (const row of rows) {
        if (row.isLeaf) break;
        if (row.skip) continue; // excluded entirely -- see ChainRow.skip
        const reusedHandle = effectiveHandle(row);
        if (reusedHandle) {
          const entry: (typeof reconcile)[number] = { handle: reusedHandle, correctParent: parentHandle };
          if (row.matchedBy === "name") {
            // Backfill the QID onto the reused place so the *next* lookup
            // finds it via the confident "qid" match instead of falling
            // back to this same name guess again (see ChainRow.matchedBy
            // and issue #14) -- self-healing dedup, one confirmed row at a
            // time.
            entry.addQid = row.node.qid;
          }
          reconcile.push(entry);
          parentHandle = reusedHandle;
          continue;
        }
        const handle = createHandle();
        // Best-effort, v1-scoped to newly-created rows only (see the plan's
        // geoshape follow-up: retrofitting outlines onto a reused/existing
        // place is a bigger, separate decision) -- a missing P3896 claim or
        // a failed Commons fetch just means no media_list entry, same as
        // any other "contributes nothing" fallback in this dialog.
        let mediaList: Record<string, unknown>[] | undefined;
        if (fetchOutlines && row.node.geoshapeTitle) {
          const features = await fetchWikidataGeoshape(row.node.geoshapeTitle);
          if (features.length > 0) {
            // Same name as the media desc set below -- fetchAllKmlRegions
            // reads a Polygon's `properties.name` as its label (see
            // kmlMedia.ts), and Commons' geoshape data carries no name of
            // its own, so without this the outline shows up unlabeled.
            for (const feature of features) {
              feature.properties = { ...feature.properties, name: row.node.label };
            }
            const blob = new Blob([featuresToKml(features)], { type: KML_MIME });
            const mediaHandle = await uploadMedia(token, blob, KML_MIME);
            // Best-effort, same as MapItemEditorDialog.tsx's own desc set --
            // the outline itself is already saved either way, so a failed
            // desc PUT shouldn't surface as an Apply error. Named after the
            // place (not e.g. "Alabama outline"): this is what the Media
            // view's list and MediaThumbnail's hover text show, and it
            // should read the same way any other place-named attachment does.
            await setMediaDesc(token, mediaHandle, row.node.label).catch(() => {});
            mediaList = [{ _class: "MediaRef", ref: mediaHandle }];
          }
        }
        objects.push({
          _class: "Place",
          handle,
          title: row.node.label,
          name: { _class: "PlaceName", value: row.node.label },
          lat: row.node.lat != null ? String(row.node.lat) : undefined,
          long: row.node.long != null ? String(row.node.long) : undefined,
          place_type: row.typeOverride || undefined,
          urls: [{ _class: "Url", path: `https://www.wikidata.org/wiki/${row.node.qid}`, desc: "", type: "Wikidata" }],
          placeref_list: parentHandle ? [{ _class: "PlaceRef", ref: parentHandle }] : undefined,
          media_list: mediaList,
        });
        parentHandle = handle;
        createdAny = true;
      }
      if (objects.length > 0) {
        await createObjects(token, objects);
      }
      // Fetch-then-merge, not overwrite: each patched place's urls/
      // placeref_list may already hold unrelated entries.
      for (const entry of reconcile) {
        const existing = await fetchPlainObject(token, PLACE_VIEW, entry.handle);
        const update: Record<string, unknown> = { ...existing };
        let changed = false;
        if (entry.addQid) {
          const wikidataUrl = `https://www.wikidata.org/wiki/${entry.addQid}`;
          const existingUrls = (existing.urls as { path?: string }[] | undefined) ?? [];
          if (!existingUrls.some((u) => u.path === wikidataUrl)) {
            update.urls = [...existingUrls, { _class: "Url", path: wikidataUrl, desc: "", type: "Wikidata" }];
            changed = true;
          }
        }
        const refs = (existing.placeref_list as { _class?: string; ref?: string }[] | undefined) ?? [];
        const nextRefs = refs.filter((r) => r.ref === entry.correctParent || !chainHandles.has(r.ref ?? ""));
        if (entry.correctParent && !nextRefs.some((r) => r.ref === entry.correctParent)) {
          nextRefs.push({ _class: "PlaceRef", ref: entry.correctParent });
        }
        if (JSON.stringify(nextRefs) !== JSON.stringify(refs)) {
          update.placeref_list = nextRefs;
          changed = true;
        }
        if (changed) await updateObject(token, PLACE_VIEW, entry.handle, update);
      }
      if (createdAny) getViewStore("place").requeryDebounced();

      const leaf = rows.find((r) => r.isLeaf);
      if (leaf) {
        // rows is root-first (see ChainRow's doc comment); the hierarchy
        // title reads leaf-to-root, so reverse it. A skipped level isn't
        // part of the confirmed hierarchy any more than it's part of the
        // created/patched Place graph -- leave it out of the name too.
        const hierarchyTitle = [...rows]
          .reverse()
          .filter((r) => r.isLeaf || !r.skip)
          .map((r) => r.node.label)
          .join(", ");
        onApply({
          qid: leaf.node.qid,
          label: leaf.node.label,
          hierarchyTitle,
          lat: leaf.node.lat,
          long: leaf.node.long,
          placeType: leaf.typeOverride || null,
          parentHandle,
        });
      }
      onClose();
    } catch (err: any) {
      setPhase({ name: "error", message: err.message ?? String(err) });
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("Look up on Wikidata")}
      stackId={stackId}
      zIndex={zIndex}
      size="lg"
    >
      <Stack gap="md">
        {phase.name === "search" && (
          <>
            <TextInput
              label={t("Place name")}
              placeholder={t("e.g. Indianapolis")}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              rightSection={searching ? <Loader size="xs" /> : null}
              data-autofocus
            />
            {results.length > 0 && (
              <ScrollArea.Autosize mah={300} type="auto">
                <Stack gap={4}>
                  {results.map((hit) => (
                    <Button
                      key={hit.qid}
                      variant="default"
                      justify="flex-start"
                      fullWidth
                      onClick={() => handlePick(hit.qid)}
                      styles={{ label: { whiteSpace: "normal", textAlign: "left" } }}
                    >
                      <Stack gap={0} align="flex-start">
                        <Text size="sm" fw={500}>{hit.label}</Text>
                        {hit.description && <Text size="xs" c="dimmed">{hit.description}</Text>}
                      </Stack>
                    </Button>
                  ))}
                </Stack>
              </ScrollArea.Autosize>
            )}
            {results.length === 0 && !searching && query.trim().length >= MIN_SEARCH_LENGTH && (
              <Text size="xs" c="dimmed">{t("No matches")}</Text>
            )}
          </>
        )}

        {phase.name === "resolving" && (
          <Group justify="center" py="md">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">{t("Walking Wikidata's location hierarchy…")}</Text>
          </Group>
        )}

        {(phase.name === "confirm" || phase.name === "applying") && (
          <>
            <Text size="xs" c="dimmed">
              {t("This is the whole hierarchy Wikidata reports, root to leaf. Places marked \"Existing\" are reused, not duplicated; a \"Possible match\" is a same-name guess -- check it before applying. Any level can be skipped -- the levels around it connect directly instead. Fix a type guess below if it's wrong.")}
            </Text>
            <Stack gap="xs">
              {phase.rows.map((row, i) => (
                <Group key={row.node.qid} wrap="nowrap" gap="sm" style={row.skip ? { opacity: 0.5 } : undefined}>
                  <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                    <Group gap={6} wrap="nowrap">
                      <Text size="sm" fw={row.isLeaf ? 700 : 500} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                        {row.node.label}
                      </Text>
                      {row.isLeaf ? (
                        <Badge size="xs" color="blue" variant="light">{t("This place")}</Badge>
                      ) : row.skip ? (
                        <Badge size="xs" color="gray" variant="light">{t("Skipped")}</Badge>
                      ) : row.matchedBy === "qid" ? (
                        <Badge size="xs" color="teal" variant="light">{t("Existing")}</Badge>
                      ) : row.matchedBy === "name" && !row.nameMatchRejected ? (
                        <Badge size="xs" color="yellow" variant="light">{t("Possible match")}</Badge>
                      ) : (
                        <Badge size="xs" color="green" variant="light">{t("New")}</Badge>
                      )}
                    </Group>
                    {!row.skip && effectiveHandle(row) && row.existingTitle && row.existingTitle !== row.node.label && (
                      <Text size="xs" c="dimmed">{t("Matches existing place")}: {row.existingTitle}</Text>
                    )}
                    {/* Two independent per-row choices -- reject a
                     * name-only match, and skip a level entirely -- each
                     * its own checkbox (not a sentence-embedded link) so
                     * it reads as a toggle, not prose to parse, and indented
                     * under the row it applies to so it's clearly not a
                     * third badge state. */}
                    <Stack gap={4} pl="sm" mt={4}>
                      {row.matchedBy === "name" && (
                        <Checkbox
                          size="xs"
                          label={t("Incorrect match, create a new one")}
                          checked={row.nameMatchRejected}
                          onChange={(e) => updateRow(i, { nameMatchRejected: e.currentTarget.checked })}
                        />
                      )}
                      {/* Independent of the match choice above -- skipping
                       * works the same whether this row is New, a
                       * confirmed Existing place, or a Possible match:
                       * whatever it currently resolves to (see
                       * effectiveHandle) is left completely untouched, and
                       * its neighbors connect directly to each other (see
                       * handleApply's chainHandles-based reconciliation). */}
                      {!row.isLeaf && (
                        <Checkbox
                          size="xs"
                          label={t("Skip this level -- connect around it")}
                          checked={row.skip}
                          onChange={(e) => updateRow(i, { skip: e.currentTarget.checked })}
                        />
                      )}
                    </Stack>
                  </Stack>
                  <TextInput
                    size="xs"
                    placeholder={TYPE_HINT}
                    value={row.typeOverride}
                    disabled={row.skip || (!row.isLeaf && Boolean(effectiveHandle(row)))}
                    onChange={(e) => updateRow(i, { typeOverride: e.currentTarget.value })}
                    style={{ width: 160 }}
                  />
                </Group>
              ))}
            </Stack>
            <Checkbox
              label={t("Fetch place outlines from Wikidata (when available)")}
              checked={fetchOutlines}
              onChange={(e) => setFetchOutlines(e.currentTarget.checked)}
              disabled={phase.name === "applying"}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setPhase({ name: "search" })} disabled={phase.name === "applying"}>
                {t("Back")}
              </Button>
              <Button onClick={() => handleApply(phase.rows)} loading={phase.name === "applying"}>
                {t("Apply")}
              </Button>
            </Group>
          </>
        )}

        {phase.name === "error" && (
          <>
            <Alert color="red" title={t("Wikidata lookup failed")}>{phase.message}</Alert>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setPhase({ name: "search" })}>{t("Try again")}</Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}

interface WikidataPlaceLookupButtonProps {
  stackId: string;
  /** See WikidataPlaceLookupDialogProps.zIndex's own doc comment -- only
   * needed by a caller outside the app's Modal.Stack. */
  zIndex?: number;
  data: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}

/** Drop-in "Look up on Wikidata…" button + dialog, wired to a Place
 * draft's own `data`/`onChange` -- the shared integration point
 * ObjectEditDialog.tsx's `wikidataLookup` field kind, PlaceEditDialog.tsx,
 * and MapItemEditorDialog.tsx's own "Create a new place" dialog all use
 * (see the plan), so the merge-into-existing-urls/placeref_list logic
 * below is written once. */
export function WikidataPlaceLookupButton({ stackId, zIndex, data, onChange }: WikidataPlaceLookupButtonProps) {
  const [opened, setOpened] = useState(false);
  const name = (data.name ?? {}) as Record<string, unknown>;
  const currentTitle = (name.value as string | undefined) ?? (data.title as string | undefined) ?? "";

  return (
    <>
      <Button variant="default" size="xs" onClick={() => setOpened(true)}>
        {t("Look up on Wikidata…")}
      </Button>
      <WikidataPlaceLookupDialog
        opened={opened}
        onClose={() => setOpened(false)}
        stackId={stackId}
        zIndex={zIndex}
        initialQuery={currentTitle}
        onApply={(result) => {
          const wikidataUrl = `https://www.wikidata.org/wiki/${result.qid}`;
          const existingUrls = ((data.urls as { path?: string }[] | undefined) ?? []).filter(
            (u) => u.path !== wikidataUrl
          );
          const existingRefs = (data.placeref_list as { ref?: string }[] | undefined) ?? [];
          onChange({
            // Only filled in when there's no title yet -- the common case
            // this bug report came from (a brand-new place, blank title,
            // searched straight from "Look up on Wikidata…"). A place that
            // already has its own title (possibly deliberately different
            // from Wikidata's own label -- "Grandma's farm near
            // Indianapolis") keeps it; this feature only ever adds
            // lat/long/hierarchy on top of an existing title, never
            // overwrites one.
            ...(currentTitle.trim()
              ? {}
              : {
                  title: result.hierarchyTitle,
                  name: { _class: "PlaceName", ...name, value: result.hierarchyTitle },
                }),
            lat: result.lat != null ? String(result.lat) : data.lat,
            long: result.long != null ? String(result.long) : data.long,
            place_type: result.placeType ?? data.place_type,
            urls: [...existingUrls, { _class: "Url", path: wikidataUrl, desc: "", type: "Wikidata" }],
            // Deduped the same way existingUrls is above: re-running this
            // lookup on a place that's already enclosed by parentHandle
            // (the common case once a hierarchy's ancestors are QID-tagged
            // -- see WikidataPlaceLookupDialog's self-healing backfill)
            // must not pile up a second, redundant PlaceRef to it.
            placeref_list:
              result.parentHandle && !existingRefs.some((r) => r.ref === result.parentHandle)
                ? [...existingRefs, { _class: "PlaceRef", ref: result.parentHandle }]
                : existingRefs,
          });
        }}
      />
    </>
  );
}
