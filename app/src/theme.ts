import { createTheme, type MantineColorsTuple } from "@mantine/core";

// A blue accent close to the Gramps project's own branding (the tree-icon
// logo), used for the app bar, active nav item, links -- and, as
// `selection` below, the highlighted table row.
const grampsBlue: MantineColorsTuple = [
  "#e7f1fb", "#cfe0f5", "#a4c6ec", "#75a9e2", "#4f91da", "#3781d5",
  "#2777d3", "#1866ba", "#0f5aa7", "#004c93",
];

// The selected table row. The Gramps desktop client highlights it in
// orange, and this used to as well, but next to the blue rail and blue
// links that orange read as a third, unrelated accent rather than as
// "this row is active". Still its own semantic name -- selection and
// brand-accent stay separate concerns, and this is the token to change if
// they should ever diverge again -- but aliased to the accent rather than
// spelling out a second tuple, so the two can't drift apart by halves.
const selection: MantineColorsTuple = grampsBlue;

export const theme = createTheme({
  primaryColor: "grampsBlue",
  colors: { grampsBlue, selection },
  fontFamily: "system-ui, sans-serif",
  defaultRadius: "sm",
});
