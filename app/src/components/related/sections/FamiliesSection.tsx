import { useState } from "react";
import { Modal, Stack, Text } from "@mantine/core";
import { getToken, hasPermissions } from "../../../auth/auth";
import { fetchPlainObject } from "../../../store/objectsApi";
import { setRefField } from "../../../store/refListApi";
import { FAMILY_VIEW } from "../../../store/views";
import { CircleGlyphButton } from "../../CircleGlyphButton";
import { RecordPicker } from "../../RecordPicker";
import { pickerResultLabel } from "../../RefPickerField";
import type { QueryItem } from "../../../store/api";
import { SectionShell, RefRow } from "./shared";
import { withGrampsId } from "../summary";
import type { SectionProps } from "../types";

/** Person.family_list -- families this person is a spouse/parent in (as
 * opposed to ParentsSection's parent_family_list, families they're a
 * *child* in). A plain handle list with no per-item ref metadata of its
 * own (the relationship type lives on the Family, not the membership),
 * so this reads from profile.families (already resolves spouse/children
 * summaries -- extend=all can't past one level) rather than extended. */
interface FamilyProfile {
  handle: string;
  gramps_id?: string;
  father?: { handle?: string; name_display?: string };
  mother?: { handle?: string; name_display?: string };
}

/** "+" for this section is a reverse write -- unlike every other section's
 * AttachControl/SetFieldControl, which mutate `detail` itself, adding a
 * family membership means mutating the *picked Family's* father_handle/
 * mother_handle (ParentsSection.tsx's own fields, Phase 3), not anything
 * on the Person being displayed. Which slot to fill isn't known until
 * after the pick (an existing family may be missing either, or neither),
 * so this fetches the picked family fresh (fetchPlainObject) rather than
 * relying on FAMILY_VIEW's query-list columns, and fills whichever of
 * father_handle/mother_handle is empty -- father first if both are, since
 * neither slot is gender-enforced and a specific assignment is always
 * available afterward from that family's own edit dialog. Creating a
 * brand-new family from here is out of scope (see the plan this
 * implements) -- that's nested-draft-shaped work, not a live PUT; this
 * only attaches to a family that already exists. */
function AddFamilyControl({ personHandle, onAdded }: { personHandle: string; onAdded: () => void }) {
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!hasPermissions("EditObject")) return null;

  async function handlePick(item: QueryItem) {
    setError(null);
    const token = await getToken();
    const fam = await fetchPlainObject(token, FAMILY_VIEW, item.handle);
    const field = !fam.father_handle ? "father_handle" : !fam.mother_handle ? "mother_handle" : null;
    if (!field) {
      setError("This family already has both a father and a mother.");
      return;
    }
    setOpened(false);
    await setRefField(token, FAMILY_VIEW, item.handle, field, personHandle);
    onAdded();
  }

  return (
    <>
      <CircleGlyphButton
        glyph="+"
        label="Attach a family"
        textLabel="Add a family"
        onClick={() => {
          setError(null);
          setOpened(true);
        }}
      />
      <Modal opened={opened} onClose={() => setOpened(false)} title="Adding a family" size="sm">
        <Stack gap="xs">
          {error && <Text size="xs" c="red">{error}</Text>}
          <RecordPicker
            view={FAMILY_VIEW}
            searchField="gramps_id"
            placeholder={FAMILY_VIEW.simpleSearch?.placeholder ?? "Search…"}
            buildExpr={FAMILY_VIEW.simpleSearch?.buildExpr}
            renderLabel={(item) => pickerResultLabel("family", item)}
            onPick={handlePick}
            confirmWithButton
          />
        </Stack>
      </Modal>
    </>
  );
}

export function FamiliesSection({ type, detail, onNavigate, onRefetch }: SectionProps) {
  if (type !== "person") return null;
  const families = ((detail.profile as any)?.families as FamilyProfile[] | undefined) ?? [];
  const canEdit = hasPermissions("EditObject");
  if (families.length === 0 && !canEdit) return null;

  async function handleClear(fam: FamilyProfile) {
    const isFather = fam.father?.handle === detail.handle;
    const field = isFather ? "father_handle" : "mother_handle";
    const roleLabel = isFather ? "father" : "mother";
    if (!window.confirm(`Remove this person as ${roleLabel} of this family? This does not delete the family itself.`)) return;
    const token = await getToken();
    await setRefField(token, FAMILY_VIEW, fam.handle, field, "");
    onRefetch?.();
  }

  return (
    <SectionShell label="Families">
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
            label={spouse ? withGrampsId(fam.gramps_id, `Spouse: ${spouse.name_display}`) : undefined}
            onNavigate={onNavigate}
            onRemove={canEdit ? () => handleClear(fam) : undefined}
          />
        );
      })}
      {canEdit && <AddFamilyControl personHandle={detail.handle} onAdded={() => onRefetch?.()} />}
    </SectionShell>
  );
}
