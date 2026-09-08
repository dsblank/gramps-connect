// Step 3 of WIKIDATA_PLACE_LOOKUP_PLAN.md: search Wikidata for a place,
// walk its P131 chain, and let the user confirm the whole resolved
// hierarchy (root to leaf) in one screen before anything is created --
// "one confirmation, not a per-level wizard" per the plan. Every Wikidata
// call lives in store/wikidataApi.ts; this component adds the dedup lookup
// (an existing Place already carrying a given QID, via the urls-field
// query_lang trick verified in the plan) and the actual create/patch step.
import { useEffect, useState } from "react";
import { Alert, Anchor, Badge, Button, Group, Loader, Modal, ScrollArea, Stack, Text, TextInput } from "@mantine/core";
import { getToken } from "../auth/auth";
import { fetchPage } from "../store/api";
import { PLACE_VIEW } from "../store/views";
import { createHandle, createObjects, fetchPlainObject, updateObject } from "../store/objectsApi";
import { getViewStore } from "../store/registry";
import { fetchWikidataChain, searchWikidata, type WikidataPlaceNode, type WikidataSearchResult } from "../store/wikidataApi";
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
        rows.push({ node, isLeaf, typeOverride: node.placeType ?? "", existingHandle, existingTitle, matchedBy });
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
      // What an existing/reused row needs patched once every newly created
      // ancestor above it is guaranteed to exist server-side -- built
      // during the walk below, applied afterward (see the patches loop),
      // not in-line: a reparent patch may need to reference a handle
      // that's still only a pending entry in `objects` at the point its
      // row is visited.
      const patches: { handle: string; addQid?: string; reparentFrom?: string; reparentTo?: string }[] = [];
      // The most recent existing/reused row's own handle -- what an
      // existing row *before* it was pointing at, and so what a later
      // reparent needs to remove -- and whether a new row has been created
      // since (i.e. whether the next existing row was inserted-below in
      // this confirmed hierarchy, not directly under lastExistingHandle
      // like it currently is).
      let lastExistingHandle: string | null = null;
      let pendingReparent = false;
      // Root-first order (see ChainRow's own doc comment) is exactly
      // creation order: each new row's placeref_list can point at the
      // previous row's handle -- reused or just-minted -- because that
      // one is always already in `objects` (or already exists) by the
      // time this row is built. Stops before the leaf: that place already
      // exists (or is still an in-progress draft) and is never created
      // here, only patched via the result handed back below.
      for (const row of rows) {
        if (row.isLeaf) break;
        if (row.existingHandle) {
          const patch: (typeof patches)[number] = { handle: row.existingHandle };
          if (row.matchedBy === "name") {
            // Backfill the QID onto the reused place so the *next* lookup
            // finds it via the confident "qid" match instead of falling
            // back to this same name guess again (see ChainRow.matchedBy
            // and issue #14) -- self-healing dedup, one confirmed row at a
            // time.
            patch.addQid = row.node.qid;
          }
          if (pendingReparent && lastExistingHandle) {
            // A newly created row was just inserted between this place and
            // the ancestor it currently points at ("New" sandwiched between
            // two "Existing"/"Possible match" rows on the confirm screen,
            // e.g. a Wikidata admin level -- Regierungsbezirk, say -- the
            // existing Gramps hierarchy skips) -- repoint it at the new
            // level instead of leaving it attached two levels up.
            patch.reparentFrom = lastExistingHandle;
            patch.reparentTo = parentHandle!;
          }
          if (patch.addQid || patch.reparentFrom) patches.push(patch);
          parentHandle = row.existingHandle;
          lastExistingHandle = row.existingHandle;
          pendingReparent = false;
          continue;
        }
        const handle = createHandle();
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
        });
        parentHandle = handle;
        createdAny = true;
        pendingReparent = true;
      }
      if (objects.length > 0) {
        await createObjects(token, objects);
      }
      // Fetch-then-merge, not overwrite: each patched place's urls/
      // placeref_list may already hold unrelated entries.
      for (const patch of patches) {
        const existing = await fetchPlainObject(token, PLACE_VIEW, patch.handle);
        const update: Record<string, unknown> = { ...existing };
        let changed = false;
        if (patch.addQid) {
          const wikidataUrl = `https://www.wikidata.org/wiki/${patch.addQid}`;
          const existingUrls = (existing.urls as { path?: string }[] | undefined) ?? [];
          if (!existingUrls.some((u) => u.path === wikidataUrl)) {
            update.urls = [...existingUrls, { _class: "Url", path: wikidataUrl, desc: "", type: "Wikidata" }];
            changed = true;
          }
        }
        if (patch.reparentFrom && patch.reparentTo) {
          const refs = (existing.placeref_list as { _class?: string; ref?: string }[] | undefined) ?? [];
          const nextRefs = refs.filter((r) => r.ref !== patch.reparentFrom);
          if (!nextRefs.some((r) => r.ref === patch.reparentTo)) {
            nextRefs.push({ _class: "PlaceRef", ref: patch.reparentTo });
          }
          if (JSON.stringify(nextRefs) !== JSON.stringify(refs)) {
            update.placeref_list = nextRefs;
            changed = true;
          }
        }
        if (changed) await updateObject(token, PLACE_VIEW, patch.handle, update);
      }
      if (createdAny) getViewStore("place").requeryDebounced();

      const leaf = rows.find((r) => r.isLeaf);
      if (leaf) {
        // rows is root-first (see ChainRow's doc comment); the hierarchy
        // title reads leaf-to-root, so reverse it.
        const hierarchyTitle = [...rows].reverse().map((r) => r.node.label).join(", ");
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
              {t("This is the whole hierarchy Wikidata reports, root to leaf. Places marked \"Existing\" are reused, not duplicated; a \"Possible match\" is a same-name guess -- check it before applying. Fix a type guess below if it's wrong.")}
            </Text>
            <Stack gap="xs">
              {phase.rows.map((row, i) => (
                <Group key={row.node.qid} wrap="nowrap" gap="sm">
                  <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                    <Group gap={6} wrap="nowrap">
                      <Text size="sm" fw={row.isLeaf ? 700 : 500} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                        {row.node.label}
                      </Text>
                      {row.isLeaf ? (
                        <Badge size="xs" color="blue" variant="light">{t("This place")}</Badge>
                      ) : row.matchedBy === "qid" ? (
                        <Badge size="xs" color="teal" variant="light">{t("Existing")}</Badge>
                      ) : row.matchedBy === "name" ? (
                        <Badge size="xs" color="yellow" variant="light">{t("Possible match")}</Badge>
                      ) : (
                        <Badge size="xs" color="green" variant="light">{t("New")}</Badge>
                      )}
                    </Group>
                    {row.existingHandle && row.existingTitle && row.existingTitle !== row.node.label && (
                      <Text size="xs" c="dimmed">{t("Matches existing place")}: {row.existingTitle}</Text>
                    )}
                    {row.matchedBy === "name" && (
                      <Text size="xs" c="dimmed">
                        {t("Same name already in your tree, but no confirmed Wikidata link -- ")}
                        <Anchor
                          size="xs"
                          onClick={() => updateRow(i, { existingHandle: null, existingTitle: null, matchedBy: null })}
                        >
                          {t("not the same place, create new")}
                        </Anchor>
                      </Text>
                    )}
                  </Stack>
                  <TextInput
                    size="xs"
                    placeholder={TYPE_HINT}
                    value={row.typeOverride}
                    disabled={!row.isLeaf && Boolean(row.existingHandle)}
                    onChange={(e) => updateRow(i, { typeOverride: e.currentTarget.value })}
                    style={{ width: 160 }}
                  />
                </Group>
              ))}
            </Stack>
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
