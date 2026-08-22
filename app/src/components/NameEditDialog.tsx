import { useState } from "react";
import { Anchor, Button, Card, Collapse, Group, Modal, Select, Stack, Switch, Text, TextInput } from "@mantine/core";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { DateInput } from "./DateInput";
import { ListShell } from "./EmbeddedListFields";
import { t } from "../i18n/i18n";

// NameType (gramps/gen/lib/nametype.py) -- plain English strings, same
// convention as FamilyEditDialog's REL_TYPE_OPTIONS: gramps-web-api's
// fix_object_dict() turns a Name's `type` string back into the full
// NameType struct server-side.
const NAME_TYPE_OPTIONS = ["Birth Name", "Married Name", "Also Known As", "Unknown"];

// NameOriginType (gramps/gen/lib/nameorigintype.py) -- same string
// convention, for a Surname's `origintype`.
const ORIGIN_TYPE_OPTIONS = [
  "", "Inherited", "Given", "Taken", "Patronymic", "Matronymic", "Feudal", "Pseudonym",
  "Patrilineal", "Matrilineal", "Occupation", "Location",
];

// Name.{DEF,LNFN,FNLN,FN,LNFNP} (gramps/gen/lib/name.py) -- sort_as/
// display_as are plain integers on the wire, not GrampsType structs.
const FORMAT_OPTIONS = [
  { value: "0", label: "Default" },
  { value: "1", label: "Surname, Given" },
  { value: "2", label: "Given Surname" },
  { value: "4", label: "Given only" },
  { value: "5", label: "Primary surname, connector, rest" },
];

export interface Surname {
  _class?: "Surname";
  surname?: string;
  prefix?: string;
  primary?: boolean;
  connector?: string;
  origintype?: string;
}

interface NameEditDialogProps {
  stackId: string;
  opened: boolean;
  title: string;
  data: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  onDone: () => void;
  /** Only set for an alternate name -- the primary name can't be removed,
   * only edited (a Person always has exactly one primary_name). */
  onRemove?: () => void;
}

/** Full editor for one Name struct (Person.primary_name, or one entry of
 * Person.alternate_names) -- the "More name details…" stacked dialog
 * PersonEditDialog opens off its quick Given/Surname fields, or off an
 * alternate name's row. Reused for both: a Name is a Name regardless of
 * which Person field holds it.
 *
 * Stacks on top of PersonEditDialog the same way FamilyEditDialog's "+ New
 * Person" stacks a PersonEditDialog -- a Mantine Modal with its own
 * `stackId`. PersonEditDialog keeps every one of these permanently mounted
 * (toggling only `opened`), the same ModalStack-registry reason
 * draftStack.ts's DraftEntry.active doc comment explains for its own
 * never-remove-only-deactivate stack. */
