import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";

/** Person.family_list -- families this person is a spouse/parent in (as
 * opposed to ParentsSection's parent_family_list, families they're a
 * *child* in). A plain handle list with no per-item ref metadata of its
 * own (the relationship type lives on the Family, not the membership),
 * so this reads from profile.families (already resolves spouse/children
 * summaries -- extend=all can't past one level) rather than extended. */
interface FamilyProfile {
  handle: string;
  father?: { handle?: string; name_display?: string };
  mother?: { handle?: string; name_display?: string };
}

export function FamiliesSection({ type, detail, onNavigate }: SectionProps) {
  if (type !== "person") return null;
  const families = ((detail.profile as any)?.families as FamilyProfile[] | undefined) ?? [];
  if (families.length === 0) return null;
  return (
    <SectionShell label="Families" count={families.length} defaultOpen>
      {families.map((fam) => {
        // Show the *other* member of the family (the spouse), not both --
        // father/mother is {} rather than absent when missing (see
        // hasPerson's original doc comment in the old PersonDetail.tsx),
        // so check for a handle, not just truthiness.
        const spouse = fam.father?.handle && fam.father.handle !== detail.handle
          ? fam.father
          : fam.mother?.handle && fam.mother.handle !== detail.handle
            ? fam.mother
            : undefined;
        return (
          <RefRow
            key={fam.handle}
            type="family"
            handle={fam.handle}
            obj={fam}
            label={spouse ? `Spouse: ${spouse.name_display}` : undefined}
            onNavigate={onNavigate}
          />
        );
      })}
    </SectionShell>
  );
}
