// Every citation on a record *and* on the things that belong to it -- a
// person's names, events, addresses, attributes, LDS ordinances,
// associations and photos; a family's events and children -- the same set
// Gramps desktop's Citations gramplet shows. Gathered only from what the
// record's own detail request already returned, so the Citations section
// can show a count without fetching anything.
import type { ObjectDetail } from "../../store/objectDetail";
import { formatDisplayName } from "../../store/nameDisplay";
import { summaryLine } from "./summary";
import { LDS_TYPE_LABELS } from "./sections/LdsOrdinancesSection";
import { t } from "../../i18n/i18n";

/** Where a citation is attached, when it isn't on the record itself. `type`
 * and `handle` are set when that place is a record of its own (an event, a
 * person) and so can be linked to. */
export interface CitationVia {
  label: string;
  type?: string;
  handle?: string;
}

export interface CollectedCitation {
  handle: string;
  /** True when it's in the record's own citation_list (the ones "−" can
   * remove from here). */
  direct: boolean;
  /** Every other place it's attached, in the order found. */
  via: CitationVia[];
}

type Obj = Record<string, any>;

function list(value: unknown): Obj[] {
  return Array.isArray(value) ? (value as Obj[]) : [];
}

function handles(obj: Obj | null | undefined): string[] {
  return Array.isArray(obj?.citation_list) ? (obj!.citation_list as string[]) : [];
}

export function collectCitations(detail: ObjectDetail): CollectedCitation[] {
  const byHandle = new Map<string, CollectedCitation>();
  const entry = (handle: string) => {
    let e = byHandle.get(handle);
    if (!e) {
      e = { handle, direct: false, via: [] };
      byHandle.set(handle, e);
    }
    return e;
  };
  const add = (obj: Obj | null | undefined, via: CitationVia) => {
    for (const h of handles(obj)) {
      const e = entry(h);
      if (!e.via.some((v) => v.label === via.label && v.handle === via.handle)) e.via.push(via);
    }
  };
  const d = detail as unknown as Obj;
  const extended = (d.extended ?? {}) as Obj;

  for (const h of handles(d)) entry(h).direct = true;

  // Attributes and photos, on the record itself or on one of its events.
  const addAttributes = (owner: Obj | null | undefined, prefix: string) => {
    for (const attr of list(owner?.attribute_list)) {
      add(attr, { label: `${prefix}${t("Attribute")}: ${attr.type ?? ""}`.trim() });
    }
  };
  const addMediaRefs = (owner: Obj | null | undefined, resolved: unknown, prefix: string) => {
    const media = list(resolved);
    list(owner?.media_list).forEach((ref, i) => {
      const target = media[i] ?? null;
      const via: CitationVia = { label: `${prefix}${t("Media")}: ${summaryLine("media", target) || ref.ref}`, type: "media", handle: ref.ref };
      add(ref, via);
      addAttributes(ref, `${prefix}${t("Media")}: `);
    });
  };

  addAttributes(d, "");
  addMediaRefs(d, extended.media, "");

  // Names
  const names = [d.primary_name, ...list(d.alternate_names)].filter(Boolean) as Obj[];
  for (const name of names) add(name, { label: `${t("Name")}: ${formatDisplayName(name as Parameters<typeof formatDisplayName>[0])}` });

  // Events: the event itself (and its attributes/photos), and the link to it.
  const events = list(extended.events);
  list(d.event_ref_list).forEach((ref, i) => {
    const event = events[i] ?? null;
    const label = summaryLine("event", event) || t("Event");
    const via: CitationVia = { label, type: "event", handle: ref.ref };
    add(event, via);
    add(ref, via);
    addAttributes(event, `${label}, `);
    addAttributes(ref, `${label}, `);
    // An event's own photos aren't resolved one level down, so no title.
    for (const mref of list(event?.media_list)) add(mref, { label: `${label}, ${t("Media")}`, type: "media", handle: mref.ref });
  });

  // Addresses
  for (const address of list(d.address_list)) {
    const text = [address.street, address.city, address.state, address.country].filter(Boolean).join(", ");
    add(address, { label: `${t("Address")}${text ? `: ${text}` : ""}` });
  }

  // LDS ordinances
  for (const ord of list(d.lds_ord_list)) {
    add(ord, { label: `${t("LDS")}: ${LDS_TYPE_LABELS[ord.type] ?? ""}`.trim() });
  }

  // Associations (Person.person_ref_list)
  const people = list(extended.people);
  list(d.person_ref_list).forEach((ref, i) => {
    const name = summaryLine("person", people[i] ?? null) || ref.ref;
    add(ref, { label: `${t("Association")}: ${name}${ref.rel ? ` (${ref.rel})` : ""}`, type: "person", handle: ref.ref });
  });

  // Children (Family.child_ref_list)
  const children = list(extended.children);
  list(d.child_ref_list).forEach((ref, i) => {
    const name = summaryLine("person", children[i] ?? null) || ref.ref;
    add(ref, { label: `${t("Child")}: ${name}`, type: "person", handle: ref.ref });
  });

  return [...byHandle.values()];
}
