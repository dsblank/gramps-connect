// Select-or-enter Type field for Place, Event, Note and Repository: pick
// one of Gramps' built-in types or a custom type this tree already uses,
// or type a new custom one. Leaving the field snaps a case-only variant
// ("county") to the existing spelling ("County"), so it can't become a
// near-duplicate custom type. See store/grampsTypes.ts for the lists.
import { Autocomplete, type ComboboxItem, type ComboboxItemGroup, type MantineSize, type OptionsFilter } from "@mantine/core";
import { canonicalTypeName, useGrampsTypeOptions, type GrampsTypeKind } from "../store/grampsTypes";
import { t } from "../i18n/i18n";

interface GrampsTypeInputProps {
  kind: GrampsTypeKind;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  size?: MantineSize;
  disabled?: boolean;
  style?: React.CSSProperties;
}

// Substring match, ignoring case -- except that text equal to an option
// (the field's current, already-chosen type) shows every option, so
// clicking a filled-in field still offers the whole list to switch to.
const showAllWhenChosen: OptionsFilter = ({ options, search }) => {
  const key = search.trim().toLowerCase();
  const items = (o: ComboboxItem | ComboboxItemGroup) => ("items" in o ? o.items : [o]) as ComboboxItem[];
  if (!key || options.some((o) => items(o).some((i) => i.label.toLowerCase() === key))) return options;
  return options
    .map((o) => ("items" in o ? { ...o, items: items(o).filter((i) => i.label.toLowerCase().includes(key)) } : o))
    .filter((o) => ("items" in o ? o.items.length > 0 : (o as ComboboxItem).label.toLowerCase().includes(key)));
};

export function GrampsTypeInput({ kind, label, value, onChange, size, disabled, style }: GrampsTypeInputProps) {
  const options = useGrampsTypeOptions(kind);
  const data = [
    { group: t("Built-in"), items: options.builtIn },
    ...(options.custom.length ? [{ group: t("Used in this tree"), items: options.custom }] : []),
  ];
  return (
    <Autocomplete
      label={label}
      aria-label={label ? undefined : t("Type")}
      placeholder={t("Choose, or type your own…")}
      data={data}
      value={value}
      onChange={onChange}
      onBlur={() => {
        const canonical = canonicalTypeName(value, options);
        if (canonical !== value) onChange(canonical);
      }}
      size={size}
      disabled={disabled}
      style={style}
      filter={showAllWhenChosen}
      maxDropdownHeight={280}
      comboboxProps={{ withinPortal: true }}
    />
  );
}
