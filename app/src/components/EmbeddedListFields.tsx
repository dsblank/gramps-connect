import { Card, Group, Stack, Switch, Text, TextInput } from "@mantine/core";
import { CircleGlyphButton } from "./CircleGlyphButton";

// Attribute/Address/Url (AttributeBase/AddressBase/UrlBase in gramps' own
// class hierarchy) are inline structs, not references to another Gramps
// object -- there's no handle, no backend record, no search endpoint, so
// the attach-an-existing-record mechanism (AttachControl.tsx/refListApi.ts)
// that Note/Citation/Media/Tag use is structurally inapplicable here (see
// the plan). The only possible editor is direct inline editing of the
// parent's own list field, closer in shape to FamilyEditDialog.tsx's
// ChildrenField (add/remove rows) than to AttachControl -- but with inline
// editable fields per row instead of a search picker, since there's nothing
// to search for. Rows key off array index: these structs carry no stable id
// of their own before save, same as the read-only AttributesSection/
// AddressesSection/UrlsSection this mirrors, which already key by index.
const TYPE_HINT = "e.g. a built-in name, or your own custom label…";

export interface ListShellProps<T> {
  label: string;
  addLabel: string;
  items: T[];
  onChange: (items: T[]) => void;
  makeNew: () => T;
  renderRow: (item: T, onPatch: (patch: Partial<T>) => void) => React.ReactNode;
}

/** Exported for NameEditDialog.tsx's Surnames sub-list -- same "no handle,
 * no backend record, no search endpoint" shape as Attribute/Address/Url
 * below, just nested one level deeper (inside a Name inside a Person). */
export function ListShell<T>({ label, addLabel, items, onChange, makeNew, renderRow }: ListShellProps<T>) {
  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>{label}</Text>
      {items.map((item, i) => (
        <Group key={i} gap="xs" align="flex-start" wrap="nowrap">
          <div style={{ flex: 1 }}>
            {renderRow(item, (patch) =>
              onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)))
            )}
          </div>
          <CircleGlyphButton
            glyph="−"
            label={`Remove ${label.toLowerCase()} row`}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            size={16}
          />
        </Group>
      ))}
      <CircleGlyphButton
        glyph="+"
        label={addLabel}
        textLabel={addLabel}
        onClick={() => onChange([...items, makeNew()])}
      />
    </Stack>
  );
}

export interface Attribute {
  _class?: "Attribute";
  type?: string;
  value?: string;
  private?: boolean;
}

interface AttributeListFieldProps {
  items: Attribute[];
  onChange: (items: Attribute[]) => void;
}

/** Person/Family/Event/Source/Citation's attribute_list. */
export function AttributeListField({ items, onChange }: AttributeListFieldProps) {
  return (
    <ListShell
      label="Attributes"
      addLabel="Add attribute"
      items={items}
      onChange={onChange}
      makeNew={(): Attribute => ({ _class: "Attribute", type: "", value: "" })}
      renderRow={(attr, onPatch) => (
        <Group gap="xs" wrap="nowrap">
          <TextInput
            placeholder={TYPE_HINT}
            aria-label="Attribute type"
            value={attr.type ?? ""}
            onChange={(e) => onPatch({ type: e.currentTarget.value })}
            style={{ flex: 1 }}
          />
          <TextInput
            placeholder="Value"
            aria-label="Attribute value"
            value={attr.value ?? ""}
            onChange={(e) => onPatch({ value: e.currentTarget.value })}
            style={{ flex: 1 }}
          />
          <Switch
            label="Private"
            checked={Boolean(attr.private)}
            onChange={(e) => onPatch({ private: e.currentTarget.checked })}
          />
        </Group>
      )}
    />
  );
}

export interface Address {
  _class?: "Address";
  street?: string;
  locality?: string;
  city?: string;
  county?: string;
  state?: string;
  country?: string;
  postal?: string;
  phone?: string;
  private?: boolean;
}

interface AddressListFieldProps {
  items: Address[];
  onChange: (items: Address[]) => void;
}

/** Person/Repository's address_list. Each row is a Card, unlike Attribute/
 * Url's plain inline row -- 8 fields is too many to read as one line. */
export function AddressListField({ items, onChange }: AddressListFieldProps) {
  return (
    <ListShell
      label="Addresses"
      addLabel="Add address"
      items={items}
      onChange={onChange}
      makeNew={(): Address => ({ _class: "Address" })}
      renderRow={(addr, onPatch) => (
        <Card withBorder padding="xs">
          <Stack gap="xs">
            <TextInput
              label="Street"
              value={addr.street ?? ""}
              onChange={(e) => onPatch({ street: e.currentTarget.value })}
            />
            <TextInput
              label="Locality"
              value={addr.locality ?? ""}
              onChange={(e) => onPatch({ locality: e.currentTarget.value })}
            />
            <TextInput
              label="City"
              value={addr.city ?? ""}
              onChange={(e) => onPatch({ city: e.currentTarget.value })}
            />
            <TextInput
              label="County"
              value={addr.county ?? ""}
              onChange={(e) => onPatch({ county: e.currentTarget.value })}
            />
            <TextInput
              label="State"
              value={addr.state ?? ""}
              onChange={(e) => onPatch({ state: e.currentTarget.value })}
            />
            <TextInput
              label="Postal code"
              value={addr.postal ?? ""}
              onChange={(e) => onPatch({ postal: e.currentTarget.value })}
            />
            <TextInput
              label="Country"
              value={addr.country ?? ""}
              onChange={(e) => onPatch({ country: e.currentTarget.value })}
            />
            <TextInput
              label="Phone"
              value={addr.phone ?? ""}
              onChange={(e) => onPatch({ phone: e.currentTarget.value })}
            />
            <Switch
              label="Private"
              checked={Boolean(addr.private)}
              onChange={(e) => onPatch({ private: e.currentTarget.checked })}
            />
          </Stack>
        </Card>
      )}
    />
  );
}

export interface Url {
  _class?: "Url";
  path?: string;
  desc?: string;
  type?: string;
  private?: boolean;
}

interface UrlListFieldProps {
  items: Url[];
  onChange: (items: Url[]) => void;
}

/** Person/Place/Repository's urls (the wire field is "urls", not
 * "url_list" -- see UrlsSection.tsx). */
export function UrlListField({ items, onChange }: UrlListFieldProps) {
  return (
    <ListShell
      label="Web links"
      addLabel="Add web link"
      items={items}
      onChange={onChange}
      makeNew={(): Url => ({ _class: "Url", path: "" })}
      renderRow={(url, onPatch) => (
        <Stack gap="xs">
          <TextInput
            placeholder="URL"
            aria-label="Url path"
            value={url.path ?? ""}
            onChange={(e) => onPatch({ path: e.currentTarget.value })}
          />
          <Group gap="xs" wrap="nowrap">
            <TextInput
              placeholder="Description"
              aria-label="Url description"
              value={url.desc ?? ""}
              onChange={(e) => onPatch({ desc: e.currentTarget.value })}
              style={{ flex: 1 }}
            />
            <TextInput
              placeholder={TYPE_HINT}
              aria-label="Url type"
              value={url.type ?? ""}
              onChange={(e) => onPatch({ type: e.currentTarget.value })}
              style={{ flex: 1 }}
            />
            <Switch
              label="Private"
              checked={Boolean(url.private)}
              onChange={(e) => onPatch({ private: e.currentTarget.checked })}
            />
          </Group>
        </Stack>
      )}
    />
  );
}
