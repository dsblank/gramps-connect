import { createTheme, type MantineColorsTuple } from "@mantine/core";

// A blue accent close to the Gramps project's own branding (the tree-icon
// logo), used for the app bar, active nav item, and links -- distinct from
// `selection`, which is the row-highlight color below.
const grampsBlue: MantineColorsTuple = [
  "#e7f1fb", "#cfe0f5", "#a4c6ec", "#75a9e2", "#4f91da", "#3781d5",
  "#2777d3", "#1866ba", "#0f5aa7", "#004c93",
];

// The Gramps desktop client highlights the selected table row in orange
// (see the reference screenshot) -- kept as its own semantic color rather
// than reusing `primary`, since selection and brand-accent are independent
// concerns that happen to look different in the reference UI.
const selection: MantineColorsTuple = [
  "#fff2e8", "#ffe0cc", "#ffc199", "#ff9d5c", "#f9822e", "#e8590c",
  "#c94a09", "#a83c07", "#872f05", "#662304",
];

export const theme = createTheme({
  primaryColor: "grampsBlue",
  colors: { grampsBlue, selection },
  fontFamily: "system-ui, sans-serif",
  defaultRadius: "sm",
});
