import { getBacklinks } from "../../../store/objectDetail";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";

const TYPE_LABELS: Record<string, string> = {
  person: "People", family: "Families", event: "Events", place: "Places",
  repository: "Repositories", source: "Sources", citation: "Citations",
  media: "Media", note: "Notes", tag: "Tags",
};

/** What points *at* this object, grouped by referencing type -- the one
 * section every object type gets (see RELATED_CONFIG), since 8 of the 10
 * types have thin-to-nonexistent forward references of their own and this
 * is the only place their relationship content comes from. Generic
 * backlinks carry no per-item ref metadata (there's no way to recover
 * which ref-list field or role matched -- see get_backlinks in
 * gramps-web-api's util.py), so these RefRows never show a refMeta badge. */
export function BacklinksSection({ detail, onNavigate }: SectionProps) {
  const backlinks = getBacklinks(detail);
  const types = Object.keys(backlinks).filter((t) => backlinks[t].length > 0);
  if (types.length === 0) return null;
  const total = types.reduce((sum, t) => sum + backlinks[t].length, 0);
  return (
    <SectionShell label="Referenced by" count={total}>
      {types.map((type) => (
        <div key={type}>
          <div style={{ fontWeight: 500, fontSize: "var(--mantine-font-size-sm)", opacity: 0.7 }}>
            {TYPE_LABELS[type] ?? type}
          </div>
          {(backlinks[type] as { handle: string }[]).map((obj) => (
            <RefRow key={obj.handle} type={type} handle={obj.handle} obj={obj} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
    </SectionShell>
  );
}
