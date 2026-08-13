import { useState, type ReactNode } from "react";
import { ActionIcon, Alert, Box, Group, Loader, Modal, Stack, Text, Tooltip } from "@mantine/core";

interface VisualModalProps {
  opened: boolean;
  onClose: () => void;
  title: string;
  /** Filters and legend -- one row directly above the plot. */
  toolbar?: ReactNode;
  /** Bottom strip: what's plotted, and any cache-completeness caveat. */
  status?: ReactNode;
  loading: boolean;
  error: string | null;
  /** Rendered instead of `children` when there's nothing to plot, so each
   * visual can say why in its own terms. */
  empty?: ReactNode;
  children: ReactNode;
}

/** The dialog both View > Map and View > Timeline live in: a bordered,
 * windowed modal whose body is a fixed-height flex column (toolbar, plot,
 * status), so the plot gets exactly the leftover space and scrolls nothing.
 * The header carries an expand control that takes it full-screen and back.
 *
 * Opening as a dialog rather than straight to full-screen keeps the app
 * visible around it: these are things you consult, and arriving at one
 * shouldn't feel like leaving where you were. Both plots resize themselves
 * (the timeline off its own ResizeObserver, the map off maplibre's), so
 * expanding is purely a matter of the frame changing size.
 *
 * A dialog rather than a mode that swaps out the table, in either size:
 * these are whole-tree overviews, not another way to look at the selected
 * record, and the aside's detail panes have nothing to add to a map of every
 * place at once. What they do instead is hand *off* to those panes --
 * clicking a marker or a dot closes the dialog onto that record in its own
 * view, where the three-pane layout takes over. */
export function VisualModal({
  opened, onClose, title, toolbar, status, loading, error, empty, children,
}: VisualModalProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Modal.Root
      opened={opened}
      onClose={onClose}
      fullScreen={expanded}
      // Wide and tall enough to be a usable map or timeline while still
      // reading as a window over the app, not a replacement for it.
      size="min(1180px, 92vw)"
      padding={0}
    >
      <Modal.Overlay />
      {/* Composed out of Modal.Root rather than using plain <Modal> so the
          expand control can sit in the header beside the close button --
          <Modal>'s own header only takes a title. */}
      <Modal.Content
        style={{
          // The border is what makes the windowed size read as a dialog
          // rather than as a page that happens to be inset. Dropped when
          // expanded, where there's no surrounding app left to be bordered
          // away from.
          border: expanded ? undefined : "1px solid var(--mantine-color-default-border)",
        }}
        // Nothing else: giving Modal.Content its own display/flex rules
        // fights Mantine's, which sizes it from --modal-size and its own
        // max-height. Doing that stretched the frame to the full 855px the
        // max-height allowed while header + body only needed 700, leaving a
        // band of dead space under the status strip -- and cost it its width
        // as well. The frame's size is Mantine's job (`size` above, and
        // `fullScreen`); all this component decides is how tall the body is.
      >
        <Modal.Header
          style={{ borderBottom: "1px solid var(--mantine-color-default-border)", paddingInline: "var(--mantine-spacing-md)" }}
        >
          <Modal.Title fw={600}>{title}</Modal.Title>
          <Group gap={4} wrap="nowrap">
            <Tooltip label={expanded ? "Restore down" : "Expand to full screen"} withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                onClick={() => setExpanded((current) => !current)}
                aria-label={expanded ? "Restore down" : "Expand to full screen"}
              >
                {expanded ? "⤡" : "⤢"}
              </ActionIcon>
            </Tooltip>
            <Modal.CloseButton />
          </Group>
        </Modal.Header>
        {/* The plot is measured with a ResizeObserver against this column, so
            the body has to be a real bounded height rather than growing to
            fit its content. */}
        <Modal.Body
          style={{
            height: expanded ? "calc(100vh - 60px)" : "min(640px, 76vh)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {toolbar && (
            <Box px="md" py="xs" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
              {toolbar}
            </Box>
          )}
          <Box style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}>
            {error ? (
              <Alert color="red" m="md" title="Couldn't load the tree's data">{error}</Alert>
            ) : loading ? (
              <Center>
                <Group gap="xs">
                  <Loader size="sm" />
                  <Text size="sm" c="dimmed">Loading places and events…</Text>
                </Group>
              </Center>
            ) : empty ? (
              <Center>{empty}</Center>
            ) : (
              children
            )}
          </Box>
          {status && (
            <Box px="md" py={6} style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
              {status}
            </Box>
          )}
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}

/** Mantine's own Center would do, but this also has to fill the flex column
 * rather than sit at its natural height. */
function Center({ children }: { children: ReactNode }) {
  return (
    <Stack align="center" justify="center" style={{ flex: 1, minHeight: 0 }}>
      {children}
    </Stack>
  );
}
