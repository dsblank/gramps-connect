import type { RawRef } from "../../../store/objectDetail";
import { SectionShell, RefRow, PairGroup } from "./shared";
import type { SectionProps } from "../types";

/** Person's own parents (via profile.primary_parent_family, matching
 * frel/mrel found by locating this person's own handle inside that
 * family's raw child_ref_list -- extend=all doesn't resolve father/mother
 * past one level, only the profile builder does) or a Family's father/
 * mother (via extended.father/mother directly -- no frel/mrel here, that
 * belongs to the family's *children*, not its parents). Only the primary
 * parent family is shown for Person, matching the scope the previous
 * PersonDetail.tsx covered -- other/adoptive parent families are future
 * scope.
 *
 * The person branch's rows navigate to the *family*, not to father/mother
 * as individuals -- Person has no direct reference to either parent at
 * all (there's no father_handle/mother_handle on Person, only
 * parent_family_list); the father/mother fields only exist on Family. So
 * "this person's parents" is really "the family this person is a child
 * in", and clicking into it should show that family (father, mother, and
 * -- unlike this person's own page -- their other children, i.e. this
 * person's siblings) rather than re-showing one parent's own hub as if
 * they'd been selected directly in the main table. The family branch
 * above doesn't have this problem: you're already looking at the family,
 * so drilling into a specific parent as an individual is a real "go
 * deeper" step, not a circular one. */
export function ParentsSection({ type, detail, onNavigate }: SectionProps) {
  if (type === "family") {
    // `{}` rather than absent when a family has no father/mother -- see
    // PlaceSection's doc comment on this gramps-web-api convention.
    const father = detail.extended?.father as { handle?: string } | undefined;
    const mother = detail.extended?.mother as { handle?: string } | undefined;
    if (!father?.handle && !mother?.handle) return null;
    return (
      <SectionShell label="Parents" defaultOpen>
        <PairGroup>
          {father?.handle && <RefRow type="person" handle={father.handle} obj={father} onNavigate={onNavigate} />}
          {mother?.handle && <RefRow type="person" handle={mother.handle} obj={mother} onNavigate={onNavigate} />}
        </PairGroup>
      </SectionShell>
    );
  }

  const profileFamily = (detail.profile as any)?.primary_parent_family;
  const father = profileFamily?.father;
  const mother = profileFamily?.mother;
  if (!father?.handle && !mother?.handle) return null;

  const rawFamily = detail.extended?.primary_parent_family as { handle?: string; child_ref_list?: RawRef[] } | undefined;
  const familyHandle = profileFamily?.handle ?? rawFamily?.handle;
  const myRef = rawFamily?.child_ref_list?.find((r) => r.ref === detail.handle);

  if (!familyHandle) return null;

  return (
    <SectionShell label="Parents" defaultOpen>
      <PairGroup>
        {father?.handle && (
          <RefRow type="family" handle={familyHandle} obj={profileFamily} refMeta={myRef} label={father.name_display} onNavigate={onNavigate} />
        )}
        {mother?.handle && (
          <RefRow type="family" handle={familyHandle} obj={profileFamily} refMeta={myRef} label={mother.name_display} onNavigate={onNavigate} />
        )}
      </PairGroup>
    </SectionShell>
  );
}
