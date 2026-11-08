// A place's alternate locations (alt_loc): add, edit, remove. Each is a
// Gramps Location -- an old-style flat address (street, locality, city,
// parish, county, state, postal code, country, phone) from before Gramps
// 4.1 made places a hierarchy. Gramps keeps the list so a place can still
// record the jurisdictions it belonged to at other times (an older parish
// or county); imported GEDCOM and older trees often carry data here.
// Gramps Desktop edits it on the Place editor's "Alternate Locations" tab.
//
// Shared by ObjectEditDialog.tsx (the top-level Place editor) and
// PlaceEditDialog.tsx (the nested one). Unlike Address, a Location has no
// private flag or date of its own (gramps/gen/lib/location.py).
import { Card, SimpleGrid, Stack, TextInput } from "@mantine/core";
import { ListShell } from "./EmbeddedListFields";
import { t } from "../i18n/i18n";

export interface PlaceLocation {
  _class?: "Location";
  street?: string;
  locality?: string;
  city?: string;
  parish?: string;
  county?: string;
  state?: string;
  postal?: string;
  country?: string;
  phone?: string;
}

interface PlaceLocationsFieldProps {
  items: PlaceLocation[];
  onChange: (items: PlaceLocation[]) => void;
}

export function PlaceLocationsField({ items, onChange }: PlaceLocationsFieldProps) {
  return (
    <ListShell
      label={t("Alternate Locations")}
      addLabel="Add alternate location"
      items={items}
      onChange={onChange}
      makeNew={(): PlaceLocation => ({ _class: "Location" })}
      renderRow={(loc, onPatch) => (
        // A Card per row, like AddressListField: nine fields is too many to
        // read as one line. Two columns keep it short in the md-width modal.
        <Card withBorder padding="xs">
          <Stack gap="xs">
            <TextInput
              label={t("Street")}
              value={loc.street ?? ""}
              onChange={(e) => onPatch({ street: e.currentTarget.value })}
            />
            <SimpleGrid cols={2} spacing="xs" verticalSpacing="xs">
              <TextInput
                label={t("Locality")}
                value={loc.locality ?? ""}
                onChange={(e) => onPatch({ locality: e.currentTarget.value })}
              />
              <TextInput
                label={t("City")}
                value={loc.city ?? ""}
                onChange={(e) => onPatch({ city: e.currentTarget.value })}
              />
              <TextInput
                label={t("Parish")}
                value={loc.parish ?? ""}
                onChange={(e) => onPatch({ parish: e.currentTarget.value })}
              />
              <TextInput
                label={t("County")}
                value={loc.county ?? ""}
                onChange={(e) => onPatch({ county: e.currentTarget.value })}
              />
              <TextInput
                label={t("State")}
                value={loc.state ?? ""}
                onChange={(e) => onPatch({ state: e.currentTarget.value })}
              />
              <TextInput
                label={t("Postal code")}
                value={loc.postal ?? ""}
                onChange={(e) => onPatch({ postal: e.currentTarget.value })}
              />
              <TextInput
                label={t("Country")}
                value={loc.country ?? ""}
                onChange={(e) => onPatch({ country: e.currentTarget.value })}
              />
              <TextInput
                label={t("Phone")}
                value={loc.phone ?? ""}
                onChange={(e) => onPatch({ phone: e.currentTarget.value })}
              />
            </SimpleGrid>
          </Stack>
        </Card>
      )}
    />
  );
}
