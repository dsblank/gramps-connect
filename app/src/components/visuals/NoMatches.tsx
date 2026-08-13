import { Button, Paper, Stack, Text } from "@mantine/core";

interface NoMatchesProps {
  /** One line, in the plot's own terms: "Nothing on the map for Bob Smith". */
  title: string;
  /** Why there's nothing -- the difference between a record with no events
   * and a record whose events are all undated is the whole answer here. */
  detail: string;
  /** The one control that undoes whatever emptied the plot. An href when
   * that's a navigation (dropping a scope lives in the route), a handler
   * when it's local state (the search box, the year range, the legend). */
  action: { label: string; href: string } | { label: string; onClick: () => void };
}

/** "Nothing matched" said over an empty plot, rather than quietly plotting
 * everything instead.
 *
 * Both visuals used to treat a scope that matched no rows as no scope at all
 * and fall back to the whole tree, which answers a question nobody asked: a
 * map of the entire tree is not a plausible reading of "map this family", and
 * without the filter the user set there's nothing on screen to say so. Now the
 * plot honours the filter -- draws nothing -- and this says why, with the
 * control that brings the rest back.
 *
 * An overlay rather than VisualFrame's `empty`, which replaces the plot
 * outright: unmounting the map would drop maplibre's instance and the
 * viewport with it, so a search that briefly matches nothing would re-fit the
 * map when the next keystroke matches again. */
export function NoMatches({ title, detail, action }: NoMatchesProps) {
  return (
    <Paper
      withBorder
      shadow="md"
      p="md"
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: 300,
        zIndex: 3,
        textAlign: "center",
      }}
    >
      <Stack gap="xs" align="center">
        <Text size="sm" fw={600}>{title}</Text>
        <Text size="xs" c="dimmed">{detail}</Text>
        {"href" in action ? (
          <Button size="xs" variant="default" component="a" href={action.href}>
            {action.label}
          </Button>
        ) : (
          <Button size="xs" variant="default" onClick={action.onClick}>
            {action.label}
          </Button>
        )}
      </Stack>
    </Paper>
  );
}
