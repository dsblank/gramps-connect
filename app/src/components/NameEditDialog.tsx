import { useEffect, useState } from "react";
import { Anchor, Button, Card, Checkbox, Collapse, Group, Modal, Select, Stack, Switch, Text, TextInput } from "@mantine/core";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { DateInput } from "./DateInput";
import { ListShell } from "./EmbeddedListFields";
import { t } from "../i18n/i18n";
import { hasPermissions } from "../auth/auth";
import { getNameGroup, loadNameGroupMappings, useNameGroupsVersion } from "../store/nameGroups";
import { BUILTIN_NAME_FORMATS, getLoadedCustomNameFormats } from "../store/displaySettings";

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
  /** Tree-wide surname groupings waiting for the person's Save (the
   * draft's DraftEntry.nameGroups): surname -> group, null to ungroup. */
  pendingNameGroups: Record<string, string | null>;
  /** Records one (`group` undefined: forgets it) -- applied on Save, so
   * cancelling the person edit discards it. */
  onNameGroup: (surname: string, group: string | null | undefined) => void;
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
export function NameEditDialog({
  stackId, opened, title, data, onChange, onDone, onRemove, pendingNameGroups, onNameGroup,
}: NameEditDialogProps) {
  const [showMore, setShowMore] = useState(false);
  // "Group everyone named X as Y" -- desktop's "Group all" answer, recorded
  // on Done (see handleDone) and written when the person is saved.
  const [groupAll, setGroupAll] = useState(false);
  // The tree-wide surname groups (nameGroups.ts), refetched on open so a
  // grouping someone else just made shows here; re-renders when they land.
  useNameGroupsVersion();
  useEffect(() => {
    if (opened) loadNameGroupMappings(true).catch(() => {});
  }, [opened]);

  const surnameList = (data.surname_list as Surname[] | undefined) ?? [];
  const date = (data.date as GrampsDate | undefined) ?? null;
  const primarySurname = ((surnameList.find((s) => s.primary) ?? surnameList[0])?.surname ?? "").trim();
  const groupAs = ((data.group_as as string | undefined) ?? "").trim();
  const pending = primarySurname !== "" && primarySurname in pendingNameGroups;
  const savedGroup = primarySurname ? getNameGroup(primarySurname) : null;
  // What the surname's tree-wide group will be once the person is saved.
  const treeGroup = pending ? pendingNameGroups[primarySurname] : savedGroup;
  const canGroupAll = hasPermissions("EditNameGroup") && primarySurname !== "";
  const offerGroupAll = canGroupAll && groupAs !== "" && groupAs !== primarySurname && groupAs !== treeGroup;
  const displayAs = (data.display_as as number | undefined) ?? 0;

  // Start expanded when the name already overrides its display or is
  // grouped, so those settings aren't hidden behind a collapsed link.
  useEffect(() => {
    if (opened) setShowMore(displayAs !== 0 || groupAs !== "" || treeGroup != null);
    // Only on open: the user's own expand/collapse wins after that.
  }, [opened]);

  // Display as: a name format number (Name.display_as) -- the built-ins, or
  // the tree's custom formats by negative number (nameFormatFor()). A
  // value matching neither (e.g. a since-deleted custom format) stays
  // listed so the Select doesn't show blank.
  const displayOptions = [
    ...BUILTIN_NAME_FORMATS.map((opt) => ({
      value: String(opt.number),
      label: opt.number === 0 ? t("Default (the tree's name format)") : t(opt.name),
    })),
    ...getLoadedCustomNameFormats()
      .filter((opt) => opt.usable && opt.active)
      .map((opt) => ({ value: String(opt.number), label: opt.name })),
  ];
  if (!displayOptions.some((opt) => opt.value === String(displayAs))) {
    displayOptions.push({ value: String(displayAs), label: `${t("Unknown format")} (${displayAs})` });
  }

  /** Desktop's EditName.save() grouping rules, simplified: a Group as that
   * just repeats the surname is cleared, and "Group all" records the
   * tree-wide grouping instead of this name's own Group as. Unlike desktop,
   * which writes that grouping as the name editor closes, it waits for the
   * person's Save -- cancelling the edit discards it. */
  function handleDone() {
    if (offerGroupAll && groupAll) {
      onNameGroup(primarySurname, groupAs);
      onChange({ group_as: "" });
    } else if (groupAs !== "" && groupAs === primarySurname) {
      onChange({ group_as: "" });
    }
    setGroupAll(false);
    onDone();
  }

  /** Undoes a pending change, else asks (on Save) to ungroup a saved one. */
  function toggleUngroup() {
    if (pending) onNameGroup(primarySurname, undefined);
    else onNameGroup(primarySurname, null);
  }

  return (
    <Modal opened={opened} onClose={handleDone} title={title} size="xl" stackId={stackId}>
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
                    aria-label={t("Surname prefix")}
                    value={surname.prefix ?? ""}
                    onChange={(e) => onPatch({ prefix: e.currentTarget.value })}
                    style={{ flex: 1 }}
                  />
                  <TextInput
                    placeholder={t("Surname")}
                    aria-label={t("Surname")}
                    value={surname.surname ?? ""}
                    onChange={(e) => onPatch({ surname: e.currentTarget.value })}
                    style={{ flex: 2 }}
                  />
                  <TextInput
                    placeholder={t("Connector")}
                    aria-label={t("Surname connector")}
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
                      aria-label={t("Surname origin")}
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
            data={NAME_TYPE_OPTIONS.map((v) => ({ value: v, label: t(v) }))}
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

        <Anchor component="button" type="button" size="sm" onClick={() => setShowMore((v) => !v)}>
          {showMore ? "▾" : "▸"} {t("Display & surname group")}
        </Anchor>
        <Collapse in={showMore}>
          <Stack gap="md">
            <Select
              label={t("Display as")}
              description={t("How this one name is written throughout the app. Default follows the tree's name format in Preferences.")}
              data={displayOptions}
              value={String(displayAs)}
              onChange={(next) => onChange({ display_as: Number(next ?? 0) })}
              allowDeselect={false}
              comboboxProps={{ withinPortal: true }}
            />
            <Stack gap={4}>
              <Text size="sm" fw={500}>{t("Surname group")}</Text>
              <Text size="xs" c="dimmed">
                {t("Treats spelling variants as one family: with Smyth grouped as Smith, searching the People list for Smith also finds the Smyths.")}
              </Text>
            </Stack>
            <TextInput
              label={t("Group as")}
              description={
                treeGroup
                  ? `${t("Everyone named")} ${primarySurname} ${t("is grouped as")} ${treeGroup}. ${t("Leave blank to keep that.")}`
                  : t("Leave blank to group by primary surname. Searching for the group also finds this name.")
              }
              placeholder={treeGroup ?? primarySurname}
              value={(data.group_as as string | undefined) ?? ""}
              onChange={(e) => onChange({ group_as: e.currentTarget.value })}
            />
            {offerGroupAll && (
              <Checkbox
                label={`${t("Group everyone named")} ${primarySurname} ${t("as")} ${groupAs}`}
                description={t("Applies to the whole tree when you save this person, not just this name.")}
                checked={groupAll}
                onChange={(e) => setGroupAll(e.currentTarget.checked)}
              />
            )}
            {canGroupAll && (pending || savedGroup) && (
              <Group gap="xs">
                {pending && (
                  <Text size="sm" c="dimmed">
                    {treeGroup
                      ? `${t("When you save, everyone named")} ${primarySurname} ${t("will be grouped as")} ${treeGroup}.`
                      : `${t("When you save, everyone named")} ${primarySurname} ${t("will no longer be grouped as")} ${savedGroup}.`}
                  </Text>
                )}
                <Button size="xs" variant="default" onClick={toggleUngroup}>
                  {pending
                    ? t("Undo")
                    : `${t("Stop grouping everyone named")} ${primarySurname} ${t("as")} ${savedGroup}`}
                </Button>
              </Group>
            )}
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
          <Button onClick={handleDone}>{t("Done")}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
