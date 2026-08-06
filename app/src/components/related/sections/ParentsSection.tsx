import { Stack, Text } from "@mantine/core";
import type { RawRef } from "../../../store/objectDetail";
import { SectionShell, RefRow, PairGroup } from "./shared";
import type { OnNavigate, SectionProps } from "../types";

interface FamilyProfile {
  handle: string;
  father?: { handle?: string; name_display?: string };
  mother?: { handle?: string; name_display?: string };
}

/** One parent-family's father+mother pair, labeled with this child's own
 * frel/mrel within it -- shared by the primary parent family and each
 * "other" one below, rather than duplicating the same RefRow pair twice. */
function ParentFamilyPair({ profileFamily, rawFamily, childHandle, onNavigate }: {
  profileFamily: FamilyProfile;
  rawFamily: { child_ref_list?: RawRef[] } | undefined;
  childHandle: string;
  onNavigate: OnNavigate;
}) {
  const father = profileFamily.father;
  const mother = profileFamily.mother;
  if (!father?.handle && !mother?.handle) return null;
  const myRef = rawFamily?.child_ref_list?.find((r) => r.ref === childHandle);
  return (
    <PairGroup>
      {father?.handle && (
        <RefRow type="family" handle={profileFamily.handle} obj={profileFamily} refMeta={myRef} label={father.name_display} onNavigate={onNavigate} />
      )}
      {mother?.handle && (
        <RefRow type="family" handle={profileFamily.handle} obj={profileFamily} refMeta={myRef} label={mother.name_display} onNavigate={onNavigate} />
      )}
    </PairGroup>
  );
}

/** Person's own parents (via profile.primary_parent_family plus, since a
 * person can be a child in more than one family -- adoptive, step,
 * foster, ... -- profile.other_parent_families too, each matched back to
 * its raw Family in extended.parent_families by handle for frel/mrel, the
 * same way the primary one already was) or a Family's father/mother (via
 * extended.father/mother directly -- no frel/mrel here, that belongs to
 * the family's *children*, not its parents).
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

  const profile = detail.profile as { primary_parent_family?: FamilyProfile; other_parent_families?: FamilyProfile[] } | undefined;
  const primary = profile?.primary_parent_family;
  const others = profile?.other_parent_families ?? [];
  const hasPrimary = !!(primary?.father?.handle || primary?.mother?.handle);
  if (!hasPrimary && others.length === 0) return null;

  const rawPrimary = detail.extended?.primary_parent_family as { child_ref_list?: RawRef[] } | undefined;
  // Same shape as rawPrimary, one per entry in Person.parent_family_list
  // (primary included) -- matched to each "other" family by handle, since
  // this array isn't filtered the way profile.other_parent_families is.
  const rawParentFamilies = (detail.extended?.parent_families as ({ handle: string; child_ref_list?: RawRef[] })[] | undefined) ?? [];

  return (
    <SectionShell label="Parents" defaultOpen>
      <Stack gap="md">
        {hasPrimary && primary && (
          <ParentFamilyPair profileFamily={primary} rawFamily={rawPrimary} childHandle={detail.handle} onNavigate={onNavigate} />
        )}
        {others.map((fam) => (
          <div key={fam.handle}>
            <Text size="sm" c="dimmed">Also a child in:</Text>
            <ParentFamilyPair
              profileFamily={fam}
              rawFamily={rawParentFamilies.find((r) => r.handle === fam.handle)}
              childHandle={detail.handle}
              onNavigate={onNavigate}
            />
          </div>
        ))}
      </Stack>
    </SectionShell>
  );
}