export function NameEditDialog({ stackId, opened, title, data, onChange, onDone, onRemove }: NameEditDialogProps) {
  const [showSorting, setShowSorting] = useState(false);

  const surnameList = (data.surname_list as Surname[] | undefined) ?? [];
  const date = (data.date as GrampsDate | undefined) ?? null;

  return (
    <Modal opened={opened} onClose={onDone} title={title} size="xl" stackId={stackId}>
      <Stack gap="md">
        <Group grow>
          <TextInput
            label={t("Title")}
            value={(data.title as string | undefined) ?? ""}
            onChange={(e) => onChange({ title: e.currentTarget.value })}
          />
          <TextInput
            label={t("Given name")}
            value={(data.first_name as string | undefined) ?? ""}
            onChange={(e) => onChange({ first_name: e.currentTarget.value })}
          />
          <TextInput
            label={t("Suffix")}
            value={(data.suffix as string | undefined) ?? ""}
            onChange={(e) => onChange({ suffix: e.currentTarget.value })}
          />
        </Group>

        <ListShell<Surname>
          label={t("Surnames")}
          addLabel="Add surname"
          items={surnameList}
          onChange={(items) => onChange({ surname_list: items })}
          makeNew={(): Surname => ({ _class: "Surname", surname: "", primary: surnameList.length === 0 })}
          renderRow={(surname, onPatch) => (
            <Card withBorder padding="xs">
              <Stack gap="xs">
                <Group gap="xs" wrap="nowrap">
                  <TextInput
                    placeholder={t("Prefix")}
                    aria-label="Surname prefix"
                    value={surname.prefix ?? ""}
                    onChange={(e) => onPatch({ prefix: e.currentTarget.value })}
                    style={{ flex: 1 }}
                  />
                  <TextInput
                    placeholder={t("Surname")}
                    aria-label="Surname"
                    value={surname.surname ?? ""}
                    onChange={(e) => onPatch({ surname: e.currentTarget.value })}
                    style={{ flex: 2 }}
                  />
                  <TextInput
                    placeholder={t("Connector")}
                    aria-label="Surname connector"
                    value={surname.connector ?? ""}
                    onChange={(e) => onPatch({ connector: e.currentTarget.value })}
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group gap="xs" wrap="nowrap" justify="space-between">
                  <Group gap={6} wrap="nowrap" style={{ flex: 1 }}>
                    <Text size="sm" c="dimmed">{t("Surname type:")}</Text>
                    <Select
                      placeholder={t("Origin")}
                      aria-label="Surname origin"
                      data={ORIGIN_TYPE_OPTIONS.map((o) => ({ value: o, label: o || "(none)" }))}
                      value={surname.origintype ?? ""}
                      onChange={(next) => onPatch({ origintype: next ?? "" })}
                      comboboxProps={{ withinPortal: true }}
                      style={{ flex: 1 }}
                    />
                  </Group>
                  {/* Toggling one surname's primary flag on clears it from
                   * every other row -- SurnameBase expects exactly one
                   * primary surname, not a per-row independent switch. */}
                  <Switch
                    label={t("Primary")}
                    checked={Boolean(surname.primary)}
                    onChange={(e) => {
                      const checked = e.currentTarget.checked;
                      onChange({
                        surname_list: surnameList.map((s) =>
                          s === surname ? { ...s, primary: checked } : { ...s, primary: checked ? false : s.primary }
                        ),
                      });
                    }}
                  />
                </Group>
              </Stack>
            </Card>
          )}
        />

        <Group grow>
          <TextInput
            label={t("Call name")}
            value={(data.call as string | undefined) ?? ""}
            onChange={(e) => onChange({ call: e.currentTarget.value })}
          />
          <TextInput
            label={t("Nickname")}
            value={(data.nick as string | undefined) ?? ""}
            onChange={(e) => onChange({ nick: e.currentTarget.value })}
          />
          <TextInput
            label={t("Family nickname")}
            value={(data.famnick as string | undefined) ?? ""}
            onChange={(e) => onChange({ famnick: e.currentTarget.value })}
          />
        </Group>

        <Group grow align="flex-end">
          <Select
            label={t("Name type")}
            data={NAME_TYPE_OPTIONS}
            value={(data.type as string | undefined) ?? "Birth Name"}
            onChange={(next) => onChange({ type: next ?? "Birth Name" })}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
          />
          <Switch
            label={t("Private")}
            checked={Boolean(data.private)}
            onChange={(e) => onChange({ private: e.currentTarget.checked })}
          />
        </Group>

        <DateInput id={`${stackId}-date`} label={t("Date")} value={date} onChange={(next) => onChange({ date: next })} />

        <Anchor component="button" type="button" size="sm" onClick={() => setShowSorting((v) => !v)}>
          {showSorting ? "▾" : "▸"} Sorting & display
        </Anchor>
        <Collapse in={showSorting}>
          <Stack gap="md">
            <TextInput
              label={t("Group as")}
              description="Leave blank to group by primary surname"
              value={(data.group_as as string | undefined) ?? ""}
              onChange={(e) => onChange({ group_as: e.currentTarget.value })}
            />
            <Select
              label={t("Sort as")}
              data={FORMAT_OPTIONS}
              value={String((data.sort_as as number | undefined) ?? 0)}
              onChange={(next) => onChange({ sort_as: Number(next ?? 0) })}
              allowDeselect={false}
              comboboxProps={{ withinPortal: true }}
            />
            <Select
              label={t("Display as")}
              data={FORMAT_OPTIONS}
              value={String((data.display_as as number | undefined) ?? 0)}
              onChange={(next) => onChange({ display_as: Number(next ?? 0) })}
              allowDeselect={false}
              comboboxProps={{ withinPortal: true }}
            />
          </Stack>
        </Collapse>

        <Group justify="space-between">
          {onRemove ? (
            <Button variant="subtle" color="red" onClick={onRemove}>
              {t("Remove this name")}
            </Button>
          ) : (
            <div />
          )}
          <Button onClick={onDone}>{t("Done")}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
