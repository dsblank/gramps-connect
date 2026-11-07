// Mantine's Autocomplete (pick from a list, or type anything) with the
// same down-chevron Mantine's own Select shows (Combobox.Chevron), so a
// select-or-enter field looks like it has choices. Every such field in the
// app uses this rather than a bare Autocomplete.
//
// The chevron ignores pointer events, so clicking it lands on the input,
// which opens the list.
import { Autocomplete, Combobox, type AutocompleteProps } from "@mantine/core";

export function SelectOrEnter(props: AutocompleteProps) {
  return (
    <Autocomplete
      rightSection={<Combobox.Chevron size={props.size} />}
      rightSectionPointerEvents="none"
      {...props}
    />
  );
}
